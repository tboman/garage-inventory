import type { Request, Response } from 'express';
import { getSigningKey } from '../jwks.js';

export async function jwks(_req: Request, res: Response): Promise<void> {
  const { publicJwk } = await getSigningKey();
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ keys: [publicJwk] });
}
