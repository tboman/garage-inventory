import type { Request, Response, NextFunction } from 'express';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { config } from '../config.js';
import { getSigningKey } from '../jwks.js';

export interface AuthContext {
  sub: string;
  scope: string[];
  client_id: string;
  ebay_user_id?: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

let jwks: ReturnType<typeof createLocalJWKSet> | null = null;

async function getJwks(): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (jwks) return jwks;
  const { publicJwk } = await getSigningKey();
  const set: JSONWebKeySet = { keys: [publicJwk] };
  jwks = createLocalJWKSet(set);
  return jwks;
}

function unauthorized(
  res: Response,
  error: string,
  description?: string,
): void {
  const params = [`error="${error}"`];
  if (description) params.push(`error_description="${description}"`);
  res.setHeader('WWW-Authenticate', `Bearer ${params.join(', ')}`);
  res
    .status(401)
    .json({ error, ...(description ? { error_description: description } : {}) });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res, 'invalid_token', 'Missing Bearer token.');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return unauthorized(res, 'invalid_token', 'Empty Bearer token.');
  }

  try {
    const keys = await getJwks();
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.issuer,
      algorithms: ['RS256'],
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const scopeStr =
      typeof payload['scope'] === 'string' ? (payload['scope'] as string) : '';
    const clientId =
      typeof payload['client_id'] === 'string'
        ? (payload['client_id'] as string)
        : null;
    if (!sub || !clientId) {
      return unauthorized(res, 'invalid_token', 'Missing sub or client_id.');
    }
    const ebayUserId =
      typeof payload['ebay_user_id'] === 'string'
        ? (payload['ebay_user_id'] as string)
        : undefined;
    req.auth = {
      sub,
      scope: scopeStr.split(/\s+/).filter(Boolean),
      client_id: clientId,
      ...(ebayUserId ? { ebay_user_id: ebayUserId } : {}),
    };
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token verification failed.';
    unauthorized(res, 'invalid_token', msg);
  }
}

export function hasScope(auth: AuthContext, required: string): boolean {
  return auth.scope.includes(required);
}
