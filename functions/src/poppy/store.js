// Firestore storage for Poppy sign-in. Codes and tokens are random strings the
// agent holds; only their SHA-256 hashes are stored, as document ids, so a
// database read never yields a usable credential. All three collections are
// closed to clients by firestore.rules; only the admin SDK touches them.

const admin = require("firebase-admin");

const CODES = "poppy_codes";
const GRANTS = "poppy_grants";
const ACCESS = "poppy_access_tokens";

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

    async deleteExpired(nowMs) {
      let total = 0;
      for (const name of [CODES, GRANTS, ACCESS]) {
        const snap = await db.collection(name).where("expires_at", "<", nowMs).limit(400).get();
        if (snap.empty) continue;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        total += snap.size;
      }
      return total;
    },
  };
}

module.exports = { createFirestoreStore };
