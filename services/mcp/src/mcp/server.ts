import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { registerPing } from '../tools/ping.js';
import { registerListUserEbayItems } from '../tools/listUserEbayItems.js';

export function createMcpServer(auth: AuthContext): McpServer {
  const server = new McpServer(
    { name: 'storageloot-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registerPing(server, auth);
  registerListUserEbayItems(server, auth);
  return server;
}
