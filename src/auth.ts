import { AsyncLocalStorage } from 'node:async_hooks';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { resourceMetadataUrl } from './oauth.js';

interface AuthContext {
  payload: JWTPayload;
  scopes: string[];
}

export interface AuthOptions {
  /** Full issuer URL. Takes precedence over domain/authServerId. */
  issuer?: string;
  /** Okta org domain, e.g. https://your-org.okta.com — combined with authServerId if issuer isn't set. */
  domain?: string;
  /** Custom Authorization Server ID for this domain. */
  authServerId?: string;
  audience?: string;
  /**
   * Path of the MCP endpoint this middleware guards, e.g. '/mcp'.
   * Set it so 401s carry a WWW-Authenticate challenge pointing at the matching
   * protected-resource metadata — that pointer is how an MCP client discovers
   * which Okta Custom Authorization Server to authenticate against.
   */
  resourcePath?: string;
  /** Skip token validation entirely and grant every scope — local dev only. */
  allowInsecure?: boolean;
}

const authStorage = new AsyncLocalStorage<AuthContext>();

function scopesOf(payload: JWTPayload): string[] {
  const scp = (payload as Record<string, unknown>).scp;
  if (Array.isArray(scp)) return scp as string[];
  if (typeof payload.scope === 'string') return payload.scope.split(' ').filter(Boolean);
  return [];
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function getJwks(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/v1/keys`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

/**
 * Resolves an issuer from explicit options, falling back to env vars
 * (OKTA_ISSUER, or OKTA_DOMAIN + OKTA_AUTH_SERVER_ID) — matches the Okta
 * Custom Authorization Server naming already used elsewhere (e.g.
 * OKTA_CUSTOMER_AUTH_SERVER_ID — pass that value as `authServerId`).
 */
function resolveIssuer(opts: AuthOptions): string | undefined {
  if (opts.issuer) return opts.issuer;
  if (opts.domain && opts.authServerId) {
    return `${opts.domain.replace(/\/$/, '')}/oauth2/${opts.authServerId}`;
  }
  if (process.env.OKTA_ISSUER) return process.env.OKTA_ISSUER;
  const domain = process.env.OKTA_DOMAIN;
  const authServerId = process.env.OKTA_AUTH_SERVER_ID;
  if (domain && authServerId) return `${domain.replace(/\/$/, '')}/oauth2/${authServerId}`;
  return undefined;
}

/**
 * Builds an RFC 6750 challenge for a 401. The resource_metadata parameter is
 * the one MCP clients act on: it tells them where this endpoint's
 * protected-resource metadata lives, and from there which authorization server
 * to use. Quotes and backslashes are stripped since header values can't escape.
 */
function challenge(
  req: Request,
  resourcePath: string | undefined,
  params: Record<string, string> = {},
): string {
  const all = { ...params };
  if (resourcePath) all.resource_metadata = resourceMetadataUrl(req, resourcePath);
  const parts = Object.entries(all).map(([k, v]) => `${k}="${v.replace(/["\\]/g, '')}"`);
  return parts.length ? `Bearer ${parts.join(', ')}` : 'Bearer';
}

/**
 * Express middleware: validates the Okta access token (signature, issuer,
 * audience) for every request to /mcp and makes its granted scopes
 * available to tool handlers via `assertScope`/`hasScope`.
 *
 * Omit `issuer`/`domain`+`authServerId`/`audience` to fall back to
 * OKTA_ISSUER / OKTA_DOMAIN+OKTA_AUTH_SERVER_ID / OKTA_AUDIENCE env vars.
 *
 * Set allowInsecure (or ALLOW_INSECURE=true) only for local dev without an
 * Okta org configured — it grants every scope with no token check.
 */
export function bearerAuth(opts: AuthOptions = {}) {
  const issuer = resolveIssuer(opts);
  const audience = opts.audience ?? process.env.OKTA_AUDIENCE;
  const allowInsecure = opts.allowInsecure ?? process.env.ALLOW_INSECURE === 'true';

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!issuer || !audience) {
      if (allowInsecure) {
        console.warn('[auth] Okta issuer/audience not set — ALLOW_INSECURE bypass is active');
        authStorage.run({ payload: {}, scopes: ['*'] }, next);
        return;
      }
      res.status(500).json({
        error: 'Server misconfigured: set audience and either issuer or domain + authServerId',
      });
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      // No credentials presented: bare challenge, no error param (RFC 6750 §3).
      res.set('WWW-Authenticate', challenge(req, opts.resourcePath));
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    try {
      const { payload } = await jwtVerify(header.slice('Bearer '.length), getJwks(issuer), {
        issuer,
        audience,
      });
      authStorage.run({ payload, scopes: scopesOf(payload) }, next);
    } catch (err) {
      const detail = (err as Error).message;
      res.set(
        'WWW-Authenticate',
        challenge(req, opts.resourcePath, { error: 'invalid_token', error_description: detail }),
      );
      res.status(401).json({ error: 'Invalid token', detail });
    }
  };
}

export function currentScopes(): string[] {
  return authStorage.getStore()?.scopes ?? [];
}

export function hasScope(scope: string): boolean {
  const scopes = currentScopes();
  return scopes.includes('*') || scopes.includes(scope);
}

/** Call at the top of every tool handler to enforce its required scope. */
export function assertScope(scope: string): { ok: true } | { ok: false; message: string } {
  if (hasScope(scope)) return { ok: true };
  const granted = currentScopes().join(', ') || 'none';
  return { ok: false, message: `Missing required scope: ${scope} (granted: ${granted})` };
}
