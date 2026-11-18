// Firestore storage for Poppy sign-in. Codes and tokens are random strings the
// agent holds; only their SHA-256 hashes are stored, as document ids, so a
// database read never yields a usable credential. Every collection here is
// closed to clients by firestore.rules; only the admin SDK touches them.

const { createHash } = require("node:crypto");
const admin = require("firebase-admin");

// The jti of every client assertion and Session JWT seen, by hash, shared by
// both sites and every function instance so a captured JWT works only once.
const USED_IDS = "poppy_used_jtis";

// Deletes every document in `names` whose expires_at has passed, in batches,
// until none are left or `maxBatches` is reached (the next run picks up the
// rest). Anyone can load a join page, so these can pile up quickly.
async function deleteExpiredIn(db, names, nowMs, { batchSize = 400, maxBatches = 250 } = {}) {
  let total = 0;
  for (const name of names) {
    for (let i = 0; i < maxBatches; i++) {
      const snap = await db.collection(name).where("expires_at", "<", nowMs).limit(batchSize).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
      if (snap.size < batchSize) break;
    }
  }
  return total;
}

// The shared replay record for jwt.js. A transaction makes the check and the
// write one step, so two instances racing on the same jti cannot both win.
function createUsedIdStore() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  return {
    async claim(key, expiresAtMs, nowMs) {
      const ref = db.collection(USED_IDS).doc(createHash("sha256").update(key).digest("base64url"));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data().expires_at >= nowMs) return false;
        tx.set(ref, { expires_at: expiresAtMs });
        return true;
      });
    },
    deleteExpired: (nowMs) => deleteExpiredIn(db, [USED_IDS], nowMs),
  };
}

const CODES = "poppy_codes";
const GRANTS = "poppy_grants";
const ACCESS = "poppy_access_tokens";
// Device Sign-In requests, keyed by the hash of the agent's device_code, and
// a per-account count of wrong user codes typed on the verification page.
const DEVICE = "poppy_device_codes";
const DEVICE_MISSES = "poppy_device_attempts";
// Web browsing: one-time codes that join an agent's browser to its Session,
// and the cookie sessions those joins create.
const BROWSER_CODES = "poppy_browser_codes";
const WEB_SESSIONS = "poppy_web_sessions";

// The browser join's codes and web sessions (join.js), kept in the two
// collections a site names, so one site's codes and cookies mean nothing on
// another.
function browserJoinStore(db, BROWSER_CODES, WEB_SESSIONS) {
  return {
    async putBrowserCode(hash, data) {
      await db.collection(BROWSER_CODES).doc(hash).set(data);
    },

    async getBrowserCode(hash) {
      const snap = await db.collection(BROWSER_CODES).doc(hash).get();
      return snap.exists ? snap.data() : null;
    },

    // As moveDeviceRequest: applies `patch` only from status `from`.
    async moveBrowserCode(hash, from, patch) {
      const ref = db.collection(BROWSER_CODES).doc(hash);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== from) return false;
        tx.update(ref, patch);
        return true;
      });
    },

    // Uses the code up and returns what it was. Null if there is no such
    // code or it was submitted before, so a code only ever works once.
    async useBrowserCode(hash) {
      const ref = db.collection(BROWSER_CODES).doc(hash);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status === "used") return null;
        tx.update(ref, { status: "used" });
        return snap.data();
      });
    },

    async putWebSession(hash, data) {
      await db.collection(WEB_SESSIONS).doc(hash).set(data);
    },

    async getWebSession(hash) {
      const snap = await db.collection(WEB_SESSIONS).doc(hash).get();
      return snap.exists ? snap.data() : null;
    },
  };
}

function createFirestoreStore() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  return {
    async putCode(hash, data) {
      await db.collection(CODES).doc(hash).set(data);
    },

    // Marks the code used and returns it. A second call reports "used" along
    // with the grant the first call led to, so the caller can revoke it.
    async consumeCode(hash) {
      const ref = db.collection(CODES).doc(hash);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: "missing" };
        const data = snap.data();
        if (data.used) return { status: "used", data };
        tx.update(ref, { used: true });
        return { status: "ok", data };
      });
    },

    async linkCodeToGrant(hash, grantId) {
      await db.collection(CODES).doc(hash).update({ grant_id: grantId });
    },

    async putDeviceRequest(hash, data) {
      await db.collection(DEVICE).doc(hash).set(data);
    },

    async getDeviceRequest(hash) {
      const snap = await db.collection(DEVICE).doc(hash).get();
      return snap.exists ? snap.data() : null;
    },

    // The request a user code belongs to, with its id. Null when there is
    // none, and also when two requests share the code: that is vanishingly
    // unlikely, and guessing which one the person meant would be worse.
    async findDeviceRequest(userCodeHash) {
      const snap = await db
        .collection(DEVICE)
        .where("user_code_hash", "==", userCodeHash)
        .limit(2)
        .get();
      if (snap.size !== 1) return null;
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    async updateDeviceRequest(hash, patch) {
      await db.collection(DEVICE).doc(hash).update(patch);
    },

    // Applies `patch` only if the request is still in status `from`, and says
    // whether it did. This is what makes a request approvable once and its
    // tokens collectable once, however many requests race.
    async moveDeviceRequest(hash, from, patch) {
      const ref = db.collection(DEVICE).doc(hash);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().status !== from) return false;
        tx.update(ref, patch);
        return true;
      });
    },

    ...browserJoinStore(db, BROWSER_CODES, WEB_SESSIONS),

    async getDeviceMisses(uid) {
      const snap = await db.collection(DEVICE_MISSES).doc(uid).get();
      return snap.exists ? snap.data() : null;
    },

    async putDeviceMisses(uid, data) {
      await db.collection(DEVICE_MISSES).doc(uid).set(data);
    },

    async putGrant(id, data) {
      await db.collection(GRANTS).doc(id).set(data);
    },

    async getGrant(id) {
      const snap = await db.collection(GRANTS).doc(id).get();
      return snap.exists ? snap.data() : null;
    },

    async updateGrant(id, patch) {
      await db.collection(GRANTS).doc(id).update(patch);
    },

    async listGrants(uid) {
      const snap = await db
        .collection(GRANTS)
        .where("uid", "==", uid)
        .where("revoked", "==", false)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async putAccessToken(hash, data) {
      await db.collection(ACCESS).doc(hash).set(data);
    },

    async getAccessToken(hash) {
      const snap = await db.collection(ACCESS).doc(hash).get();
      return snap.exists ? snap.data() : null;
    },

    async updateAccessToken(hash, patch) {
      await db.collection(ACCESS).doc(hash).update(patch);
    },

    async deleteAccessToken(hash) {
      await db.collection(ACCESS).doc(hash).delete();
    },

    // With `expiredBefore`, only tokens that have already lapsed.
    async deleteAccessTokensForGrant(grantId, expiredBefore) {
      const snap = await db.collection(ACCESS).where("grant_id", "==", grantId).get();
      const batch = db.batch();
      let count = 0;
      for (const d of snap.docs) {
        if (expiredBefore !== undefined && d.data().expires_at >= expiredBefore) continue;
        batch.delete(d.ref);
        count += 1;
      }
      if (count) await batch.commit();
    },

    async listItems(uid) {
      const snap = await db.collection("users").doc(uid).collection("items").get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    // Returns false, leaving the stored item alone, when the id already exists.
    async createItem(uid, id, data) {
      try {
        await db.collection("users").doc(uid).collection("items").doc(id).create(data);
        return true;
      } catch (err) {
        if (err.code === 6 || err.code === "already-exists") return false;
        throw err;
      }
    },

    async updateItem(uid, id, patch) {
      await db.collection("users").doc(uid).collection("items").doc(id).update(patch);
    },

    async deleteItem(uid, id) {
      await db.collection("users").doc(uid).collection("items").doc(id).delete();
    },

    deleteExpired: (nowMs) =>
      deleteExpiredIn(db, [CODES, GRANTS, ACCESS, DEVICE, DEVICE_MISSES, BROWSER_CODES, WEB_SESSIONS], nowMs),
  };
}

// storageloot.shop: the browser join and the marketplace's listings, which
// are public. Its join collections are its own (see browserJoinStore).
const STORAGELOOT_BROWSER_CODES = "storageloot_poppy_browser_codes";
const STORAGELOOT_WEB_SESSIONS = "storageloot_poppy_web_sessions";

function createStorageLootStore() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  return {
    ...browserJoinStore(db, STORAGELOOT_BROWSER_CODES, STORAGELOOT_WEB_SESSIONS),

    // Active listings, newest first. Only active ones are public on the site.
    async listActiveListings(limit = 500) {
      const snap = await db
        .collection("listings")
        .where("status", "==", "active")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },

    async getListing(id) {
      const snap = await db.collection("listings").doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    },

    deleteExpired: (nowMs) => deleteExpiredIn(db, [STORAGELOOT_BROWSER_CODES, STORAGELOOT_WEB_SESSIONS], nowMs),
  };
}

module.exports = { createFirestoreStore, createStorageLootStore, createUsedIdStore, deleteExpiredIn };
