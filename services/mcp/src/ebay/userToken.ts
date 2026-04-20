import { config } from '../config.js';
import { getDb, FieldValue } from '../firestore.js';
import { getSecret } from '../secrets.js';

const SAFETY_BUFFER_MS = 60_000;

export type EbayAuthErrorCode =
  | 'not_linked'
  | 'refresh_expired'
  | 'refresh_failed'
  | 'config';

export class EbayAuthError extends Error {
  readonly code: EbayAuthErrorCode;
  constructor(code: EbayAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'EbayAuthError';
    this.code = code;
  }
}

interface TokenDoc {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
}

// Dedup concurrent refresh calls per-uid: two parallel tool calls for the
// same user must not both POST to eBay and race on the Firestore write.
const inFlight = new Map<string, Promise<string>>();

// Agent identities don't link eBay themselves; their owner does. Resolve to
// whichever uid actually holds the eBay token doc: try the caller first, then
// fall back to agent_owners/{uid}.owner_uid.
export async function resolveEbayUid(uid: string): Promise<string> {
  const db = getDb();
  const ownTokens = await db
    .doc(`users/${uid}/integration_tokens/ebay`)
    .get();
  if (ownTokens.exists) return uid;
  const ownerSnap = await db.collection('agent_owners').doc(uid).get();
  if (!ownerSnap.exists) return uid;
  const ownerUid = (ownerSnap.data() as { owner_uid?: unknown })?.owner_uid;
  return typeof ownerUid === 'string' && ownerUid ? ownerUid : uid;
}

async function loadClientSecret(): Promise<string> {
  if (config.ebay.clientSecretInline) return config.ebay.clientSecretInline;
  if (!config.gcpProject) {
    throw new EbayAuthError(
      'config',
      'EBAY_CLIENT_SECRET (inline) or GCP_PROJECT for Secret Manager required.',
    );
  }
  return getSecret(config.ebay.clientSecretName, config.gcpProject);
}

async function refreshAndPersist(
  uid: string,
  refreshToken: string,
): Promise<string> {
  if (!config.ebay.clientId) {
    throw new EbayAuthError('config', 'EBAY_CLIENT_ID not configured.');
  }
  const clientSecret = await loadClientSecret();
  const basic = Buffer.from(
    `${config.ebay.clientId}:${clientSecret}`,
  ).toString('base64');

  const res = await fetch(config.ebay.oauthUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('eBay refresh failed:', res.status, body);
    if (res.status === 400 || res.status === 401) {
      throw new EbayAuthError(
        'refresh_failed',
        'eBay refresh rejected — user needs to re-link.',
      );
    }
    throw new EbayAuthError('refresh_failed', 'eBay refresh failed.');
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const accessToken = json.access_token;
  const expiresIn = Number(json.expires_in ?? 0);
  if (!accessToken) {
    throw new EbayAuthError('refresh_failed', 'eBay refresh returned no token.');
  }

  await getDb()
    .doc(`users/${uid}/integration_tokens/ebay`)
    .update({
      accessToken,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
      updatedAt: FieldValue.serverTimestamp(),
    });

  return accessToken;
}

async function loadValidToken(uid: string): Promise<string> {
  const snap = await getDb()
    .doc(`users/${uid}/integration_tokens/ebay`)
    .get();
  if (!snap.exists) {
    throw new EbayAuthError('not_linked', 'eBay account not linked.');
  }
  const tokens = (snap.data() ?? {}) as TokenDoc;

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
    throw new EbayAuthError(
      'refresh_expired',
      'eBay refresh token expired — user needs to re-link.',
    );
  }

  return refreshAndPersist(uid, tokens.refreshToken);
}

export async function getValidEbayAccessToken(uid: string): Promise<string> {
  const ebayUid = await resolveEbayUid(uid);
  const existing = inFlight.get(ebayUid);
  if (existing) return existing;
  const p = loadValidToken(ebayUid).finally(() => {
    inFlight.delete(ebayUid);
  });
  inFlight.set(ebayUid, p);
  return p;
}
