import { config } from '../config.js';
import { getAppToken } from './appToken.js';

export interface BrowseItemSummary {
  itemId: string;
  title: string;
  price: { value: string; currency: string } | null;
  condition: string | null;
  itemWebUrl: string | null;
  thumbnailUrl: string | null;
  seller: { username: string; feedbackPercentage?: string } | null;
}

export interface SearchResult {
  total: number;
  limit: number;
  offset: number;
  items: BrowseItemSummary[];
}

export interface SearchOptions {
  q?: string;
  limit?: number;
  offset?: number;
  marketplaceId?: string;
}

const DEFAULT_MARKETPLACE = 'EBAY_US';

function parseItem(raw: unknown): BrowseItemSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const itemId = typeof r['itemId'] === 'string' ? r['itemId'] : null;
  const title = typeof r['title'] === 'string' ? r['title'] : null;
  if (!itemId || !title) return null;

  const priceRaw = r['price'] as Record<string, unknown> | undefined;
  const price =
    priceRaw &&
    typeof priceRaw['value'] === 'string' &&
    typeof priceRaw['currency'] === 'string'
      ? { value: priceRaw['value'], currency: priceRaw['currency'] }
      : null;

  const images = r['thumbnailImages'] as Array<Record<string, unknown>> | undefined;
  const imageRaw = r['image'] as Record<string, unknown> | undefined;
  const thumbnailUrl =
    (Array.isArray(images) && typeof images[0]?.['imageUrl'] === 'string'
      ? (images[0]['imageUrl'] as string)
      : null) ||
    (imageRaw && typeof imageRaw['imageUrl'] === 'string'
      ? (imageRaw['imageUrl'] as string)
      : null);

  const sellerRaw = r['seller'] as Record<string, unknown> | undefined;
  const seller =
    sellerRaw && typeof sellerRaw['username'] === 'string'
      ? {
          username: sellerRaw['username'],
          ...(typeof sellerRaw['feedbackPercentage'] === 'string'
            ? { feedbackPercentage: sellerRaw['feedbackPercentage'] }
            : {}),
        }
      : null;

  return {
    itemId,
    title,
    price,
    condition: typeof r['condition'] === 'string' ? r['condition'] : null,
    itemWebUrl: typeof r['itemWebUrl'] === 'string' ? r['itemWebUrl'] : null,
    thumbnailUrl,
    seller,
  };
}

export async function searchItemsBySeller(
  username: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const marketplaceId = opts.marketplaceId ?? DEFAULT_MARKETPLACE;

  // Browse API requires q, category_ids, charity_ids, epid, or gtin alongside
  // the sellers: filter. q='*' is rejected as "too large" even with a seller
  // filter, so default to a common letter that matches most English titles.
  // Callers wanting exhaustive listings should use a user-token Sell API later.
  const q = opts.q && opts.q.trim() ? opts.q.trim() : 'a';
  const params = new URLSearchParams({
    q,
    filter: `sellers:{${username}}`,
    limit: String(limit),
    offset: String(offset),
  });

  const url = `${config.ebay.apiBase}/buy/browse/v1/item_summary/search?${params.toString()}`;
  const token = await getAppToken();

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`eBay Browse search failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    total?: number;
    itemSummaries?: unknown[];
  };

  const total = typeof json.total === 'number' ? json.total : 0;
  // eBay silently drops the sellers: filter when the username isn't recognized,
  // returning the full marketplace. Guard against that by refusing clearly
  // unbounded results when the caller asked for a specific seller.
  const SILENT_DROP_THRESHOLD = 10_000;
  if (total > SILENT_DROP_THRESHOLD) {
    throw new Error(
      `eBay returned ${total} results for sellers:{${username}}; the seller filter was likely ignored (unknown username).`,
    );
  }

  const items = (json.itemSummaries ?? [])
    .map(parseItem)
    .filter((x): x is BrowseItemSummary => x !== null);

  return {
    total,
    limit,
    offset,
    items,
  };
}
