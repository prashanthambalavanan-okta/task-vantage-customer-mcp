# Task Vantage Customer MCP

A single MCP server exposing customer-account tools over the real MCP protocol (Streamable HTTP transport), secured by **your own Okta org** (a Custom Authorization Server + scope set for the customer domain). It also ships a local tester UI at `/` for exercising the full human-login → agent ID-JAG exchange → tool-call chain without any LLM in the loop.

This project is a single-domain extraction of a larger multi-domain demo — no gateway, no workspaces, one process, one deployment.

## Tools

| Mount | Scopes | Tools |
|---|---|---|
| `/mcp` | `customer:read`, `customer:lookup`, `customer:history`, `customer:write` | `get_customer`, `search_customers`, `get_customers_by_tier`, `get_top_customers`, `get_customer_summary`, `add_customer`, `delete_customer` |

Each tool call checks its required scope against the granted scopes in the caller's token — a token missing `customer:write` can call `get_customer` but not `add_customer`.

## Data

Seeded from a ported snapshot of the ProGear demo dataset: 34 customer accounts (`src/data/customers.json`). **All state resets on process restart** — this is a tools server, not a system of record.

## Project structure

```
src/
  server.ts        # entrypoint: mounts /mcp, the .well-known metadata, and (by default) the tester UI
  tools.ts          # the 7 MCP tool definitions
  store.ts          # in-memory customer store
  types.ts          # Customer / CustomerSummary types
  data/customers.json
  auth.ts           # Okta JWT bearer validation + scope enforcement
  oauth.ts          # RFC 9728 protected-resource metadata
  http.ts           # stateless MCP-over-HTTP transport helper
  tester/           # local tester UI: PKCE login + agent ID-JAG exchange
```

## Local development

```bash
npm install
cp .env.example .env      # fill in Okta values, or leave ALLOW_INSECURE=true for a quick local run
npm run dev                # tsx watch, one port (default 3000)
```

Without `OKTA_DOMAIN` / `OKTA_CUSTOMER_AUTH_SERVER_ID` / `OKTA_CUSTOMER_AUDIENCE` set, `/mcp` returns `500` on every request unless `ALLOW_INSECURE=true`, which skips token validation and grants every scope — local dev only, never set this in a deployed environment.

## Okta setup

```
OKTA_DOMAIN=https://your-org.okta.com
OKTA_CUSTOMER_AUTH_SERVER_ID=...
OKTA_CUSTOMER_AUDIENCE=api://task-vantage-customer
```

Tokens are validated by signature + issuer + audience against this Custom Authorization Server's own Okta JWKS endpoint (`jose`'s `createRemoteJWKSet`) — no shared secret needed on this side.

## Deploying to Render

**Manual (New → Web Service):**

| Field | Value |
|---|---|
| Language | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `node dist/server.js` |
| Health Check Path | `/health` |

**Blueprint:** `render.yaml` at the repo root defines the same single service — New → Blueprint, point at this repo, then fill in the Okta env vars it prompts for (marked `sync: false`).

## Connecting an agent

MCP is exposed over Streamable HTTP at `POST/GET/DELETE /mcp` (stateless — no session persistence across requests) plus `GET /health`.

Get an access token from Okta for this Custom Authorization Server + scopes (e.g. client-credentials grant for a service/agent identity), then:

```bash
claude mcp add --transport http task-vantage-customer \
  https://<your-render-url>/mcp \
  --header "Authorization: Bearer <token>"
```

**Any other MCP client / agent SDK:** point it at `/mcp` with an `Authorization: Bearer <token>` header on every request.

### OAuth discovery (no static token)

Clients that implement the MCP authorization spec can find Okta on their own instead of being handed a token:

```
GET /.well-known/oauth-protected-resource/mcp
```

```json
{
  "resource": "https://<your-render-url>/mcp",
  "authorization_servers": ["https://your-org.okta.com/oauth2/<auth-server-id>"],
  "scopes_supported": ["customer:read", "customer:lookup", "customer:history", "customer:write"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Task Vantage Customer MCP"
}
```

A `401` from `/mcp` also carries the pointer via `WWW-Authenticate: Bearer resource_metadata="..."`, so a client that calls the endpoint cold learns where to authenticate. (When a token *was* presented but failed validation, the challenge additionally carries `error="invalid_token"` and `error_description`.)

The URLs in this document are derived from the incoming request (`X-Forwarded-Proto` + `Host`, with `trust proxy` on — correct on Render). Set `PUBLIC_BASE_URL=https://<your-render-url>` only if something in front of this server rewrites the `Host` header.

To let a client complete the flow, register an OIDC **public** client (Authorization Code + PKCE) in your Okta org, add the client's redirect URI, and grant `customer:*` scopes in this Custom Authorization Server's access policy.

### Connecting Claude Code with a pre-registered client ID

```bash
claude mcp add --transport http \
  --client-id 0oaXXXXXXXXXXXXXXXX \
  --callback-port 33418 \
  task-vantage-customer https://<your-render-url>/mcp
```

Then in Claude Code: `/mcp` → select **task-vantage-customer** → **Authenticate**.

Okta side, before that works:

- An OIDC app of type **Native** or **SPA** (public client): grant types Authorization Code + Refresh Token, PKCE required, no client secret.
- Sign-in redirect URI `http://localhost:33418/callback`.
- An access-policy rule in this Custom Authorization Server that allows this client and grants the customer scopes.

## Tester UI

The tester UI is mounted at `/` by default (set `ENABLE_TESTER_UI=false` to disable it — worth doing if this process is ever exposed to agents you don't control, since the UI holds the ID-JAG signing key).

1. **Sign in** as the AI Agent itself via Okta Authorization Code + PKCE, authenticated with a `private_key_jwt` client assertion signed by the agent's own private key — no separate Web app client, no client secret.
2. The dashboard lists all 7 customer tools with a pre-filled, editable JSON argument box per tool.
3. Clicking **Run** plays the role of **the AI agent**: it runs the two-step [ID-JAG](https://datatracker.ietf.org/doc/html/draft-parecki-oauth-identity-assertion-authz-grant) exchange — your login token → an ID-JAG (at the org token endpoint, authenticated as the agent via a JWT client assertion) → a scoped access token (at this Custom Authorization Server's own token endpoint) — then calls `/mcp` with that token and shows a formatted rendering of the result, with the raw JSON-RPC response available behind a toggle. The end-user access token and the MCP server access token sit in a right-hand pane, each with decoded claims one click away.

Additional env vars needed for the tester UI: `OKTA_AI_AGENT_ID`, `OKTA_AI_AGENT_PRIVATE_KEY` (see `.env.example` for the full list and what each one does). The Custom Authorization Server needs a `customer:write` scope granted to the AI agent's access policy for `add_customer`/`delete_customer` to work.

If a step fails, the error page shows the raw error from whichever endpoint rejected the request — usually enough to tell which policy or config is the problem (e.g. `no_matching_policy` means the logged-in user isn't authorized for the customer scopes).
