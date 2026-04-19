const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const PERSONA_REQUIRED_EBAY_SCOPES = {
  seller: [],
  finance: [
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
  ],
};

exports.getRegisteredAgent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  const clientId = request.data?.client_id;
  if (typeof clientId !== "string" || !clientId) {
    throw new HttpsError("invalid-argument", "Missing client_id.");
  }

  const db = admin.firestore();
  const uid = request.auth.uid;

  const [clientSnap, ebaySnap] = await Promise.all([
    db.collection("mcp_clients").doc(clientId).get(),
    db.doc(`users/${uid}/integrations/ebay`).get(),
  ]);

  if (!clientSnap.exists) {
    throw new HttpsError("not-found", "Client not registered.");
  }

  const data = clientSnap.data();
  const persona = typeof data.persona === "string" ? data.persona : "seller";
  const requiredEbayScopes = PERSONA_REQUIRED_EBAY_SCOPES[persona] || [];

  let currentEbayScopes = [];
  let ebayLinked = false;
  if (ebaySnap.exists) {
    ebayLinked = true;
    const ebayData = ebaySnap.data();
    if (Array.isArray(ebayData.scopes)) {
      currentEbayScopes = ebayData.scopes;
    } else if (typeof ebayData.scopes === "string") {
      currentEbayScopes = ebayData.scopes.split(/\s+/).filter(Boolean);
    }
  }

  return {
    client_id: clientId,
    client_name: data.client_name || "",
    redirect_uris: Array.isArray(data.redirect_uris) ? data.redirect_uris : [],
    scope: typeof data.scope === "string" ? data.scope : "",
    persona,
    required_ebay_scopes: requiredEbayScopes,
    current_ebay_scopes: currentEbayScopes,
    ebay_linked: ebayLinked,
  };
});
