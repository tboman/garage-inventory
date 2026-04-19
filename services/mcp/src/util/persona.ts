import type { Request, Response, NextFunction } from 'express';
import { personaForHost, personaByName, type Persona } from '../personas.js';

declare module 'express-serve-static-core' {
  interface Request {
    persona?: Persona;
  }
}

export function personaMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const host = req.headers.host;
  let persona = personaForHost(host);
  if (!persona) {
    const fallback = process.env['DEFAULT_PERSONA'];
    if (fallback) persona = personaByName(fallback);
  }
  if (!persona) {
    res.status(400).json({
      error: 'unknown_host',
      error_description: `Host "${host ?? ''}" is not mapped to an MCP persona.`,
    });
    return;
  }
  req.persona = persona;
  next();
}

export function requirePersona(req: Request): Persona {
  if (!req.persona) {
    throw new Error('persona middleware did not run before this handler.');
  }
  return req.persona;
}
