import type { Request } from 'express';
import { publicBaseUrl } from '../oauth.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Standalone default. Mounted alongside the MCP endpoint, both come from the request. */
  redirectUri: process.env.REDIRECT_URI ?? `http://localhost:${Number(process.env.PORT ?? 3000)}/callback`,

  oktaDomain: () => required('OKTA_DOMAIN').replace(/\/$/, ''),
  clientId: () => required('OKTA_CLIENT_ID'),
  clientSecret: () => required('OKTA_CLIENT_SECRET'),
  /** Optional — if unset, ID-JAG step 1 goes to the org-level token endpoint (https://{domain}/oauth2/v1/token). */
  mainAuthServerId: () => process.env.OKTA_MAIN_AUTH_SERVER_ID || undefined,
  /**
   * Issuer the human login runs against. `OKTA_ISSUER` wins — set it to a full
   * issuer URL, either the org issuer (`https://{domain}`) or a Custom
   * Authorization Server's (`https://{domain}/oauth2/{ausId}`), and /authorize
   * and /token are derived from it. Otherwise it falls back to
   * `OKTA_MAIN_AUTH_SERVER_ID`, then to the org issuer, so leaving it unset
   * behaves exactly as before.
   *
   * Note the ID-JAG exchange still runs at the org (or main) authorization
   * server — Okta issues ID-JAGs there, not at the customer Custom AS. Point
   * OKTA_ISSUER at a Custom AS and the login token may not be accepted as the
   * exchange's subject token; keep both on the same AS if you hit that.
   */
  loginIssuer: (): string => {
    const explicit = process.env.OKTA_ISSUER?.replace(/\/$/, '');
    if (explicit) return explicit;
    const domain = required('OKTA_DOMAIN').replace(/\/$/, '');
    const mainAuthServerId = process.env.OKTA_MAIN_AUTH_SERVER_ID;
    return mainAuthServerId ? `${domain}/oauth2/${mainAuthServerId}` : domain;
  },

  agentId: () => required('OKTA_AI_AGENT_ID'),
  agentPrivateJwk: () => JSON.parse(required('OKTA_AI_AGENT_PRIVATE_KEY')),
  /**
   * RFC 8707 resource indicator sent with the human login — the *agent's*
   * resource URL. It audience-binds the access token the user gets back to the
   * agent that will run the ID-JAG exchange on their behalf, so that token's
   * `aud` is the agent rather than Okta's own API. Optional: when unset the
   * `resource` parameter is left off /authorize and /token entirely.
   */
  agentAudience: () => process.env.OKTA_AI_AGENT_AUDIENCE || undefined,
  /**
   * Which of the user's login tokens is presented as the ID-JAG subject token.
   * Okta accepts either urn:...:token-type:id_token or :access_token. Defaults
   * to the access token once it is audience-bound to the agent (above), else
   * the ID token. Set OKTA_ID_JAG_SUBJECT_TOKEN to force one.
   */
  idJagSubjectTokenType: (): 'id_token' | 'access_token' => {
    const override = process.env.OKTA_ID_JAG_SUBJECT_TOKEN;
    if (override === 'id_token' || override === 'access_token') return override;
    return process.env.OKTA_AI_AGENT_AUDIENCE ? 'access_token' : 'id_token';
  },

  customerAuthServerId: () => required('OKTA_CUSTOMER_AUTH_SERVER_ID'),
  customerAudience: () => required('OKTA_CUSTOMER_AUDIENCE'),
};

/**
 * An OAuth endpoint on an issuer. A Custom Authorization Server's issuer already
 * carries `/oauth2/{ausId}`, so its endpoints hang straight off it; the org
 * issuer is the bare domain, whose endpoints live under `/oauth2/v1`.
 */
export function issuerEndpoint(issuer: string, endpoint: 'authorize' | 'token'): string {
  return issuer.includes('/oauth2/') ? `${issuer}/v1/${endpoint}` : `${issuer}/oauth2/v1/${endpoint}`;
}

/**
 * Where Okta should send the user back to. An explicit REDIRECT_URI always
 * wins — it has to match the Okta app registration character for character.
 * Otherwise it's derived from the request, so no extra URL config is needed
 * for local dev or a single-service deployment.
 */
export function resolveRedirectUri(req: Request): string {
  if (process.env.REDIRECT_URI) return process.env.REDIRECT_URI;
  return `${publicBaseUrl(req)}/callback`;
}

/** Origin the MCP endpoint is on — this same process, since there's only one. */
export function resolveMcpBaseUrl(req: Request): string {
  return publicBaseUrl(req);
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Display-only — the exchange always requests the full customer scope set, not just this one. */
  scope: string;
  mutates: boolean;
  defaultArguments: Record<string, unknown>;
}

export const CUSTOMER_SCOPES = ['customer:read', 'customer:lookup', 'customer:history', 'customer:write'];

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_customer',
    description: 'Get a customer account by ID.',
    scope: 'customer:read',
    mutates: false,
    defaultArguments: { customerId: 'CUST-001' },
  },
  {
    name: 'search_customers',
    description: 'Search customers by name, contact, or location.',
    scope: 'customer:lookup',
    mutates: false,
    defaultArguments: { query: 'State' },
  },
  {
    name: 'get_customers_by_tier',
    description: 'List customers in a loyalty tier.',
    scope: 'customer:lookup',
    mutates: false,
    defaultArguments: { tier: 'Gold' },
  },
  {
    name: 'get_top_customers',
    description: 'List the top customers by lifetime spend.',
    scope: 'customer:history',
    mutates: false,
    defaultArguments: { limit: 10 },
  },
  {
    name: 'get_customer_summary',
    description: 'Aggregate customer summary by tier.',
    scope: 'customer:history',
    mutates: false,
    defaultArguments: {},
  },
  {
    name: 'add_customer',
    description: 'Add a new customer account.',
    scope: 'customer:write',
    mutates: true,
    defaultArguments: {
      name: 'Test Customer',
      contact: 'Jane Doe',
      email: 'jane@example.com',
      tier: 'Silver',
      location: 'Columbus, OH',
      total_spent: 0,
    },
  },
  {
    name: 'delete_customer',
    description: 'Remove a customer account.',
    scope: 'customer:write',
    mutates: true,
    defaultArguments: { customerId: 'CUST-035' },
  },
];
