const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { getSecret } = require("./secrets");

if (!admin.apps.length) admin.initializeApp();

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const IDENTITY_URL = "https://apiz.ebay.com/commerce/identity/v1/user/";

exports.linkEbayAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to link eBay.");
  }

  const { code } = request.data || {};
  if (!code || typeof code !== "string") {
    throw new HttpsError("invalid-argument", "Missing authorization code.");
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const runame = process.env.EBAY_RUNAME;
  if (!clientId || !runame) {
    throw new HttpsError("failed-precondition", "eBay client ID / RuName not configured.");
  }

  const clientSecret = await getSecret("EBAY_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: decodeURIComponent(code),
      redirect_uri: runame,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("eBay token exchange failed:", tokenRes.status, body);
    throw new HttpsError("failed-precondition", "eBay token exchange failed.");
  }

  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token;
  const refreshToken = tokenJson.refresh_token;
  const expiresIn = Number(tokenJson.expires_in || 0);
  const refreshExpiresIn = Number(tokenJson.refresh_token_expires_in || 0);

  if (!accessToken || !refreshToken) {
    throw new HttpsError("internal", "eBay did not return tokens.");
  }

  const identityRes = await fetch(IDENTITY_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!identityRes.ok) {
    const body = await identityRes.text();
    console.error("eBay identity fetch failed:", identityRes.status, body);
    throw new HttpsError("internal", "Failed to fetch eBay user info.");
  }

  const identity = await identityRes.json();
  const ebayUserId = identity.userId;
  const ebayUsername = identity.username;

  if (!ebayUserId || !ebayUsername) {
    throw new HttpsError("internal", "eBay identity response missing userId or username.");
  }

  const db = admin.firestore();
  const uid = request.auth.uid;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowMs = Date.now();

  const grantedScopes = tokenJson.scope
    ? String(tokenJson.scope).split(/\s+/).filter(Boolean)
    : [];

  await db.doc(`users/${uid}/integrations/ebay`).set({
    userId: ebayUserId,
    username: ebayUsername,
    scopes: grantedScopes,
    linkedAt: now,
  });

  await db.doc(`users/${uid}/integration_tokens/ebay`).set({
    accessToken,
    refreshToken,
    accessTokenExpiresAt: nowMs + expiresIn * 1000,
    refreshTokenExpiresAt: nowMs + refreshExpiresIn * 1000,
    updatedAt: now,
  });

  return { userId: ebayUserId, username: ebayUsername };
});
