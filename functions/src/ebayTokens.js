const admin = require("firebase-admin");
const { getSecret } = require("./secrets");

if (!admin.apps.length) admin.initializeApp();

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SAFETY_BUFFER_MS = 60 * 1000;

class EbayAuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function getValidEbayAccessToken(uid) {
  const db = admin.firestore();
  const ref = db.doc(`users/${uid}/integration_tokens/ebay`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new EbayAuthError("not-linked", "eBay account not linked.");
  }
  const tokens = snap.data();

  if (
    tokens.accessToken &&
    tokens.accessTokenExpiresAt &&
    Date.now() < tokens.accessTokenExpiresAt - SAFETY_BUFFER_MS
  ) {
    return tokens.accessToken;
  }

  if (
    !tokens.refreshToken ||
    !tokens.refreshTokenExpiresAt ||
    Date.now() >= tokens.refreshTokenExpiresAt
  ) {
    throw new EbayAuthError("refresh-expired", "eBay refresh token expired — please re-link.");
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) {
    throw new EbayAuthError("config", "EBAY_CLIENT_ID not configured.");
  }
  const clientSecret = await getSecret("EBAY_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("eBay refresh failed:", res.status, body);
    if (res.status === 400 || res.status === 401) {
      throw new EbayAuthError("refresh-failed", "eBay refresh rejected — please re-link.");
    }
    throw new EbayAuthError("refresh-failed", "eBay refresh failed.");
  }

  const json = await res.json();
  const newAccessToken = json.access_token;
  const expiresIn = Number(json.expires_in || 0);
  if (!newAccessToken) {
    throw new EbayAuthError("refresh-failed", "eBay refresh returned no token.");
  }

  await ref.update({
    accessToken: newAccessToken,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return newAccessToken;
}

exports.getValidEbayAccessToken = getValidEbayAccessToken;
exports.EbayAuthError = EbayAuthError;
