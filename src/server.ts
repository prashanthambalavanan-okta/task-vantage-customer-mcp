import express from 'express';
import { buildMcpApp } from './http.js';
import { mountProtectedResourceMetadata } from './oauth.js';
import { buildServer } from './tools.js';
import { createTesterApp } from './tester/app.js';

const oktaDomain = process.env.OKTA_DOMAIN?.replace(/\/$/, '');
const authServerId = process.env.OKTA_CUSTOMER_AUTH_SERVER_ID;
const audience = process.env.OKTA_CUSTOMER_AUDIENCE;
const allowInsecure = process.env.ALLOW_INSECURE === 'true';
// The demo UI shares this process and origin with the MCP endpoint, which
// keeps it to one deployment. Set ENABLE_TESTER_UI=false to serve MCP only —
// worth doing if this process is ever exposed to agents you don't control,
// since the UI holds the ID-JAG signing key.
const enableTesterUi = process.env.ENABLE_TESTER_UI !== 'false';

const issuer = oktaDomain && authServerId ? `${oktaDomain}/oauth2/${authServerId}` : undefined;
const scopes = ['customer:read', 'customer:lookup', 'customer:history', 'customer:write'];

const app = express();

// Render (or any TLS-terminating proxy) sits in front of us, so the metadata
// documents can only advertise https:// URLs if we trust X-Forwarded-Proto.
app.set('trust proxy', true);

// Discovery must live at the root: clients fetch
// /.well-known/oauth-protected-resource/mcp — this cannot go inside buildMcpApp.
mountProtectedResourceMetadata(app, [
  {
    resourcePath: '/mcp',
    issuer,
    scopes,
    resourceName: 'Task Vantage Customer MCP',
  },
]);

if (!audience && !allowInsecure) {
  console.warn('[server] OKTA_CUSTOMER_AUDIENCE not set — /mcp will reject every request until it is');
}
if (!issuer && !allowInsecure) {
  console.warn('[server] OKTA_DOMAIN / OKTA_CUSTOMER_AUTH_SERVER_ID not set — /mcp cannot advertise its authorization server');
}

app.use(
  buildMcpApp({
    serviceName: 'task-vantage-customer-mcp',
    buildServer,
    auth: { issuer, audience, resourcePath: '/mcp', allowInsecure },
  }),
);

// Mounted last so it can own '/' without shadowing /health, /mcp, or the
// discovery document. Its OAuth redirect URI is derived from the request, so
// no extra URL config is needed here.
if (enableTesterUi) {
  if (!process.env.OKTA_AI_AGENT_ID || !process.env.OKTA_AI_AGENT_PRIVATE_KEY) {
    console.warn('[server] tester UI is on but OKTA_AI_AGENT_ID / OKTA_AI_AGENT_PRIVATE_KEY are not set — sign-in will fail');
  }
  app.use(createTesterApp());
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Task Vantage Customer MCP server listening on port ${port}`);
  console.log('  /mcp         -> task-vantage-customer-mcp');
  if (enableTesterUi) console.log('  /            -> tester UI');
});
