import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { hasScope } from '../auth/verifyJwt.js';
import {
  getValidEbayAccessToken,
  EbayAuthError,
} from '../ebay/userToken.js';

const REQUIRED_SCOPE = 'finance:read';
const REQUIRED_EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
];
const FINANCES_BASE = 'https://apiz.ebay.com/sell/finances/v1';

function toolError(code: string, message: string, extra?: Record<string, unknown>) {
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: code, message, ...(extra ?? {}) }, null, 2),
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
        'The user’s eBay authorization has expired or been rejected. Ask them to re-link eBay at storageloot.shop with the finance scopes (sell.account, sell.finances).',
        { required_scopes: REQUIRED_EBAY_SCOPES },
      );
    case 'config':
      return toolError('ebay_creds_missing', err.message);
  }
}

export function registerFinanceTransactionSummary(
  server: McpServer,
  auth: AuthContext,
): void {
  server.registerTool(
    'get_finance_transaction_summary',
    {
      title: 'Summary of recent eBay finance transactions',
      description:
        'Returns an aggregated summary of the authenticated seller’s recent eBay payouts, credits, and fees via the eBay Sell Finances API. ' +
        'Requires the user to have linked their eBay account with sell.account + sell.finances scopes, and the MCP finance:read scope.',
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe('Start ISO8601 date (inclusive). Defaults to the last 30 days.'),
        to: z
          .string()
          .optional()
          .describe('End ISO8601 date (exclusive). Defaults to now.'),
      },
    },
    async ({ from, to }) => {
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

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 86400 * 1000);
      const fromIso = from ?? defaultFrom.toISOString();
      const toIso = to ?? now.toISOString();
      const filter = `transactionDate:[${fromIso}..${toIso}]`;

      const url = `${FINANCES_BASE}/transaction_summary?filter=${encodeURIComponent(filter)}`;

      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });
        const body = await res.text();
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            return toolError(
              'ebay_scope_insufficient',
              'eBay rejected the call — the linked token likely lacks sell.finances. Ask the user to re-link eBay with finance scopes.',
              {
                required_scopes: REQUIRED_EBAY_SCOPES,
                ebay_status: res.status,
                ebay_body: body.slice(0, 500),
              },
            );
          }
          return toolError('ebay_api_error', `eBay Finances returned ${res.status}.`, {
            ebay_body: body.slice(0, 500),
          });
        }
        return {
          content: [{ type: 'text', text: body }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('get_finance_transaction_summary failed:', msg);
        return toolError('ebay_api_error', msg);
      }
    },
  );
}
