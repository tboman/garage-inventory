import type { Request, Response } from 'express';
import { requirePersona } from '../util/persona.js';

export function openidConfiguration(req: Request, res: Response): void {
  const persona = requirePersona(req);
  res.json({
    issuer: persona.issuer,
    jwks_uri: `${persona.issuer}/.well-known/jwks.json`,
    authorization_endpoint: 'https://storageloot.shop/authorize',
    token_endpoint: `${persona.issuer}/token`,
    registration_endpoint: `${persona.issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: [...persona.mcpScopes],
    subject_types_supported: ['public'],
  });
}
