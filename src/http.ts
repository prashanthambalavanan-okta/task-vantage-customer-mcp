import express, { type Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { bearerAuth, type AuthOptions } from './auth.js';

/**
 * Builds a stateless Streamable-HTTP MCP app: every POST /mcp gets a fresh
 * McpServer + transport pair (no session map to manage), which is the
 * simplest correct shape for a small tools server like this one.
 *
 * Omit `auth` to fall back to this domain's env vars.
 */
export function buildMcpApp(opts: {
  serviceName: string;
  buildServer: () => McpServer;
  auth?: AuthOptions;
}): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', service: opts.serviceName });
  });

  app.post('/mcp', bearerAuth(opts.auth), async (req, res) => {
    const server = opts.buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`[${opts.serviceName}] MCP request error`, err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed: this server runs in stateless mode' });
  });
  app.delete('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed: this server runs in stateless mode' });
  });

  return app;
}
