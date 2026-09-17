import { CUSTOMER_SCOPES, type ToolSpec } from './config.js';
import { formatMcpResult } from './formatResult.js';
import { escapeHtml } from './htmlEscape.js';
import { UpstreamHttpError } from './httpError.js';
import type { JsonRpcToolCallResponse } from './mcpClient.js';

function json(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function page(title: string, body: string, opts: { centered?: boolean } = {}): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0b0e14;
      --surface: #12161f;
      --surface-2: #191f2c;
      --border: #262e3d;
      --text: #e7ebf3;
      --text-dim: #9aa4b8;
      --accent: #5b8cff;
      --accent-dim: #2a3d6b;
      --green: #3ecf8e;
      --green-dim: #163a2b;
      --amber: #f5a623;
      --amber-dim: #3a2c10;
      --red: #f26d6d;
      --red-dim: #3a1a1a;
      --radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top, #131826 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
    }
    .container { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }
    /* Login: one card, centred in the viewport. */
    .container-center {
      max-width: none;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    a { color: var(--accent); }
    h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); margin: 0 0 12px; }
    p.lede { color: var(--text-dim); max-width: 640px; line-height: 1.5; }
    .topbar { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 32px; flex-wrap: wrap; gap: 8px; }
    .topbar .who { color: var(--text-dim); font-size: 14px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px;
    }
    .login-card { width: 100%; max-width: 480px; padding: 40px 36px; text-align: center; }
    .login-card h1 { font-size: 28px; margin-bottom: 12px; }
    .login-card p.lede { max-width: none; margin: 0 0 28px; font-size: 14px; }
    a.button, button {
      display: inline-block;
      padding: 9px 16px;
      background: var(--accent);
      color: #0b0e14;
      text-decoration: none;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    a.button:hover, button:hover { filter: brightness(1.08); }
    a.link-muted { color: var(--text-dim); font-size: 13px; text-decoration: none; }
    a.link-muted:hover { color: var(--text); }

    .copy-row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    button.btn-secondary {
      background: var(--surface-2);
      color: var(--text-dim);
      border: 1px solid var(--border);
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
    }
    button.btn-secondary:hover { color: var(--text); filter: none; border-color: var(--accent); }

    .domain-section { margin-bottom: 40px; }
    .domain-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
    .domain-header h2 { margin: 0; }
    .domain-scopes { display: flex; gap: 6px; flex-wrap: wrap; }

    .pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      letter-spacing: 0.02em;
    }
    .pill-scope { background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border); font-weight: 500; }
    .pill-read { background: var(--green-dim); color: var(--green); }
    .pill-mutate { background: var(--amber-dim); color: var(--amber); }
    .pill-error { background: var(--red-dim); color: var(--red); }
    .pill-match { background: var(--green-dim); color: var(--green); }
    .pill-mismatch { background: var(--red-dim); color: var(--red); }

    .hint { color: var(--text-dim); font-size: 13px; }

    /* Result page: result on the left, tokens pinned on the right. Collapses to
       one column on narrow viewports, tokens last. */
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; align-items: start; }
    .side { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 12px; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: minmax(0, 1fr); }
      .side { position: static; }
    }

    .token-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 18px;
    }
    .token-name { font-size: 13px; font-weight: 600; }
    .token-meta { color: var(--text-dim); font-size: 12px; margin: 4px 0 10px; line-height: 1.45; }
    .token-meta code { word-break: break-all; }

    /* The compact JWT itself. Long and unbreakable, so: break anywhere, and
       cap the height rather than letting one token push the page down. */
    .token-raw {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.55;
      color: var(--text-dim);
      word-break: break-all;
      max-height: 150px;
      overflow-y: auto;
      user-select: all;
    }

    /* One collapsed row per tool, stacked. Summary = name + description;
       expanding reveals the arguments editor and Run. */
    .tool-list { display: flex; flex-direction: column; gap: 8px; }
    .tool-row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .tool-row[open] { border-color: var(--accent-dim); }
    .tool-row > summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 12px;
      padding: 14px 18px;
      margin: 0;
      color: var(--text);
      font-size: 14px;
      border-radius: 10px;
    }
    /* Beats the generic details[open] > summary rule further down. */
    .tool-row[open] > summary { margin: 0; }
    .tool-row > summary::-webkit-details-marker { display: none; }
    .tool-row > summary:hover { background: var(--surface-2); }
    .tool-row > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .tool-row .chevron { color: var(--text-dim); flex: none; font-size: 11px; transition: transform 0.15s ease; }
    .tool-row[open] .chevron { transform: rotate(90deg); }
    .tool-row .tool-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; flex: none; }
    .tool-row .tool-desc { color: var(--text-dim); font-size: 13px; flex: 1 1 220px; min-width: 0; }
    .tool-row .badges { display: flex; gap: 6px; flex: none; }
    .tool-body { padding: 16px 18px 18px; border-top: 1px solid var(--border); }
    .tool-body label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
    .tool-body textarea {
      width: 100%;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 10px;
      resize: vertical;
    }
    .tool-body form { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }

    pre {
      background: var(--surface-2);
      border: 1px solid var(--border);
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      margin: 0;
    }
    .error pre { border-color: var(--red); color: var(--red); }
    .result-error {
      background: var(--red-dim);
      color: var(--red);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 10px;
    }

    table.result-table, table.kv { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.result-table th, table.result-table td, table.kv th, table.kv td {
      border-bottom: 1px solid var(--border);
      padding: 7px 10px;
      text-align: left;
      vertical-align: top;
    }
    table.result-table th { color: var(--text-dim); font-weight: 600; font-size: 12px; }
    table.kv th { color: var(--text-dim); font-weight: 500; width: 30%; white-space: nowrap; }
    table.kv, table.result-table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }

    .step { border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; margin: 14px 0; background: var(--surface); }
    .step-title { font-size: 14px; font-weight: 600; margin: 0 0 10px; }
    details > summary { cursor: pointer; color: var(--accent); font-size: 13px; margin-top: 10px; }
    details[open] > summary { margin-bottom: 10px; }

    .foot-nav { margin-top: 32px; display: flex; gap: 16px; }
  </style>
</head>
<body>
  <div class="container${opts.centered ? ' container-center' : ''}">${body}</div>
  <script>
    function copyText(id, btn) {
      var el = document.getElementById(id);
      if (!el) return;
      var original = btn.textContent;
      navigator.clipboard.writeText(el.value).then(function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = original; }, 1200);
      }, function () {
        btn.textContent = 'Copy failed';
        setTimeout(function () { btn.textContent = original; }, 1200);
      });
    }
  </script>
</body>
</html>`;
}

/** Hidden source textareas + copy buttons for a token's raw compact form and its decoded claims. */
function copyRow(idPrefix: string, rawToken: string, decodedClaims: unknown): string {
  const rawId = `${idPrefix}-raw`;
  const decodedId = `${idPrefix}-decoded`;
  return `<div class="copy-row">
    <textarea id="${rawId}" hidden>${escapeHtml(rawToken)}</textarea>
    <textarea id="${decodedId}" hidden>${escapeHtml(JSON.stringify(decodedClaims, null, 2))}</textarea>
    <button type="button" class="btn-secondary" onclick="copyText('${rawId}', this)">Copy raw token</button>
    <button type="button" class="btn-secondary" onclick="copyText('${decodedId}', this)">Copy decoded</button>
  </div>`;
}

/** One sidebar card: what the token is, the compact string itself, copy buttons, claims on demand. */
function tokenCard(opts: {
  idPrefix: string;
  name: string;
  /** Trusted HTML — callers escape any interpolated values themselves. */
  meta: string;
  rawToken: string;
  claims: unknown;
}): string {
  return `<div class="token-card">
    <div class="token-name">${escapeHtml(opts.name)}</div>
    <p class="token-meta">${opts.meta}</p>
    <div class="token-raw">${escapeHtml(opts.rawToken)}</div>
    ${copyRow(opts.idPrefix, opts.rawToken, opts.claims ?? null)}
    ${opts.claims ? `<details><summary>Decoded claims</summary><pre>${json(opts.claims)}</pre></details>` : ''}
  </div>`;
}

export function loginPage(): string {
  return page(
    'Task Vantage Customer MCP',
    `<div class="card login-card">
       <h1>Task Vantage Customer MCP</h1>
       <p class="lede">Sign in, then run any customer tool against the live MCP server. Each run performs the real Identity Assertion Authorization Grant (ID-JAG) exchange — your ID token → an ID-JAG → a scoped access token — then calls that tool. No LLM in the loop: every tool maps directly to its arguments and its response.</p>
       <a class="button" href="/login">Sign in with Okta</a>
     </div>`,
    { centered: true },
  );
}

/** A collapsed row: name + description in the summary, arguments editor + Run once expanded. */
function toolRow(tool: ToolSpec): string {
  const badge = tool.mutates ? '<span class="pill pill-mutate">Mutates</span>' : '<span class="pill pill-read">Read-only</span>';
  const args = escapeHtml(JSON.stringify(tool.defaultArguments, null, 2));
  const rows = Math.min(12, Math.max(3, args.split('\n').length));
  return `<details class="tool-row">
    <summary>
      <span class="chevron">▶</span>
      <span class="tool-name">${escapeHtml(tool.name)}</span>
      <span class="tool-desc">${escapeHtml(tool.description)}</span>
      <span class="badges">
        <span class="pill pill-scope">${escapeHtml(tool.scope)}</span>
        ${badge}
      </span>
    </summary>
    <div class="tool-body">
      <form method="post" action="/invoke/${encodeURIComponent(tool.name)}">
        <label>Arguments (JSON)</label>
        <textarea name="arguments" rows="${rows}" spellcheck="false">${args}</textarea>
        <button type="submit">Run</button>
      </form>
    </div>
  </details>`;
}

export function dashboardPage(user: { sub?: string; email?: string; name?: string }, tools: ToolSpec[]): string {
  const section = `<section class="domain-section">
        <div class="domain-header">
          <h2>Customer</h2>
          <div class="domain-scopes">${CUSTOMER_SCOPES.map((s) => `<span class="pill pill-scope">${escapeHtml(s)}</span>`).join('')}</div>
        </div>
        <div class="tool-list">${tools.map((t) => toolRow(t)).join('')}</div>
      </section>`;

  return page(
    'Task Vantage Customer MCP',
    `<div class="topbar">
       <h1>Task Vantage Customer MCP</h1>
       <div class="who">Signed in as ${escapeHtml(user.name ?? user.email ?? user.sub ?? 'unknown')} — <a class="link-muted" href="/logout">Sign out</a></div>
     </div>
     <p class="lede">Pick any tool below. Edit its arguments if you like, then Run — each click performs the full ID-JAG exchange and calls the tool on the live server.</p>
     ${section}`,
  );
}

export function resultPage(opts: {
  toolName: string;
  toolArguments: unknown;
  /** The access token from the human login, when Okta returned one. */
  userAccessToken?: string;
  userAccessClaims?: unknown;
  domainAccessToken: string;
  accessClaims: unknown;
  audienceCheck: { expected: string; actual: unknown; match: boolean };
  rawResponse: JsonRpcToolCallResponse;
}): string {
  const userTokenCard = opts.userAccessToken
    ? tokenCard({
        idPrefix: 'useraccess',
        name: 'End user access token',
        meta: 'From your Okta login. Exchanged by the agent for the token below.',
        rawToken: opts.userAccessToken,
        claims: opts.userAccessClaims,
      })
    : `<div class="token-card">
         <div class="token-name">End user access token</div>
         <p class="token-meta">The login did not return one — the ID token was used to start the exchange instead.</p>
       </div>`;

  // Only worth the reader's attention when it's wrong; a matching audience is
  // the expected case and doesn't need saying.
  const audienceNote = opts.audienceCheck.match
    ? `Audience <code>${escapeHtml(opts.audienceCheck.expected)}</code>.`
    : `<span class="pill pill-mismatch">AUDIENCE MISMATCH</span> expected <code>${escapeHtml(opts.audienceCheck.expected)}</code>,
       got <code>${escapeHtml(JSON.stringify(opts.audienceCheck.actual))}</code>.`;

  return page(
    'Task Vantage Customer MCP — result',
    `<h1>${escapeHtml(opts.toolName)}</h1>

     <div class="layout">
       <div>
         <div class="step">
           <p><code>${escapeHtml(opts.toolName)}(${escapeHtml(JSON.stringify(opts.toolArguments))})</code></p>
           ${formatMcpResult(opts.rawResponse)}
           <details>
             <summary>Show raw JSON-RPC response</summary>
             <pre>${json(opts.rawResponse)}</pre>
           </details>
         </div>
         <div class="foot-nav"><a href="/">Back to dashboard</a></div>
       </div>

       <aside class="side">
         ${userTokenCard}
         ${tokenCard({
           idPrefix: 'access',
           name: 'MCP server access token',
           meta: `Bearer token sent to <code>/mcp</code>. ${audienceNote}`,
           rawToken: opts.domainAccessToken,
           claims: opts.accessClaims,
         })}
       </aside>
     </div>`,
  );
}

const OAUTH_ERROR_TITLES: Record<string, string> = {
  access_denied: 'Access denied by policy',
  invalid_grant: 'Invalid or expired grant',
  invalid_scope: 'Scope not granted',
  invalid_client: 'Client authentication failed',
  unauthorized_client: 'Client not authorized for this grant',
};

export function errorPage(step: string, error: unknown): string {
  if (error instanceof UpstreamHttpError) {
    const oauth = error.oauthError;
    const title = oauth ? OAUTH_ERROR_TITLES[oauth.error] ?? `Rejected: ${oauth.error}` : `Request failed`;

    return page(
      'Task Vantage Customer MCP — error',
      `<div class="card error">
         <h1>${escapeHtml(title)}</h1>
         <p class="lede">While ${escapeHtml(step)}, <code>${escapeHtml(error.endpoint)}</code> returned
           <span class="pill pill-error">${error.status}</span>.</p>
         ${oauth ? `<p>${escapeHtml(oauth.error)}${oauth.description ? ' — ' + escapeHtml(oauth.description) : ''}</p>` : ''}
         <details>
           <summary>Show raw response</summary>
           <pre>${json(error.body)}</pre>
         </details>
       </div>
       <div class="foot-nav"><a href="/">Back to dashboard</a></div>`,
    );
  }

  return page(
    'Task Vantage Customer MCP — error',
    `<div class="card error">
       <h1>Failed at: ${escapeHtml(step)}</h1>
       <pre>${escapeHtml(error instanceof Error ? error.stack ?? error.message : String(error))}</pre>
     </div>
     <div class="foot-nav"><a href="/">Back to dashboard</a></div>`,
  );
}
