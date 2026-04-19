import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { openidConfiguration } from './oidc/discovery.js';
import { jwks } from './oidc/jwksEndpoint.js';
import { register } from './oidc/register.js';
import { token } from './oidc/token.js';
import { requireAuth } from './auth/verifyJwt.js';
import { createMcpServer } from './mcp/server.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/.well-known/openid-configuration', openidConfiguration);
app.get('/.well-known/jwks.json', jwks);

app.post('/register', express.json({ limit: '10kb' }), register);

app.post(
  '/token',
  express.urlencoded({ extended: false, limit: '10kb' }),
  express.json({ limit: '10kb' }),
  token,
);

const transports = new Map<string, SSEServerTransport>();

app.get('/sse', requireAuth, async (req: Request, res: Response) => {
  if (!req.auth) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  const transport = new SSEServerTransport('/messages', res);
  transports.set(transport.sessionId, transport);
  res.on('close', () => {
    transports.delete(transport.sessionId);
  });

  const server = createMcpServer(req.auth);
  try {
    await server.connect(transport);
  } catch (err) {
    console.error('SSE connect failed:', err);
    transports.delete(transport.sessionId);
    if (!res.headersSent) res.status(500).end();
  }
});

app.post('/messages', requireAuth, async (req: Request, res: Response) => {
  const sessionId = req.query['sessionId'];
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing sessionId.' });
    return;
  }
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'session_not_found' });
    return;
  }
  try {
    // Express Request extends IncomingMessage; cast bypasses SDK's AuthInfo shape
    // since we pass auth via the per-session McpServer closure, not the SDK.
    await transport.handlePostMessage(req as never, res);
  } catch (err) {
    console.error('Message handling failed:', err);
    if (!res.headersSent) res.status(500).end();
  }
});

app.listen(config.port, () => {
  console.log(
    `MCP server listening on :${config.port} (issuer=${config.issuer})`,
  );
});
