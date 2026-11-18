// When a buyer asks a seller to list an item on another marketplace (from the
// web app or through an agent), record it on the listing's placeholder for
// that marketplace: listings/{listingId}/marketplaces/{platform}. Clients may
// not touch requestCount, so this is the one place it is counted.

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { REQUEST_PLATFORMS, placeholderAfterRequest } = require("./messages");

if (!admin.apps.length) admin.initializeApp();

exports.onListingRequest = onDocumentCreated(
  { document: "conversations/{conversationId}/messages/{messageId}", region: "us-central1" },
  async (event) => {
    const message = event.data && event.data.data();
    if (!message || message.kind !== "listing_request" || !REQUEST_PLATFORMS.includes(message.platform)) return;

    const db = admin.firestore();
    const conversation = await db.collection("conversations").doc(event.params.conversationId).get();
    const listingId = conversation.exists && conversation.data().listingId;
    if (typeof listingId !== "string") return;

    const ref = db.collection("listings").doc(listingId).collection("marketplaces").doc(message.platform);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = placeholderAfterRequest(snap.exists ? snap.data() : null, FieldValue.serverTimestamp());
      tx.set(ref, next, { merge: true });
    });
  },
);
