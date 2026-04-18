const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

exports.unlinkEbayAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const db = admin.firestore();
  const uid = request.auth.uid;

  await Promise.all([
    db.doc(`users/${uid}/integrations/ebay`).delete(),
    db.doc(`users/${uid}/integration_tokens/ebay`).delete(),
  ]);

  return { success: true };
});
