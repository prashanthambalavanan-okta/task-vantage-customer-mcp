/** Thrown for any non-2xx response from an OAuth token endpoint or the MCP server — carries enough
 *  structure (endpoint, status, parsed body) to render a friendly message instead of a stack trace. */
export class UpstreamHttpError extends Error {
  readonly endpoint: string;
  readonly status: number;
  readonly body: unknown;

  constructor(endpoint: string, status: number, body: unknown) {
    super(`Request to ${endpoint} failed (${status}): ${JSON.stringify(body)}`);
    this.name = 'UpstreamHttpError';
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
  }

  /** OAuth-style `{error, error_description}` body, if the upstream returned one. */
  get oauthError(): { error: string; description?: string } | undefined {
    if (this.body && typeof this.body === 'object' && !Array.isArray(this.body)) {
      const b = this.body as Record<string, unknown>;
      if (typeof b.error === 'string') {
        return {
          error: b.error,
          description: typeof b.error_description === 'string' ? b.error_description : undefined,
        };
      }
    }
    return undefined;
  }
}
