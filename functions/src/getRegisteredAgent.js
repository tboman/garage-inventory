const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { fetchCimd, isCimdClientId } = require("./cimd");
const { personaForHost } = require("./personas");

if (!admin.apps.length) admin.initializeApp();

const PERSONA_REQUIRED_EBAY_SCOPES = {
  seller: [],
  finance: [
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
  ],
  manager: [],
};

exports.getRegisteredAgent = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  const clientId = request.data?.client_id;
  const mcpHost = request.data?.mcp_host;
  if (typeof clientId !== "string" || !clientId) {
    throw new HttpsError("invalid-argument", "Missing client_id.");
  }

  const db = admin.firestore();
  const uid = request.auth.uid;
  const ebayPromise = db
    .doc(`users/${uid}/integrations/ebay`)
    .get();
  const agentsPromise = db.collection(`users/${uid}/agents`).get();

  let clientInfo;
  let persona;

  if (isCimdClientId(clientId)) {
    const hostPersona = personaForHost(mcpHost);
    if (!hostPersona) {
      throw new HttpsError(
        "invalid-argument",
        "Missing or unknown mcp_host for CIMD client.",
      );
    }
    persona = hostPersona.name;
    const doc = await fetchCimd(clientId, hostPersona.mcpScopes);
    if (doc.error) {
      throw new HttpsError("invalid-argument", doc.error_description || doc.error);
    }
    clientInfo = {
      client_name: doc.client_name || "",
      redirect_uris: doc.redirect_uris,
      scope: doc.scope,
    };
  } else {
    const clientSnap = await db.collection("mcp_clients").doc(clientId).get();
    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Client not registered.");
    }
    const data = clientSnap.data();
    persona = typeof data.persona === "string" ? data.persona : "seller";
    clientInfo = {
      client_name: data.client_name || "",
      redirect_uris: Array.isArray(data.redirect_uris) ? data.redirect_uris : [],
      scope: typeof data.scope === "string" ? data.scope : "",
    };
  }

  const requiredEbayScopes = PERSONA_REQUIRED_EBAY_SCOPES[persona] || [];

  const ebaySnap = await ebayPromise;
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

  const agentsSnap = await agentsPromise;
  const assignableAgents = agentsSnap.docs
    .map((d) => d.data())
    .filter((a) => a && a.persona === persona)
    .map((a) => ({
      agent_uid: a.agent_uid,
      email: a.email || null,
      label: a.label || a.email || a.agent_uid,
      persona: a.persona,
    }));

  return {
    client_id: clientId,
    client_name: clientInfo.client_name,
    redirect_uris: clientInfo.redirect_uris,
    scope: clientInfo.scope,
    persona,
    required_ebay_scopes: requiredEbayScopes,
    current_ebay_scopes: currentEbayScopes,
    ebay_linked: ebayLinked,
    assignable_agents: assignableAgents,
  };
});
