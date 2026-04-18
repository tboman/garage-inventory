/**
 * End-to-end smoke test for the MCP SSE server + JWT auth.
 *
 * Run the server first in another shell:
 *   ISSUER=http://127.0.0.1:8080 MCP_JWT_PRIVATE_JWK="$(cat .local-jwk.json)" npm run dev
 *
 * Then:
 *   MCP_JWT_PRIVATE_JWK="$(cat .local-jwk.json)" ISSUER=http://127.0.0.1:8080 \
 *     npx tsx scripts/smoke-mcp.ts
 */
import { SignJWT, importJWK, type JWK, type KeyLike } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const ISSUER = process.env['ISSUER'] ?? 'http://127.0.0.1:8080';
const PRIV_JWK = process.env['MCP_JWT_PRIVATE_JWK'];
if (!PRIV_JWK) {
  console.error('MCP_JWT_PRIVATE_JWK env var is required.');
  process.exit(1);
}

async function mintTestJwt(scopes: string[]): Promise<string> {
  const jwk = JSON.parse(PRIV_JWK!) as JWK;
  const key = (await importJWK(jwk, 'RS256')) as KeyLike;
  const kid = jwk.kid;
  return new SignJWT({ scope: scopes.join(' '), client_id: 'smoke-test-client' })
    .setProtectedHeader({ alg: 'RS256', ...(kid ? { kid } : {}) })
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setSubject('user_smoke_123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

function authedFetch(token: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

async function connectWith(scopes: string[]): Promise<Client> {
  const jwt = await mintTestJwt(scopes);
  const url = new URL('/sse', ISSUER);
  const transport = new SSEClientTransport(url, {
    eventSourceInit: { fetch: authedFetch(jwt) as any },
    requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const client = new Client({ name: 'smoke', version: '0.0.1' });
  await client.connect(transport);
  return client;
}

async function expectUnauthorized(): Promise<void> {
  const url = new URL('/sse', ISSUER);
  const res = await fetch(url);
  if (res.status !== 401) {
    throw new Error(`expected 401 on /sse without token, got ${res.status}`);
  }
  console.log('[ok] /sse without token → 401');
}

async function main() {
  await expectUnauthorized();

  // Happy path: market:read lets us call ping
  const client = await connectWith(['openid', 'profile', 'market:read']);
  console.log('[ok] MCP handshake completed');

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  console.log('[ok] tools/list →', names);
  if (!names.includes('ping')) throw new Error('ping tool missing');
  if (!names.includes('list_user_ebay_items'))
    throw new Error('list_user_ebay_items tool missing');

  const result = await client.callTool({
    name: 'ping',
    arguments: { message: 'hello' },
  });
  console.log('[ok] tools/call ping →', JSON.stringify(result, null, 2));
  if (result.isError) throw new Error('ping unexpectedly returned isError');

  // list_user_ebay_items: without a real linked eBay account for the smoke
  // user, we expect a structured error (ebay_not_linked or firestore_unavailable
  // when no ADC is present locally).
  const ebayResult = await client.callTool({
    name: 'list_user_ebay_items',
    arguments: { entriesPerPage: 5 },
  });
  const firstBlock = Array.isArray(ebayResult.content)
    ? ebayResult.content[0]
    : null;
  console.log(
    '[ok] tools/call list_user_ebay_items →',
    JSON.stringify(ebayResult, null, 2),
  );
  if (!ebayResult.isError) {
    throw new Error(
      'list_user_ebay_items should return isError for unlinked smoke user',
    );
  }
  if (!firstBlock || firstBlock.type !== 'text') {
    throw new Error('list_user_ebay_items returned no text content');
  }
  const parsed = JSON.parse(firstBlock.text) as { error?: string };
  const expected = new Set([
    'ebay_not_linked',
    'ebay_relink_required',
    'ebay_creds_missing',
    'ebay_api_error',
  ]);
  if (!parsed.error || !expected.has(parsed.error)) {
    throw new Error(
      `unexpected error code: ${parsed.error} (want one of ${[...expected].join('/')})`,
    );
  }
  console.log('[ok] list_user_ebay_items error code →', parsed.error);

  await client.close();

  // Scope-denied path: no market:read
  const client2 = await connectWith(['openid', 'profile']);
  const denied = await client2.callTool({ name: 'ping', arguments: {} });
  if (!denied.isError) {
    throw new Error('ping should have failed without market:read');
  }
  console.log('[ok] scope enforcement → isError:', denied.isError);

  const denied2 = await client2.callTool({
    name: 'list_user_ebay_items',
    arguments: {},
  });
  if (!denied2.isError) {
    throw new Error(
      'list_user_ebay_items should have failed without market:read',
    );
  }
  console.log('[ok] list_user_ebay_items scope enforcement → isError');
  await client2.close();

  console.log('\nALL SMOKE CHECKS PASSED');
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
