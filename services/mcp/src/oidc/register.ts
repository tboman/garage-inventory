import type { Request, Response } from 'express';
import { validateMetadata } from '../util/validate.js';
import { createClient } from '../clients.js';

export async function register(req: Request, res: Response): Promise<void> {
  const result = validateMetadata(req.body);
  if ('error' in result) {
    res.status(400).json(result);
    return;
  }

  try {
    const created = await createClient(result);
    res.status(201).json({
      client_id: created.client_id,
      ...(created.client_secret
        ? {
            client_secret: created.client_secret,
            client_secret_expires_at: 0,
          }
        : {}),
      client_id_issued_at: created.client_id_issued_at,
      redirect_uris: created.redirect_uris,
      client_name: created.client_name,
      token_endpoint_auth_method: created.token_endpoint_auth_method,
      grant_types: created.grant_types,
      response_types: created.response_types,
      scope: created.scope,
    });
  } catch (err) {
    console.error('Client registration failed:', err);
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client.',
    });
  }
}
