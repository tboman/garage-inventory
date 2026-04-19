import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { hasScope } from '../auth/verifyJwt.js';

const REQUIRED_SCOPE = 'finance:read';

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function registerFinancePing(
  server: McpServer,
  auth: AuthContext,
): void {
  server.registerTool(
    'finance_ping',
    {
      title: 'Finance Ping',
      description:
        'Placeholder tool that echoes caller identity on the finance MCP. Requires finance:read scope.',
      inputSchema: {
        message: z
          .string()
          .max(200)
          .optional()
          .describe('Optional message to echo back.'),
      },
    },
    async ({ message }) => {
      if (!hasScope(auth, REQUIRED_SCOPE)) {
        return toolError(
          `insufficient_scope: this tool requires "${REQUIRED_SCOPE}".`,
        );
      }
      const payload = {
        ok: true,
        persona: 'finance',
        sub: auth.sub,
        client_id: auth.client_id,
        scopes: auth.scope,
        ebay_user_id: auth.ebay_user_id ?? null,
        echo: message ?? null,
        server_time: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
