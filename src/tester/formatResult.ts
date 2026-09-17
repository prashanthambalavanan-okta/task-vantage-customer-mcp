import { escapeHtml } from './htmlEscape.js';
import type { JsonRpcToolCallResponse } from './mcpClient.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '<em>null</em>';

  if (Array.isArray(value)) {
    if (value.length === 0) return '<em>empty list</em>';

    if (value.every(isPlainObject)) {
      const rows = value as Record<string, unknown>[];
      const keys: string[] = [];
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (!keys.includes(key)) keys.push(key);
        }
      }
      const head = keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${keys.map((k) => `<td>${k in row ? renderValue(row[k]) : ''}</td>`).join('')}</tr>`)
        .join('');
      return `<table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    if (value.every((v) => !isPlainObject(v) && !Array.isArray(v))) {
      return `<ul>${value.map((v) => `<li>${renderValue(v)}</li>`).join('')}</ul>`;
    }

    return `<ol>${value.map((v) => `<li>${renderValue(v)}</li>`).join('')}</ol>`;
  }

  if (isPlainObject(value)) {
    const rows = Object.entries(value)
      .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${renderValue(v)}</td></tr>`)
      .join('');
    return `<table class="kv">${rows}</table>`;
  }

  return escapeHtml(String(value));
}

function errorBlock(message: string): string {
  return `<div class="result-error">${escapeHtml(message)}</div>`;
}

/** Renders an MCP tools/call JSON-RPC response as formatted HTML — no LLM, pure structural mapping. */
export function formatMcpResult(raw: JsonRpcToolCallResponse): string {
  if (raw.error) {
    return errorBlock(`${raw.error.message} (code ${raw.error.code})`);
  }

  const content = raw.result?.content;
  if (!content || content.length === 0) {
    return `<pre>${escapeHtml(JSON.stringify(raw.result ?? {}, null, 2))}</pre>`;
  }

  const blocks = content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => {
      const text = block.text as string;
      try {
        const parsed = JSON.parse(text);
        return `<div class="content-block">${renderValue(parsed)}</div>`;
      } catch {
        return `<div class="content-block"><pre>${escapeHtml(text)}</pre></div>`;
      }
    })
    .join('');

  return raw.result?.isError ? `${errorBlock('Tool reported an error:')}${blocks}` : blocks;
}
