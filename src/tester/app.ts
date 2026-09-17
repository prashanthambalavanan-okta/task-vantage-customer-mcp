import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import { decodeJwt } from 'jose';
import {
  config,
  CUSTOMER_SCOPES,
  TOOLS,
  issuerEndpoint,
  resolveMcpBaseUrl,
  resolveRedirectUri,
} from './config.js';
import { exchangeUserTokenForDomainAccessToken, postForm, signClientAssertion } from './idJag.js';
import { callMcpTool } from './mcpClient.js';
import { generatePkce, randomState } from './pkce.js';
import { dashboardPage, errorPage, loginPage, resultPage } from './views.js';

/** Access tokens are not guaranteed to be JWTs — show what we can, never throw. */
function safeDecodeJwt(token: string): Record<string, unknown> | undefined {
  try {
    return decodeJwt(token) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

interface Session {
  idToken: string;
  claims: Record<string, unknown>;
  /** The user's access token from the same login — `aud` is the agent when `resource` was sent. */
  userAccessToken?: string;
  userAccessClaims?: Record<string, unknown>;
}

export function createTesterApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  // Short-lived, in-memory only — this app never persists anything to disk.
  const pendingLogins = new Map<string, { verifier: string }>();
  const sessions = new Map<string, Session>();

  app.get('/', (req, res) => {
    const sid = req.cookies?.sid;
    const session = sid ? sessions.get(sid) : undefined;
    if (!session) {
      res.send(loginPage());
      return;
    }
    res.send(dashboardPage(session.claims, TOOLS));
  });

  app.get('/login', (req, res) => {
    const { verifier, challenge } = generatePkce();
    const state = randomState();
    pendingLogins.set(state, { verifier });

    const params: Record<string, string> = {
      client_id: config.agentId(),
      response_type: 'code',
      scope: 'openid profile email',
      redirect_uri: resolveRedirectUri(req),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    };
    // RFC 8707: ask for an access token audience-bound to the agent that will
    // later exchange it for an ID-JAG. Must be sent on both /authorize and
    // /token — Okta pins the audience at consent and re-checks it at exchange.
    const resource = config.agentAudience();
    if (resource) params.resource = resource;

    const authorizeUrl = new URL(issuerEndpoint(config.loginIssuer(), 'authorize'));
    authorizeUrl.search = new URLSearchParams(params).toString();

    res.redirect(authorizeUrl.toString());
  });

  app.get('/callback', async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const pending = state ? pendingLogins.get(state) : undefined;

    if (!code || !state || !pending) {
      res.status(400).send(errorPage('login callback', 'Missing or unrecognized state/code'));
      return;
    }
    pendingLogins.delete(state);

    try {
      const tokenEndpoint = issuerEndpoint(config.loginIssuer(), 'token');
      const clientAssertion = await signClientAssertion(config.agentId(), config.agentPrivateJwk(), tokenEndpoint);

      const body: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: resolveRedirectUri(req),
        code_verifier: pending.verifier,
        client_id: config.agentId(),
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion,
      };
      const resource = config.agentAudience();
      if (resource) body.resource = resource;

      const tokenJson = await postForm(tokenEndpoint, body);

      const idToken = tokenJson.id_token as string;
      const claims = decodeJwt(idToken) as Record<string, unknown>;

      // Kept because it is the token that carries the agent as its audience,
      // and (by default, when `resource` is configured) it is what gets
      // presented as the ID-JAG subject token.
      const userAccessToken = tokenJson.access_token as string | undefined;
      const userAccessClaims = userAccessToken ? safeDecodeJwt(userAccessToken) : undefined;

      const sid = randomUUID();
      sessions.set(sid, { idToken, claims, userAccessToken, userAccessClaims });
      res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', secure: req.secure });
      res.redirect('/');
    } catch (err) {
      res.status(500).send(errorPage('exchanging authorization code', err));
    }
  });

  app.get('/logout', (req, res) => {
    const sid = req.cookies?.sid;
    if (sid) sessions.delete(sid);
    res.clearCookie('sid');
    res.redirect('/');
  });

  app.post('/invoke/:tool', async (req, res) => {
    const sid = req.cookies?.sid;
    const session = sid ? sessions.get(sid) : undefined;
    if (!session) {
      res.redirect('/');
      return;
    }

    const tool = TOOLS.find((t) => t.name === req.params.tool);
    if (!tool) {
      res.status(404).send(errorPage('invoke', `Unknown tool: ${req.params.tool}`));
      return;
    }

    let toolArguments: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(req.body.arguments ?? '{}'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Arguments must be a JSON object.');
      }
      toolArguments = parsed;
    } catch (err) {
      res.status(400).send(errorPage(`parsing arguments for ${tool.name}`, err));
      return;
    }

    // Which login token starts the ID-JAG chain. In access_token mode it is the
    // one audience-bound to the agent by the `resource` parameter on login.
    const subjectTokenType = config.idJagSubjectTokenType();
    const subjectToken = subjectTokenType === 'access_token' ? session.userAccessToken : session.idToken;
    if (!subjectToken) {
      res
        .status(500)
        .send(
          errorPage(
            'selecting the ID-JAG subject token',
            'Configured to use the access token as the ID-JAG subject token, but the login did not return one. ' +
              'Log out and back in, or set OKTA_ID_JAG_SUBJECT_TOKEN=id_token.',
          ),
        );
      return;
    }

    try {
      const { accessToken } = await exchangeUserTokenForDomainAccessToken({
        oktaDomain: config.oktaDomain(),
        mainAuthServerId: config.mainAuthServerId(),
        domainAuthServerId: config.customerAuthServerId(),
        subjectToken,
        subjectTokenType,
        scope: CUSTOMER_SCOPES.join(' '),
        agentId: config.agentId(),
        agentPrivateJwk: config.agentPrivateJwk(),
      });

      const rawResponse = await callMcpTool({
        mcpUrl: `${resolveMcpBaseUrl(req)}/mcp`,
        accessToken: accessToken.accessToken,
        toolName: tool.name,
        toolArguments,
      });

      const expectedAudience = config.customerAudience();
      const actualAudience = accessToken.accessClaims.aud;

      res.send(
        resultPage({
          toolName: tool.name,
          toolArguments,
          userAccessToken: session.userAccessToken,
          userAccessClaims: session.userAccessClaims,
          domainAccessToken: accessToken.accessToken,
          accessClaims: accessToken.accessClaims,
          audienceCheck: {
            expected: expectedAudience,
            actual: actualAudience,
            match: actualAudience === expectedAudience,
          },
          rawResponse,
        }),
      );
    } catch (err) {
      res.status(502).send(errorPage(`ID-JAG exchange / tool call for ${tool.name}`, err));
    }
  });

  return app;
}
