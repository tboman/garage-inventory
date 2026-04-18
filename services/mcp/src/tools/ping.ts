import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { hasScope } from '../auth/verifyJwt.js';

const REQUIRED_SCOPE = 'market:read';

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function registerPing(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description:
        'Placeholder tool that echoes caller identity. Requires market:read scope.',
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
