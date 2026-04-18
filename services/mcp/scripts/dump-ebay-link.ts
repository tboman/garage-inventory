import { getDb } from '../src/firestore.js';

const UID = process.argv[2] ?? 'CCRuOvYHYLeek4k9UGbeSJVZf3F2';

async function main() {
  const db = getDb();
  const integ = await db
    .doc(`users/${UID}/integrations/ebay`)
    .get();
  console.log('integrations/ebay:', JSON.stringify(integ.data(), null, 2));

  const tokens = await db
    .doc(`users/${UID}/integration_tokens/ebay`)
    .get();
  const tdata = tokens.data() as Record<string, unknown> | undefined;
  if (tdata) {
    // redact tokens
    const redacted = { ...tdata };
    for (const k of ['accessToken', 'refreshToken']) {
      if (k in redacted && typeof redacted[k] === 'string') {
        redacted[k] = (redacted[k] as string).slice(0, 12) + '…';
      }
    }
    console.log('integration_tokens/ebay:', JSON.stringify(redacted, null, 2));
  }

  // Use the current user token to query eBay's identity endpoint again
  const tok = tdata?.['accessToken'] as string | undefined;
  if (tok) {
    const res = await fetch('https://apiz.ebay.com/commerce/identity/v1/user/', {
      headers: { Authorization: `Bearer ${tok}` },
    });
    console.log('\nidentity re-fetch status:', res.status);
    console.log((await res.text()).slice(0, 1500));
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
