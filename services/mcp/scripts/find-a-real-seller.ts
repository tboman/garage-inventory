import { getAppToken } from '../src/ebay/appToken.js';

async function main() {
  const token = await getAppToken();
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
  url.searchParams.set('q', 'iphone 14');
  url.searchParams.set('limit', '10');
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  const json = (await res.json()) as {
    itemSummaries?: Array<{ seller?: { username?: string } }>;
  };
  const usernames = new Set<string>();
  for (const item of json.itemSummaries ?? []) {
    if (item.seller?.username) usernames.add(item.seller.username);
  }
  console.log('Sample sellers:', [...usernames]);

  // Verify filter works for one of them
  for (const name of usernames) {
    const u2 = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    u2.searchParams.set('q', 'a');
    u2.searchParams.set('filter', `sellers:{${name}}`);
    u2.searchParams.set('limit', '3');
    const r2 = await fetch(u2, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });
    const j2 = (await r2.json()) as { total?: number };
    console.log(`  ${name} total=${j2.total}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
