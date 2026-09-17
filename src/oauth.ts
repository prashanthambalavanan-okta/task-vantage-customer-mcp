import type { Express, Request, Response } from 'express';

/** The MCP endpoint described as an OAuth 2.0 protected resource (RFC 9728). */
export interface ProtectedResourceMetadata {
  /** Path of the MCP endpoint this describes, e.g. '/mcp'. */
  resourcePath: string;
  /** Issuer of the Okta Custom Authorization Server that mints tokens for it. */
  issuer?: string;
  /** Scopes this endpoint's tools require — clients request these during authorization. */
  scopes?: string[];
  resourceName?: string;
  documentationUrl?: string;
}

/**
 * The externally reachable origin. Derived from the request so the same build
 * works locally and on Render; behind a proxy `req.protocol` only reports
 * https once `app.set('trust proxy', ...)` is on. PUBLIC_BASE_URL overrides it
 * for deployments that rewrite the Host header.
 */
export function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/** Path-scoped metadata URL for an MCP endpoint (RFC 9728 §3.1). */
export function resourceMetadataUrl(req: Request, resourcePath: string): string {
  return `${publicBaseUrl(req)}/.well-known/oauth-protected-resource${resourcePath}`;
}

/** Discovery documents are public and get fetched cross-origin by browser-hosted clients. */
function allowCors(res: Response): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
}

/**
 * Mounts GET /.well-known/oauth-protected-resource<resourcePath> for the MCP
 * endpoint. An MCP client reads this to learn which authorization server to run
 * its OAuth flow against — without it clients assume the MCP host is itself the
 * authorization server and never obtain a token.
 *
 * Must be mounted on the ROOT app.
 */
export function mountProtectedResourceMetadata(
  app: Express,
  resources: ProtectedResourceMetadata[],
): void {
  for (const resource of resources) {
    const path = `/.well-known/oauth-protected-resource${resource.resourcePath}`;

    app.options(path, (_req, res) => {
      allowCors(res);
      res.sendStatus(204);
    });

    app.get(path, (req, res) => {
      allowCors(res);
      res.json({
        resource: `${publicBaseUrl(req)}${resource.resourcePath}`,
        ...(resource.issuer ? { authorization_servers: [resource.issuer] } : {}),
        ...(resource.scopes?.length ? { scopes_supported: resource.scopes } : {}),
        bearer_methods_supported: ['header'],
        ...(resource.resourceName ? { resource_name: resource.resourceName } : {}),
        ...(resource.documentationUrl ? { resource_documentation: resource.documentationUrl } : {}),
      });
    });
  }
}
