import type { Request, Response } from 'express';
import { config } from '../config.js';

export function openidConfiguration(_req: Request, res: Response): void {
  res.json({
    issuer: config.issuer,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    authorization_endpoint: 'https://storageloot.shop/authorize',
    token_endpoint: `${config.issuer}/token`,
    registration_endpoint: `${config.issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'market:read', 'market:search'],
    subject_types_supported: ['public'],
  });
}
