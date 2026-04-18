import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { hasScope } from '../auth/verifyJwt.js';
import {
  getValidEbayAccessToken,
  EbayAuthError,
} from '../ebay/userToken.js';
import {
  getMyActiveListings,
  ALLOWED_SORTS,
  type ActiveListSort,
} from '../ebay/tradingApi.js';

const REQUIRED_SCOPE = 'market:read';

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

function mapAuthError(err: EbayAuthError) {
  switch (err.code) {
    case 'not_linked':
      return toolError(
        'ebay_not_linked',
        'This StorageLoot user has not linked an eBay account. Ask them to visit storageloot.shop to link eBay.',
      );
    case 'refresh_expired':
    case 'refresh_failed':
      return toolError(
        'ebay_relink_required',
        'The user’s eBay authorization has expired or been rejected. Ask them to re-link eBay at storageloot.shop.',
      );
    case 'config':
      return toolError('ebay_creds_missing', err.message);
  }
}

export function registerListUserEbayItems(
  server: McpServer,
  auth: AuthContext,
): void {
  server.registerTool(
    'list_user_ebay_items',
    {
      title: 'List your active eBay listings',
      description:
        'Returns the authenticated user’s active eBay listings via the Trading API GetMyeBaySelling call. ' +
        'Requires the user to have linked their eBay account on StorageLoot and the market:read scope. ' +
        'Paginated; default 50 items per page, sorted by time remaining.',
      inputSchema: {
        pageNumber: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based page number (default 1).'),
        entriesPerPage: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Items per page (1–200, default 50).'),
        sort: z
          .enum(ALLOWED_SORTS as unknown as [ActiveListSort, ...ActiveListSort[]])
          .optional()
          .describe('Sort order (default TimeLeft).'),
      },
    },
    async ({ pageNumber, entriesPerPage, sort }) => {
      if (!hasScope(auth, REQUIRED_SCOPE)) {
        return toolError(
          'insufficient_scope',
          `This tool requires the "${REQUIRED_SCOPE}" scope.`,
        );
      }

      let accessToken: string;
      try {
        accessToken = await getValidEbayAccessToken(auth.sub);
      } catch (err) {
        if (err instanceof EbayAuthError) return mapAuthError(err);
        console.error('Unexpected eBay token error:', err);
        return toolError(
          'ebay_api_error',
          'Could not obtain an eBay access token.',
        );
      }

      try {
        const result = await getMyActiveListings(accessToken, {
          ...(pageNumber != null ? { pageNumber } : {}),
          ...(entriesPerPage != null ? { entriesPerPage } : {}),
          ...(sort ? { sort } : {}),
        });
        return {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        if (err instanceof EbayAuthError) return mapAuthError(err);
        const msg = err instanceof Error ? err.message : String(err);
        console.error('list_user_ebay_items failed:', msg);
        return toolError('ebay_api_error', msg);
      }
    },
  );
}
