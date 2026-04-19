import type { Request, Response } from 'express';
import { getDb, FieldValue } from '../firestore.js';
import { verifySecret } from '../util/secretHash.js';
import { verifyPkceS256 } from '../util/pkce.js';
import {
  mintAccessToken,
  mintRefreshToken,
  consumeRefreshToken,
  getEbayUserId,
} from '../tokens.js';
import { requirePersona } from '../util/persona.js';
import { isCimdClientId, fetchCimd } from '../cimd.js';
import type { Persona } from '../personas.js';

interface ClientAuth {
  client_id: string | null;
  client_secret: string | null;
}

interface ClientDoc {
  client_secret_hash: string | null;
  token_endpoint_auth_method: string;
  redirect_uris: string[];
  issuer?: string;
}

interface AuthSessionDoc {
  uid: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
  used: boolean;
  persona?: string;
}

function errJson(
  res: Response,
  status: number,
  error: string,
  desc?: string,
): void {
  res
    .status(status)
    .json({ error, ...(desc ? { error_description: desc } : {}) });
}

function extractClientAuth(req: Request): ClientAuth {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx > 0) {
        return {
          client_id: decodeURIComponent(decoded.slice(0, idx)),
          client_secret: decodeURIComponent(decoded.slice(idx + 1)),
        };
      }
    } catch {
      // fall through
    }
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  return {
    client_id:
      typeof body['client_id'] === 'string' ? (body['client_id'] as string) : null,
    client_secret:
      typeof body['client_secret'] === 'string'
        ? (body['client_secret'] as string)
        : null,
  };
}

async function authenticateClient(
  clientId: string | null,
  providedSecret: string | null,
  persona: Persona,
): Promise<ClientDoc | null> {
  if (!clientId) return null;
  if (isCimdClientId(clientId)) {
    const doc = await fetchCimd(clientId, persona.mcpScopes);
    if ('error' in doc) return null;
    return {
      client_secret_hash: null,
      token_endpoint_auth_method: 'none',
      redirect_uris: doc.redirect_uris,
    };
  }
  const snap = await getDb().collection('mcp_clients').doc(clientId).get();
  if (!snap.exists) return null;
  const client = snap.data() as ClientDoc;
  const isPublic = client.token_endpoint_auth_method === 'none';
  if (isPublic) return client;
  if (!providedSecret || !client.client_secret_hash) return null;
  if (!verifySecret(providedSecret, client.client_secret_hash)) return null;
  return client;
}

export async function token(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grant =
      typeof body['grant_type'] === 'string' ? body['grant_type'] : null;
    if (!grant)
      return errJson(res, 400, 'invalid_request', 'Missing grant_type.');
    if (grant === 'authorization_code')
      return await handleAuthorizationCode(req, res);
    if (grant === 'refresh_token') return await handleRefresh(req, res);
    return errJson(res, 400, 'unsupported_grant_type');
  } catch (err) {
    console.error('Token endpoint error:', err);
    if (!res.headersSent) errJson(res, 500, 'server_error');
  }
}

async function handleAuthorizationCode(
  req: Request,
  res: Response,
): Promise<void> {
  const persona = requirePersona(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const code = typeof body['code'] === 'string' ? (body['code'] as string) : null;
  const redirectUri =
    typeof body['redirect_uri'] === 'string' ? (body['redirect_uri'] as string) : null;
  const codeVerifier =
    typeof body['code_verifier'] === 'string' ? (body['code_verifier'] as string) : null;
  const { client_id, client_secret } = extractClientAuth(req);

  if (!code || !redirectUri || !codeVerifier || !client_id) {
    return errJson(res, 400, 'invalid_request', 'Missing required fields.');
  }

  const client = await authenticateClient(client_id, client_secret, persona);
  if (!client) return errJson(res, 401, 'invalid_client');
  if (client.issuer && client.issuer !== persona.issuer) {
    return errJson(
      res,
      400,
      'invalid_client',
      'Client is registered at a different MCP persona.',
    );
  }

  const db = getDb();
  const codeRef = db.collection('auth_sessions').doc(code);

  const consumed = await db.runTransaction<
    { replay: true } | AuthSessionDoc | null
  >(async (tx) => {
    const snap = await tx.get(codeRef);
    if (!snap.exists) return null;
    const data = snap.data() as AuthSessionDoc;
    if (data.used) {
      tx.update(codeRef, { compromised: true });
      return { replay: true };
    }
    if (data.expires_at < Date.now()) return null;
    tx.update(codeRef, { used: true, used_at: FieldValue.serverTimestamp() });
    return data;
  });

  if (!consumed)
    return errJson(res, 400, 'invalid_grant', 'Code invalid or expired.');
  if ('replay' in consumed)
    return errJson(res, 400, 'invalid_grant', 'Code already used.');
  if (consumed.client_id !== client_id)
    return errJson(res, 400, 'invalid_grant', 'Client mismatch.');
  if (consumed.redirect_uri !== redirectUri)
    return errJson(res, 400, 'invalid_grant', 'Redirect URI mismatch.');
  if (consumed.code_challenge_method !== 'S256')
    return errJson(res, 400, 'invalid_grant', 'Unsupported PKCE method.');
  if (!verifyPkceS256(codeVerifier, consumed.code_challenge))
    return errJson(res, 400, 'invalid_grant', 'PKCE verification failed.');
  if (consumed.persona && consumed.persona !== persona.name)
    return errJson(
      res,
      400,
      'invalid_grant',
      'Code was minted for a different MCP persona.',
    );

  const ebayUserId = await getEbayUserId(consumed.uid);
  const access = await mintAccessToken(
    {
      sub: consumed.uid,
      scope: consumed.scope,
      client_id,
      ebay_user_id: ebayUserId,
    },
    persona,
  );
  const refreshToken = await mintRefreshToken(
    consumed.uid,
    client_id,
    consumed.scope,
    persona,
  );

  res.json({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expiresIn,
    refresh_token: refreshToken,
    scope: consumed.scope,
  });
}

async function handleRefresh(req: Request, res: Response): Promise<void> {
  const persona = requirePersona(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const refreshToken =
    typeof body['refresh_token'] === 'string'
      ? (body['refresh_token'] as string)
      : null;
  const { client_id, client_secret } = extractClientAuth(req);
  if (!refreshToken || !client_id) return errJson(res, 400, 'invalid_request');

  const client = await authenticateClient(client_id, client_secret, persona);
  if (!client) return errJson(res, 401, 'invalid_client');
  if (client.issuer && client.issuer !== persona.issuer) {
    return errJson(
      res,
      400,
      'invalid_client',
      'Client is registered at a different MCP persona.',
    );
  }

  const consumed = await consumeRefreshToken(refreshToken);
  if (!consumed) return errJson(res, 400, 'invalid_grant');
  if (consumed.client_id !== client_id)
    return errJson(res, 400, 'invalid_grant', 'Client mismatch.');
  if (consumed.persona && consumed.persona !== persona.name)
    return errJson(
      res,
      400,
      'invalid_grant',
      'Refresh token was issued for a different MCP persona.',
    );

  const ebayUserId = await getEbayUserId(consumed.uid);
  const access = await mintAccessToken(
    {
      sub: consumed.uid,
      scope: consumed.scope,
      client_id,
      ebay_user_id: ebayUserId,
    },
    persona,
  );
  const newRefresh = await mintRefreshToken(
    consumed.uid,
    client_id,
    consumed.scope,
    persona,
  );

  res.json({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expiresIn,
    refresh_token: newRefresh,
    scope: consumed.scope,
  });
}
