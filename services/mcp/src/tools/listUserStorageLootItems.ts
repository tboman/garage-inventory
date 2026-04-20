import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { hasScope } from '../auth/verifyJwt.js';
import { getDb } from '../firestore.js';
import { resolveOwnerUid } from '../util/agentOwner.js';

const REQUIRED_SCOPE = 'market:read';

const STATUSES = ['active', 'sold', 'expired', 'draft'] as const;
type Status = (typeof STATUSES)[number];

const CATEGORIES = [
  'tools',
  'electronics',
  'furniture',
  'sports',
  'automotive',
  'household',
  'clothing',
  'other',
] as const;
type Category = (typeof CATEGORIES)[number];

function toolError(code: string, message: string) {
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: code, message }, null, 2),
      },
    ],
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export function registerListUserStorageLootItems(
  server: McpServer,
  auth: AuthContext,
): void {
  server.registerTool(
    'list_user_storage_loot_items',
    {
      title: 'List your StorageLoot listings',
      description:
        'Returns the authenticated seller’s StorageLoot listings (the marketplace at storageloot.shop). ' +
        'Filterable by status (default active) and category. Requires the market:read scope. ' +
        'Agent identities inherit listings from their owner.',
      inputSchema: {
        status: z
          .enum(STATUSES as unknown as [Status, ...Status[]])
          .optional()
          .describe('Listing status filter (default "active").'),
        category: z
          .enum(CATEGORIES as unknown as [Category, ...Category[]])
          .optional()
          .describe('Category filter; omit for all categories.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max items to return (1–200, default 50).'),
      },
    },
    async ({ status, category, limit }) => {
      if (!hasScope(auth, REQUIRED_SCOPE)) {
        return toolError(
          'insufficient_scope',
          `This tool requires the "${REQUIRED_SCOPE}" scope.`,
        );
      }

      const ownerUid = await resolveOwnerUid(auth.sub);
      const effectiveStatus: Status = status ?? 'active';
      const pageSize = limit ?? 50;

      try {
        let query = getDb()
          .collection('listings')
          .where('sellerId', '==', ownerUid)
          .where('status', '==', effectiveStatus);
        if (category) {
          query = query.where('category', '==', category);
        }
        const snap = await query
          .orderBy('createdAt', 'desc')
          .limit(pageSize)
          .get();

        const items = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: typeof data['title'] === 'string' ? data['title'] : null,
            description:
              typeof data['description'] === 'string'
                ? data['description']
                : null,
            price_cents: typeof data['price'] === 'number' ? data['price'] : null,
            currency:
              typeof data['currency'] === 'string' ? data['currency'] : 'USD',
            condition:
              typeof data['condition'] === 'string' ? data['condition'] : null,
            category:
              typeof data['category'] === 'string' ? data['category'] : null,
            status:
              typeof data['status'] === 'string' ? data['status'] : null,
            photo_count: Array.isArray(data['photos'])
              ? data['photos'].length
              : 0,
            primary_photo_url:
              Array.isArray(data['photos']) &&
              typeof data['photos'][0] === 'string'
                ? data['photos'][0]
                : null,
            group_id:
              typeof data['groupId'] === 'string' ? data['groupId'] : null,
            created_at: toIso(data['createdAt']),
            updated_at: toIso(data['updatedAt']),
            expires_at: toIso(data['expiresAt']),
            url: `https://storageloot.shop/listing/${d.id}`,
          };
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: items.length,
                  status: effectiveStatus,
                  ...(category ? { category } : {}),
                  items,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('list_user_storage_loot_items failed:', msg);
        return toolError('storageloot_query_failed', msg);
      }
    },
  );
}
