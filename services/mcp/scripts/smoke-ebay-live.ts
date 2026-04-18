/**
 * Live smoke: mint a JWT with a real Firebase uid and hit list_user_ebay_items
 * against the running MCP server, which will query Firestore and the real
 * eBay Browse API.
 *
 * Required env:
 *   MCP_JWT_PRIVATE_JWK  — same key the server loads
 *   ISSUER               — must match server issuer (e.g. http://127.0.0.1:8080)
 *   SUB                  — Firebase uid of a user with a linked eBay account
 */
import { SignJWT, importJWK, type JWK, type KeyLike } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const ISSUER = process.env['ISSUER'] ?? 'http://127.0.0.1:8080';
const PRIV_JWK = process.env['MCP_JWT_PRIVATE_JWK'];
const SUB = process.env['SUB'];
const LIMIT = Number(process.env['LIMIT'] ?? '5');

if (!PRIV_JWK) {
  console.error('MCP_JWT_PRIVATE_JWK env var is required.');
  process.exit(1);
}
if (!SUB) {
  console.error('SUB env var (Firebase uid) is required.');
  process.exit(1);
}

async function mintJwt(): Promise<string> {
  const jwk = JSON.parse(PRIV_JWK!) as JWK;
  const key = (await importJWK(jwk, 'RS256')) as KeyLike;
  const kid = jwk.kid;
  return new SignJWT({
    scope: 'openid profile market:read',
    client_id: 'ebay-live-smoke',
  })
    .setProtectedHeader({ alg: 'RS256', ...(kid ? { kid } : {}) })
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setSubject(SUB!)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key);
}

function authedFetch(token: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

async function main() {
  const jwt = await mintJwt();
  const url = new URL('/sse', ISSUER);
  const transport = new SSEClientTransport(url, {
    eventSourceInit: { fetch: authedFetch(jwt) as any },
    requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const client = new Client({ name: 'ebay-live-smoke', version: '0.0.1' });
  await client.connect(transport);
  console.log('[ok] MCP handshake');

  const result = await client.callTool({
    name: 'list_user_ebay_items',
    arguments: { entriesPerPage: LIMIT },
  });

  const first = Array.isArray(result.content) ? result.content[0] : null;
  if (!first || first.type !== 'text') {
    console.error('Unexpected tool result shape:', result);
    process.exit(1);
  }
  const payload = JSON.parse(first.text);

  if (result.isError) {
    console.error('Tool returned error:', payload);
    await client.close();
    process.exit(2);
  }

  const pg = payload.pagination;
  console.log(
    `[ok] page ${pg.pageNumber}/${pg.totalPages}  perPage=${pg.entriesPerPage}  totalEntries=${pg.totalEntries}  returned=${payload.items.length}`,
  );
  for (const item of payload.items) {
    const price = item.price != null ? `${item.currency ?? ''} ${item.price}` : '—';
    console.log(
      `  - ${item.itemId}  ${price}  qty=${item.quantity ?? '?'}  ${item.title}`,
    );
  }

  await client.close();
  console.log('\nLIVE SMOKE PASSED');
}

main().catch((err) => {
  console.error('LIVE SMOKE FAILED:', err);
  process.exit(1);
});
