const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { randomBytes } = require("node:crypto");

if (!admin.apps.length) admin.initializeApp();

const CODE_TTL_MS = 60 * 1000;

exports.mintAuthorizationCode = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const data = request.data || {};
  const clientId = data.client_id;
  const redirectUri = data.redirect_uri;
  const scope = data.scope;
  const codeChallenge = data.code_challenge;
  const codeChallengeMethod = data.code_challenge_method;

  if (
    typeof clientId !== "string" ||
    typeof redirectUri !== "string" ||
    typeof scope !== "string" ||
    typeof codeChallenge !== "string"
  ) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }
  if (codeChallengeMethod !== "S256") {
    throw new HttpsError("invalid-argument", "Only S256 PKCE is supported.");
  }

  const db = admin.firestore();
  const clientSnap = await db.collection("mcp_clients").doc(clientId).get();
  if (!clientSnap.exists) {
    throw new HttpsError("not-found", "Client not registered.");
  }
  const client = clientSnap.data();
  if (
    !Array.isArray(client.redirect_uris) ||
    !client.redirect_uris.includes(redirectUri)
  ) {
    throw new HttpsError("invalid-argument", "Redirect URI not registered.");
  }

  const requested = scope.split(/\s+/).filter(Boolean);
  const registered = new Set(
    String(client.scope || "").split(/\s+/).filter(Boolean),
  );
  for (const s of requested) {
    if (!registered.has(s)) {
      throw new HttpsError(
        "invalid-argument",
        `Scope ${s} not granted to this client.`,
      );
    }
  }

  const code = randomBytes(32).toString("base64url");
  await db.collection("auth_sessions").doc(code).set({
    uid: request.auth.uid,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: requested.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    expires_at: Date.now() + CODE_TTL_MS,
    used: false,
  });

  return { code };
});
