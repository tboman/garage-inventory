import {
  generateKeyPair,
  exportJWK,
  calculateJwkThumbprint,
  importJWK,
  SignJWT,
  jwtVerify,
} from 'jose';

async function main(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);
  privateJwk.alg = 'RS256';
  privateJwk.use = 'sig';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const kid = await calculateJwkThumbprint(publicJwk);
  privateJwk.kid = kid;
  publicJwk.kid = kid;

  const priv = await importJWK(privateJwk, 'RS256');
  const pub = await importJWK(publicJwk, 'RS256');
  const token = await new SignJWT({ smoke: true })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer('test')
    .setAudience('test')
    .setExpirationTime('1m')
    .sign(priv);
  const { payload } = await jwtVerify(token, pub, {
    issuer: 'test',
    audience: 'test',
  });
  if (payload.smoke !== true) throw new Error('Round-trip verification failed.');

  const privateJson = JSON.stringify(privateJwk);
  process.stderr.write('Sign/verify round-trip: OK\n\n');
  process.stderr.write(`kid: ${kid}\n\n`);
  process.stderr.write('--- Public JWK (for reference) ---\n');
  process.stderr.write(JSON.stringify(publicJwk, null, 2) + '\n\n');
  process.stderr.write('--- Private JWK (store in Secret Manager) ---\n');
  process.stdout.write(privateJson + '\n');
  process.stderr.write('\nUpload to Secret Manager:\n');
  process.stderr.write(
    '  gcloud secrets create MCP_JWT_PRIVATE_JWK --replication-policy=automatic\n',
  );
  process.stderr.write(
    '  node scripts/generate-keypair.ts | gcloud secrets versions add MCP_JWT_PRIVATE_JWK --data-file=-\n',
  );
  process.stderr.write(
    '\nLocal dev: copy the JSON line above into services/mcp/.env as MCP_JWT_PRIVATE_JWK=...\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
