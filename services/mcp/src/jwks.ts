import {
  calculateJwkThumbprint,
  importJWK,
  type JWK,
  type KeyLike,
} from 'jose';
import { config } from './config.js';
import { getSecret } from './secrets.js';

export interface SigningKey {
  kid: string;
  publicJwk: JWK;
  privateKey: KeyLike;
}

let cached: SigningKey | null = null;

async function loadPrivateJwkJson(): Promise<string> {
  if (config.jwtPrivateJwkInline) return config.jwtPrivateJwkInline;
  if (!config.gcpProject) {
    throw new Error(
      'No MCP_JWT_PRIVATE_JWK env var and no GCP_PROJECT configured for Secret Manager.',
    );
  }
  return getSecret(config.jwtPrivateJwkSecretName, config.gcpProject);
}

export async function getSigningKey(): Promise<SigningKey> {
  if (cached) return cached;

  const json = await loadPrivateJwkJson();
  const jwk = JSON.parse(json) as JWK;
  if (jwk.kty !== 'RSA') throw new Error('Expected RSA private JWK.');

  const { d, p, q, dp, dq, qi, ...rest } = jwk;
  void d; void p; void q; void dp; void dq; void qi;

  const publicJwk: JWK = { ...rest, alg: 'RS256', use: 'sig' };
  const kid = jwk.kid || (await calculateJwkThumbprint(publicJwk));
  publicJwk.kid = kid;
  jwk.kid = kid;

  const privateKey = (await importJWK(jwk, 'RS256')) as KeyLike;
  cached = { kid, publicJwk, privateKey };
  return cached;
}
