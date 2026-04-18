const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

exports.getRegisteredAgent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  const clientId = request.data?.client_id;
  if (typeof clientId !== "string" || !clientId) {
    throw new HttpsError("invalid-argument", "Missing client_id.");
  }

  const snap = await admin
    .firestore()
    .collection("mcp_clients")
    .doc(clientId)
    .get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Client not registered.");
  }

  const data = snap.data();
  return {
    client_id: clientId,
    client_name: data.client_name || "",
    redirect_uris: Array.isArray(data.redirect_uris) ? data.redirect_uris : [],
    scope: typeof data.scope === "string" ? data.scope : "",
  };
});
