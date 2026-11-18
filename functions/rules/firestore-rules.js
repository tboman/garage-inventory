// Firestore rules tests for StorageLoot messages and marketplace placeholders.
// Needs the Firestore emulator (Java). Run from functions/ with:
//   npm run test:rules
// Not named *.test.js, so the plain `npm test` run does not pick it up.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, orderBy,
  writeBatch, serverTimestamp,
} = require("firebase/firestore");

const SELLER = "seller-uid";
const BUYER = "buyer-uid";
const STRANGER = "stranger-uid";
const LISTING = "drill";
const CONVO = `${LISTING}_${BUYER}`;

let env;

test.before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-storageloot-rules",
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") },
  });
});

test.after(async () => {
  await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "listings", LISTING), { sellerId: SELLER, title: "Cordless drill", status: "active" });
    await setDoc(doc(db, "listings", "sold"), { sellerId: SELLER, title: "Sold thing", status: "sold" });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();

function conversation(overrides = {}) {
  return {
    listingId: LISTING,
    listingTitle: "Cordless drill",
    listingPhoto: null,
    sellerId: SELLER,
    sellerDisplayName: "Sally",
    buyerId: BUYER,
    buyerDisplayName: "Bob",
    participants: [SELLER, BUYER],
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageText: "Is it still available?",
    lastSenderId: BUYER,
    sellerReadAt: null,
    buyerReadAt: serverTimestamp(),
    ...overrides,
  };
}

function message(uid, role, overrides = {}) {
  return { senderId: uid, senderRole: role, kind: "inquiry", text: "Is it still available?", createdAt: serverTimestamp(), ...overrides };
}

// The buyer's first write: the conversation and its first message together.
function start(db, convo = conversation(), msg = message(BUYER, "buyer"), id = CONVO) {
  const batch = writeBatch(db);
  batch.set(doc(db, "conversations", id), convo);
  batch.set(doc(db, "conversations", id, "messages", "m1"), msg);
  return batch.commit();
}

async function started() {
  await assertSucceeds(start(as(BUYER)));
}

function post(db, uid, role, msg, id = "m2") {
  const batch = writeBatch(db);
  batch.set(doc(db, "conversations", CONVO, "messages", id), msg);
  batch.update(doc(db, "conversations", CONVO), {
    lastMessageAt: serverTimestamp(),
    lastMessageText: msg.text.slice(0, 140) || "Offer",
    lastSenderId: uid,
  });
  return batch.commit();
}

test("a buyer starts a conversation with a message", async () => {
  await started();
  await assertSucceeds(getDoc(doc(as(SELLER), "conversations", CONVO)));
  await assertSucceeds(getDoc(doc(as(SELLER), "conversations", CONVO, "messages", "m1")));
});

test("a buyer can check for a conversation that does not exist yet", async () => {
  const snap = await assertSucceeds(getDoc(doc(as(BUYER), "conversations", CONVO)));
  assert.equal(snap.exists(), false);
});

test("the conversation must name the listing's real seller", async () => {
  await assertFails(
    start(as(BUYER), conversation({ sellerId: STRANGER, participants: [STRANGER, BUYER] })),
  );
});

test("a seller cannot start a conversation about their own listing", async () => {
  await assertFails(
    start(
      as(SELLER),
      conversation({ buyerId: SELLER, participants: [SELLER, SELLER], lastSenderId: SELLER }),
      message(SELLER, "buyer"),
      `${LISTING}_${SELLER}`,
    ),
  );
});

test("the id must be listing_buyer, and the listing must be active", async () => {
  await assertFails(start(as(BUYER), conversation(), message(BUYER, "buyer"), "something-else"));
  await assertFails(
    start(as(BUYER), conversation({ listingId: "sold", listingTitle: "Sold thing" }), message(BUYER, "buyer"), `sold_${BUYER}`),
  );
});

test("someone else cannot read the conversation or its messages", async () => {
  await started();
  await assertFails(getDoc(doc(as(STRANGER), "conversations", CONVO)));
  await assertFails(getDoc(doc(as(STRANGER), "conversations", CONVO, "messages", "m1")));
  await assertFails(post(as(STRANGER), STRANGER, "buyer", message(STRANGER, "buyer", { kind: "reply" })));
});

test("the message board query works for both sides", async () => {
  await started();
  for (const uid of [SELLER, BUYER]) {
    const db = as(uid);
    const q = query(collection(db, "conversations"), where("participants", "array-contains", uid), orderBy("lastMessageAt", "desc"));
    const snap = await assertSucceeds(getDocs(q));
    assert.equal(snap.size, 1);
  }
});

test("the seller replies; the seller cannot make an offer or ask for a listing", async () => {
  await started();
  await assertSucceeds(post(as(SELLER), SELLER, "seller", message(SELLER, "seller", { kind: "reply", text: "Yes!" })));
  await assertFails(
    post(as(SELLER), SELLER, "seller", message(SELLER, "seller", {
      kind: "offer", text: "", offerAmount: 100, currency: "USD", offerStatus: "pending",
    }), "m3"),
  );
  await assertFails(
    post(as(SELLER), SELLER, "seller", message(SELLER, "seller", { kind: "listing_request", text: "", platform: "ebay" }), "m4"),
  );
  // Nor pretend to be the buyer.
  await assertFails(post(as(SELLER), SELLER, "buyer", message(SELLER, "buyer", { kind: "reply", text: "hi" }), "m5"));
});

test("offers: the amount is checked; only the seller answers, once", async () => {
  await started();
  const offer = (o) => message(BUYER, "buyer", { kind: "offer", text: "", offerAmount: 3500, currency: "USD", offerStatus: "pending", ...o });
  await assertFails(post(as(BUYER), BUYER, "buyer", offer({ offerAmount: 0 }), "bad1"));
  await assertFails(post(as(BUYER), BUYER, "buyer", offer({ offerAmount: 12.5 }), "bad2"));
  await assertFails(post(as(BUYER), BUYER, "buyer", offer({ offerStatus: "accepted" }), "bad3"));
  await assertSucceeds(post(as(BUYER), BUYER, "buyer", offer(), "offer"));

  const ref = (db) => doc(db, "conversations", CONVO, "messages", "offer");
  await assertFails(updateDoc(ref(as(BUYER)), { offerStatus: "accepted", respondedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref(as(SELLER)), { offerAmount: 1, offerStatus: "accepted", respondedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref(as(SELLER)), { offerStatus: "accepted", respondedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref(as(SELLER)), { offerStatus: "declined", respondedAt: serverTimestamp() }));
});

test("listing requests name eBay or Craigslist; messages cannot claim to come from an agent", async () => {
  await started();
  const req = (o) => message(BUYER, "buyer", { kind: "listing_request", text: "", platform: "ebay", ...o });
  await assertSucceeds(post(as(BUYER), BUYER, "buyer", req(), "r1"));
  await assertFails(post(as(BUYER), BUYER, "buyer", req({ platform: "nextdoor" }), "r2"));
  await assertFails(post(as(BUYER), BUYER, "buyer", message(BUYER, "buyer", { kind: "reply", text: "hi", via: "agent" }), "r3"));
});

test("each side marks only its own side read", async () => {
  await started();
  await assertSucceeds(updateDoc(doc(as(SELLER), "conversations", CONVO), { sellerReadAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as(SELLER), "conversations", CONVO), { buyerReadAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as(BUYER), "conversations", CONVO), { sellerId: STRANGER }));
});

test("marketplace placeholders: the seller only, and never the request count", async () => {
  const ref = (db, p = "nextdoor") => doc(db, "listings", LISTING, "marketplaces", p);
  const data = { status: "listed", url: "https://nextdoor.com/for_sale_and_free/123", updatedAt: serverTimestamp() };
  await assertFails(setDoc(ref(as(BUYER)), data));
  await assertFails(setDoc(ref(as(SELLER), "offerup"), data));
  await assertFails(setDoc(ref(as(SELLER)), { ...data, url: "javascript:alert(1)" }));
  await assertFails(setDoc(ref(as(SELLER)), { ...data, requestCount: 5 }));
  await assertSucceeds(setDoc(ref(as(SELLER)), data));
  await assertSucceeds(getDoc(ref(as(SELLER))));
  await assertFails(getDoc(ref(as(BUYER))));

  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(ref(ctx.firestore(), "ebay"), { status: "requested", requestCount: 2, updatedAt: new Date() }),
  );
  await assertSucceeds(updateDoc(ref(as(SELLER), "ebay"), { status: "planned", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref(as(SELLER), "ebay"), { requestCount: 0, updatedAt: serverTimestamp() }));
});
