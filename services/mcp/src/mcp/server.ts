import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import type { Persona } from '../personas.js';

export function createMcpServer(
  auth: AuthContext,
  persona: Persona,
): McpServer {
  const server = new McpServer(
    { name: `storageloot-mcp-${persona.name}`, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  for (const register of persona.toolRegistrations) {
    register(server, auth);
  }
  return server;
}
