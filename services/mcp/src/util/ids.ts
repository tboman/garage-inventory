import { randomBytes } from 'node:crypto';

export function generateClientId(): string {
  return randomBytes(16).toString('base64url');
}

export function generateClientSecret(): string {
  return randomBytes(32).toString('base64url');
}
