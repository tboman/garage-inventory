import { XMLParser } from 'fast-xml-parser';
import { EbayAuthError } from './userToken.js';

const TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const COMPAT_LEVEL = '1349';
const SITE_ID = '0'; // EBAY_US

export type ActiveListSort =
  | 'TimeLeft'
  | 'BestMatch'
  | 'CurrentPrice'
  | 'StartTime'
  | 'EndTime'
  | 'Title';

export const ALLOWED_SORTS: readonly ActiveListSort[] = [
  'TimeLeft',
  'BestMatch',
  'CurrentPrice',
  'StartTime',
  'EndTime',
  'Title',
];

export interface ActiveListOptions {
  pageNumber?: number;
  entriesPerPage?: number;
  sort?: ActiveListSort;
}

export interface ActiveItem {
  itemId: string;
  title: string;
  price: number | null;
  currency: string | null;
  quantity: number | null;
  quantitySold: number | null;
  timeLeft: string | null;
  listingType: string | null;
  viewItemUrl: string | null;
  galleryUrl: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface ActiveListResult {
  items: ActiveItem[];
  pagination: {
    pageNumber: number;
    entriesPerPage: number;
    totalPages: number;
    totalEntries: number;
  };
}

const TOKEN_OR_SCOPE_CODES = new Set(['931', '932', '21916984']);

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function readMoney(node: unknown): { amount: number | null; currency: string | null } {
  if (node == null) return { amount: null, currency: null };
  if (typeof node === 'object') {
    const n = node as { ['#text']?: string; ['@_currencyID']?: string };
    return {
      amount: n['#text'] != null ? Number(n['#text']) : null,
      currency: n['@_currencyID'] ?? null,
    };
  }
  return { amount: Number(node), currency: null };
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function mapItem(raw: unknown): ActiveItem {
  const item = (raw ?? {}) as Record<string, unknown>;
  const selling = (item['SellingStatus'] ?? {}) as Record<string, unknown>;
  const listingDetails = (item['ListingDetails'] ?? {}) as Record<string, unknown>;
  const pictureDetails = (item['PictureDetails'] ?? {}) as Record<string, unknown>;
  const price = readMoney(selling['CurrentPrice']);
  return {
    itemId: String(item['ItemID'] ?? ''),
    title: typeof item['Title'] === 'string' ? (item['Title'] as string) : '',
    price: price.amount,
    currency: price.currency,
    quantity: num(item['Quantity']),
    quantitySold: num(selling['QuantitySold']),
    timeLeft: str(item['TimeLeft']),
    listingType: str(item['ListingType']),
    viewItemUrl: str(listingDetails['ViewItemURL']),
    galleryUrl: str(pictureDetails['GalleryURL']),
    startTime: str(listingDetails['StartTime']),
    endTime: str(listingDetails['EndTime']),
  };
}

function buildRequestXml(
  pageNumber: number,
  entriesPerPage: number,
  sort: ActiveListSort,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>${sort}</Sort>
    <Pagination>
      <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

export async function getMyActiveListings(
  accessToken: string,
  opts: ActiveListOptions = {},
): Promise<ActiveListResult> {
  const pageNumber = Math.max(1, Math.floor(opts.pageNumber ?? 1));
  const entriesPerPage = Math.min(
    200,
    Math.max(1, Math.floor(opts.entriesPerPage ?? 50)),
  );
  const sort: ActiveListSort =
    opts.sort && ALLOWED_SORTS.includes(opts.sort) ? opts.sort : 'TimeLeft';

  const body = buildRequestXml(pageNumber, entriesPerPage, sort);

  const res = await fetch(TRADING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-SITEID': SITE_ID,
      'X-EBAY-API-COMPATIBILITY-LEVEL': COMPAT_LEVEL,
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-IAF-TOKEN': accessToken,
    },
    body,
  });

  const xmlText = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const parsed = parser.parse(xmlText) as {
    GetMyeBaySellingResponse?: Record<string, unknown>;
  };
  const response = parsed.GetMyeBaySellingResponse ?? {};
  const ack = response['Ack'];

  if (ack !== 'Success' && ack !== 'Warning') {
    const firstError =
      (asArray(response['Errors'] as unknown)[0] as Record<string, unknown>) ?? {};
    const errorCode = String(firstError['ErrorCode'] ?? '');
    const message =
      (firstError['LongMessage'] as string | undefined) ??
      (firstError['ShortMessage'] as string | undefined) ??
      'eBay Trading API call failed.';
    console.error('eBay Trading API error:', errorCode, message);
    if (
      TOKEN_OR_SCOPE_CODES.has(errorCode) ||
      /token/i.test(message) ||
      /scope/i.test(message)
    ) {
      throw new EbayAuthError('refresh_failed', message);
    }
    throw new Error(message);
  }

  const activeList = (response['ActiveList'] ?? {}) as Record<string, unknown>;
  const itemArray = (activeList['ItemArray'] ?? {}) as Record<string, unknown>;
  const items = asArray(itemArray['Item'] as unknown).map(mapItem);

  const pg = (activeList['PaginationResult'] ?? {}) as Record<string, unknown>;
  return {
    items,
    pagination: {
      pageNumber,
      entriesPerPage,
      totalPages: num(pg['TotalNumberOfPages']) ?? 1,
      totalEntries: num(pg['TotalNumberOfEntries']) ?? items.length,
    },
  };
}
