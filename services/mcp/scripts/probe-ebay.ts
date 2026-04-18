/**
 * One-off: directly hit eBay Browse API with different q/filter combinations
 * to find a working pattern for "list this seller's listings".
 */
import { getAppToken } from '../src/ebay/appToken.js';

const USERNAME = process.argv[2] ?? 'tomasboman';

async function probe(params: Record<string, string>): Promise<void> {
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const token = await getAppToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let total: number | string = '?';
  try {
    const j = JSON.parse(text);
    total = j.total ?? '?';
    if (j.errors) {
      console.log(
        `  ❌ ${res.status}  ${JSON.stringify(params)} -> ${j.errors[0]?.errorId} ${j.errors[0]?.message}`,
      );
      return;
    }
  } catch {}
  console.log(`  ✅ ${res.status}  ${JSON.stringify(params)} -> total=${total}`);
}

async function main() {
  console.log(`Probing Browse API for seller candidates of: ${USERNAME}\n`);
  const variants = [
    USERNAME,
    USERNAME.toLowerCase(),
    USERNAME.toUpperCase(),
    'tomasbom',
    'TomasBom',
    'goodwillfinds',
  ];
  for (const name of variants) {
    await probe({
      q: 'a',
      filter: `sellers:{${name}}`,
      limit: '3',
    });
  }
  console.log('\nBaselines (no filter):');
  await probe({ q: 'wedding dress', limit: '3' });
  console.log('\nItem-by-id sanity (known eBay item):');
  await probe({ q: 'iphone', limit: '3' });
}

main().catch((err) => {
  console.error('PROBE FAILED:', err);
  process.exit(1);
});
