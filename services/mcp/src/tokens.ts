import { SignJWT } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import { getSigningKey } from './jwks.js';
import { getDb, FieldValue } from './firestore.js';
import type { Persona, PersonaName } from './personas.js';

const ACCESS_TOKEN_TTL_SEC = 3600;
const REFRESH_TOKEN_TTL_SEC = 30 * 86400;

export interface AccessTokenClaims {
  sub: string;
  scope: string;
  client_id: string;
  ebay_user_id?: string;
}

export interface IssuedToken {
  token: string;
  expiresIn: number;
}

export async function mintAccessToken(
  claims: AccessTokenClaims,
  persona: Persona,
): Promise<IssuedToken> {
  const { privateKey, kid } = await getSigningKey();
  const token = await new SignJWT({
    scope: claims.scope,
    client_id: claims.client_id,
    ...(claims.ebay_user_id ? { ebay_user_id: claims.ebay_user_id } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(persona.issuer)
    .setAudience(persona.issuer)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(privateKey);
  return { token, expiresIn: ACCESS_TOKEN_TTL_SEC };
}

export async function mintRefreshToken(
  uid: string,
  clientId: string,
  scope: string,
  persona: Persona,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const id = createHash('sha256').update(raw).digest('base64url');
  await getDb().collection('mcp_refresh_tokens').doc(id).set({
    uid,
    client_id: clientId,
    scope,
    persona: persona.name,
    issuer: persona.issuer,
    created_at: FieldValue.serverTimestamp(),
    expires_at: Date.now() + REFRESH_TOKEN_TTL_SEC * 1000,
    revoked: false,
  });
  return raw;
}

export interface ConsumedRefreshToken {
  uid: string;
  client_id: string;
  scope: string;
  persona?: PersonaName;
}

export async function consumeRefreshToken(
  raw: string,
): Promise<ConsumedRefreshToken | null> {
  const id = createHash('sha256').update(raw).digest('base64url');
  const db = getDb();
  const ref = db.collection('mcp_refresh_tokens').doc(id);
  return db.runTransaction<ConsumedRefreshToken | null>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() as {
      uid: string;
      client_id: string;
      scope: string;
      revoked: boolean;
      expires_at: number;
      persona?: PersonaName;
    };
    if (data.revoked || data.expires_at < Date.now()) return null;
    tx.update(ref, {
      revoked: true,
      revoked_at: FieldValue.serverTimestamp(),
    });
    return {
      uid: data.uid,
      client_id: data.client_id,
      scope: data.scope,
      ...(data.persona ? { persona: data.persona } : {}),
    };
  });
}

export async function getEbayUserId(uid: string): Promise<string | undefined> {
  try {
    const snap = await getDb()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc('ebay')
      .get();
    if (!snap.exists) return undefined;
    const data = snap.data() as { userId?: string };
    return data.userId;
  } catch (err) {
    console.warn('eBay user id lookup failed:', err);
    return undefined;
  }
}
