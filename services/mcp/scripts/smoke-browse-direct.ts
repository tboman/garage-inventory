/**
 * Direct live smoke: calls searchItemsBySeller for a known-active seller and
 * asserts real items come back. Proves the Browse API wiring independently
 * of the MCP protocol layer (which smoke-mcp.ts already covers).
 */
import { searchItemsBySeller } from '../src/ebay/browseApi.js';

const SELLER = process.argv[2] ?? 'cellfeee';

async function main() {
  const result = await searchItemsBySeller(SELLER, { limit: 3 });
  console.log(`seller=${SELLER}  total=${result.total}  returned=${result.items.length}`);
  if (result.items.length === 0) {
    console.error('Expected at least one item.');
    process.exit(1);
  }
  for (const item of result.items) {
    const price = item.price
      ? `${item.price.currency} ${item.price.value}`
      : '—';
    console.log(`  - ${item.itemId}  ${price}  ${item.title}`);
  }
  console.log('\nBROWSE-DIRECT SMOKE PASSED');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
