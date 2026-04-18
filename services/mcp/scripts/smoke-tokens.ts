import { createHash, randomBytes } from 'node:crypto';
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  calculateJwkThumbprint,
  createLocalJWKSet,
  jwtVerify,
  SignJWT,
} from 'jose';
import { verifyPkceS256 } from '../src/util/pkce.js';

async function main(): Promise<void> {
  // 1. PKCE round-trip
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  if (!verifyPkceS256(verifier, challenge)) throw new Error('PKCE verify failed');
  if (verifyPkceS256('wrong', challenge))
    throw new Error('PKCE should have rejected wrong verifier');
  console.log('✓ PKCE S256: valid verifier accepted, wrong verifier rejected');

  // 2. Access-token sign -> verify via JWKS (simulates what a relying party does)
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;

  const issuer = 'http://localhost:8080';
  const token = await new SignJWT({
    scope: 'market:read market:search',
    client_id: 'test-client',
    ebay_user_id: 'ebay-abc',
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setAudience(issuer)
    .setSubject('firebase-uid-xyz')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    issuer,
    audience: issuer,
  });
  if (protectedHeader.kid !== kid) throw new Error('kid mismatch in header');
  if (payload.sub !== 'firebase-uid-xyz') throw new Error('sub mismatch');
  if (payload.client_id !== 'test-client') throw new Error('client_id mismatch');
  if (payload.ebay_user_id !== 'ebay-abc') throw new Error('ebay_user_id mismatch');
  console.log('✓ Access token: signed with kid, verified via JWKS, claims round-trip');

  // 3. Refresh-token hashing (prove what we store matches what we look up)
  const raw = randomBytes(32).toString('base64url');
  const id1 = createHash('sha256').update(raw).digest('base64url');
  const id2 = createHash('sha256').update(raw).digest('base64url');
  if (id1 !== id2) throw new Error('hash not deterministic');
  const otherId = createHash('sha256')
    .update(randomBytes(32).toString('base64url'))
    .digest('base64url');
  if (id1 === otherId) throw new Error('distinct tokens hashed to same id');
  console.log('✓ Refresh-token hash: deterministic and collision-resistant');

  console.log('\nAll crypto smoke checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
