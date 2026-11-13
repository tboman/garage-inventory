// The Poppy endpoints for hunapuka.com, as one request handler:
//
//   discovery      /.well-known/poppy.json, oauth-protected-resource,
//                  oauth-authorization-server, /api/openapi.json
//   sign-in        /oauth/request and /oauth/decision back the consent page the
//                  web app serves at /oauth/authorize; /oauth/token, /oauth/revoke
//   account        /oauth/connections lists and disconnects agents for the owner
//   inventory API  /api/v1/items, read only, photos never included
//
// Dependencies are injected so the whole flow can run in tests without
// Firestore, Firebase Auth, or the network.

const { createHash, randomBytes } = require("node:crypto");
const {
  ORIGIN,
  ISSUER,
  PROTOCOL_VERSION,
  SCOPES,
  CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  PATHS,
} = require("./config");
const documents = require("./documents");
const { ClientError, redirectUriAllowed } = require("./clientMetadata");
const { JwtError, sha256url } = require("./jwt");

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const API_SCOPE = "inventory:read";

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const newToken = (prefix) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const isIdentityError = (err) => err instanceof ClientError || err instanceof JwtError;

function send(res, status, body, headers = {}) {
  res.status(status);
  res.set({ "Cache-Control": "no-store", ...headers });
  if (body === undefined) res.end();
  else res.json(body);
}

const oauthError = (res, status, error, description, headers) =>
  send(res, status, { error, error_description: description }, headers);

function parseScope(value) {
  return typeof value === "string" ? value.split(" ").filter(Boolean) : [];
}

function bearerToken(req) {
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(req.get("authorization") || "");
  return match ? match[1] : null;
}

function toIso(value) {
  const ms =
    typeof value === "number" ? value : value && typeof value.toMillis === "function" ? value.toMillis() : null;
  return ms === null ? undefined : new Date(ms).toISOString();
}

// The public shape of an inventory. Built field by field rather than by
// removing fields, so photos, canvas coordinates, and anything added to items
// later stay private unless someone decides to expose them here.
function shapeItems(raw) {
  const byId = new Map(raw.map((item) => [item.id, item]));
  const childCount = new Map();
  for (const item of raw) {
    if (item.locationId) childCount.set(item.locationId, (childCount.get(item.locationId) || 0) + 1);
  }
  const pathOf = (item) => {
    const names = [];
    const seen = new Set([item.id]);
    let parent = byId.get(item.locationId);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(String(parent.name || ""));
      parent = byId.get(parent.locationId);
    }
    return names;
  };
  return raw.map((item) => ({
    id: item.id,
    name: String(item.name || ""),
    description: typeof item.description === "string" ? item.description : "",
    location_id: byId.has(item.locationId) ? item.locationId : null,
    path: pathOf(item),
    child_count: childCount.get(item.id) || 0,
    created_at: toIso(item.createdAt),
  }));
}

function createPoppyHandler({ store, clients, jwt, verifyIdToken, now = Date.now }) {
  // ---- Sign-in: the authorization request -------------------------------

  // Checks an authorization request the way the consent page will act on it.
  // Until client_id and redirect_uri are verified nothing may be sent back to
  // the agent, so those failures are shown to the User instead (`fatal`).
  async function checkAuthorizationRequest(params) {
    const p = params && typeof params === "object" ? params : {};
    const str = (name) => (typeof p[name] === "string" ? p[name] : undefined);

    let client;
    try {
      client = await clients.getClient(str("client_id"));
    } catch (err) {
      if (!isIdentityError(err)) throw err;
      return { fatal: "This agent could not be identified, so it cannot be connected." };
    }
    const redirectUri = str("redirect_uri");
    if (!redirectUriAllowed(client, redirectUri)) {
      return { fatal: "This agent asked to return to an address it has not registered." };
    }

    const state = str("state");
    const back = (extra) => {
      const url = new URL(redirectUri);
      for (const [k, v] of Object.entries({ ...extra, state, iss: ISSUER })) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
      return url.href;
    };
    const refuse = (error, description) => ({
      client,
      redirect: back({ error, error_description: description }),
    });

    if (str("response_type") !== "code") {
      return refuse("unsupported_response_type", "response_type must be code.");
    }
    const scopes = [...new Set(parseScope(str("scope")))];
    if (scopes.length === 0 || scopes.some((s) => !Object.hasOwn(SCOPES, s))) {
      return refuse("invalid_scope", "scope is required and must name supported scopes.");
    }
    const challenge = str("code_challenge");
    if (str("code_challenge_method") !== "S256" || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return refuse("invalid_request", "PKCE with code_challenge_method S256 is required.");
    }
    const resource = str("resource");
    if (resource !== undefined && resource !== ORIGIN) {
      return refuse("invalid_target", "Unknown resource.");
    }
    return { client, redirectUri, scopes, challenge, back };
  }

  // What the consent page needs to show before the User decides.
  async function handleRequestInfo(req, res) {
    const checked = await checkAuthorizationRequest(req.body);
    if (checked.fatal) return send(res, 200, { error: checked.fatal });
    if (checked.redirect) return send(res, 200, { redirect: checked.redirect });
    const { client, scopes } = checked;
    send(res, 200, {
      client: {
        // The agent picks its own name; the domain is what the User can trust.
        name: client.client_name || client.host,
        domain: client.host,
        logo_uri: client.logo_uri,
      },
      scopes: scopes.map((name) => ({ name, ...SCOPES[name] })),
      access_days: Math.round(REFRESH_TOKEN_TTL_MS / 86400000),
    });
  }

  async function signedInUser(req) {
    const token = bearerToken(req);
    if (!token) return null;
    try {
      return await verifyIdToken(token);
    } catch {
      return null;
    }
  }

  // The User's answer. Approval must carry their Firebase ID token in the
  // Authorization header, which a cross-site form cannot attach, so this needs
  // no separate CSRF token. Declining needs no account.
  async function handleDecision(req, res) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const checked = await checkAuthorizationRequest(body.request);
    if (checked.fatal) return send(res, 200, { error: checked.fatal });
    if (checked.redirect) return send(res, 200, { redirect: checked.redirect });
    if (body.approve !== true) {
      return send(res, 200, {
        redirect: checked.back({ error: "access_denied", error_description: "The user declined." }),
      });
    }
    const user = await signedInUser(req);
    if (!user) return oauthError(res, 401, "unauthenticated", "Sign in to approve.");

    const code = newToken("hpc");
    await store.putCode(hashToken(code), {
      uid: user.uid,
      client_id: checked.client.client_id,
      client_name: checked.client.client_name || checked.client.host,
      client_host: checked.client.host,
      redirect_uri: checked.redirectUri,
      scope: checked.scopes.join(" "),
      code_challenge: checked.challenge,
      expires_at: now() + CODE_TTL_MS,
      used: false,
    });
    send(res, 200, { redirect: checked.back({ code }) });
  }

  // ---- Sign-in: the token endpoint --------------------------------------

  async function authenticateClient(req, res) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (body.client_assertion_type !== ASSERTION_TYPE || typeof body.client_assertion !== "string") {
      oauthError(res, 401, "invalid_client", "A private_key_jwt client assertion is required.");
      return null;
    }
    try {
      const clientIdParam = typeof body.client_id === "string" ? body.client_id : undefined;
      return await jwt.verifyClientAssertion(body.client_assertion, clientIdParam);
    } catch (err) {
      if (!isIdentityError(err)) throw err;
      oauthError(res, 401, "invalid_client", err.message);
      return null;
    }
  }

  async function issueAccessToken(grantId, grant, scope) {
    const token = newToken("hpa");
    await store.putAccessToken(hashToken(token), {
      uid: grant.uid,
      client_id: grant.client_id,
      scope,
      grant_id: grantId,
      expires_at: now() + ACCESS_TOKEN_TTL_MS,
    });
    return token;
  }

  async function revokeGrant(grantId) {
    await store.updateGrant(grantId, { revoked: true });
    await store.deleteAccessTokensForGrant(grantId);
  }

  async function exchangeCode(body, client, res) {
    if (typeof body.code !== "string") return oauthError(res, 400, "invalid_request", "code is required.");
    const codeHash = hashToken(body.code);
    const result = await store.consumeCode(codeHash);
    if (result.status === "missing") return oauthError(res, 400, "invalid_grant", "Unknown code.");
    if (result.status === "used") {
      // A code presented twice may have been stolen, so what it bought is revoked.
      if (result.data.grant_id) await revokeGrant(result.data.grant_id);
      return oauthError(res, 400, "invalid_grant", "Code was already used.");
    }
    const data = result.data;
    const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
    if (
      data.expires_at < now() ||
      data.client_id !== client.client_id ||
      data.redirect_uri !== body.redirect_uri ||
      !PKCE_PATTERN.test(verifier) ||
      sha256url(verifier) !== data.code_challenge
    ) {
      return oauthError(res, 400, "invalid_grant", "Code is expired or does not match this request.");
    }

    const refreshToken = newToken("hpr");
    const grantId = hashToken(refreshToken);
    const grant = {
      uid: data.uid,
      client_id: data.client_id,
      client_name: data.client_name,
      client_host: data.client_host,
      scope: data.scope,
      created_at: now(),
      last_used_at: now(),
      expires_at: now() + REFRESH_TOKEN_TTL_MS,
      revoked: false,
    };
    await store.putGrant(grantId, grant);
    await store.linkCodeToGrant(codeHash, grantId);
    send(res, 200, {
      access_token: await issueAccessToken(grantId, grant, grant.scope),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: refreshToken,
      scope: grant.scope,
    });
  }

  async function refresh(body, client, res) {
    if (typeof body.refresh_token !== "string") {
      return oauthError(res, 400, "invalid_request", "refresh_token is required.");
    }
    const grantId = hashToken(body.refresh_token);
    const grant = await store.getGrant(grantId);
    if (!grant || grant.revoked || grant.expires_at < now() || grant.client_id !== client.client_id) {
      return oauthError(res, 400, "invalid_grant", "Refresh token is expired, revoked, or not yours.");
    }
    const granted = parseScope(grant.scope);
    const wanted = body.scope === undefined ? granted : [...new Set(parseScope(body.scope))];
    if (wanted.length === 0 || wanted.some((s) => !granted.includes(s))) {
      return oauthError(res, 400, "invalid_scope", "scope can narrow the grant, never widen it.");
    }
    await store.deleteAccessTokensForGrant(grantId, now());
    await store.updateGrant(grantId, {
      last_used_at: now(),
      expires_at: now() + REFRESH_TOKEN_TTL_MS,
    });
    const scope = wanted.join(" ");
    // No refresh_token in the response: the agent keeps the one it has.
    send(res, 200, {
      access_token: await issueAccessToken(grantId, grant, scope),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      scope,
    });
  }

  async function handleToken(req, res) {
    const client = await authenticateClient(req, res);
    if (!client) return;
    const body = req.body;
    if (body.resource !== undefined && body.resource !== ORIGIN) {
      return oauthError(res, 400, "invalid_target", "Unknown resource.");
    }
    if (body.grant_type === "authorization_code") return exchangeCode(body, client, res);
    if (body.grant_type === "refresh_token") return refresh(body, client, res);
    oauthError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  // RFC 7009: success whether or not the token existed, so nothing leaks.
  async function handleRevoke(req, res) {
    const client = await authenticateClient(req, res);
    if (!client) return;
    const token = req.body.token;
    if (typeof token === "string") {
      const hash = hashToken(token);
      const grant = await store.getGrant(hash);
      if (grant && grant.client_id === client.client_id) {
        await revokeGrant(hash);
      } else {
        const access = await store.getAccessToken(hash);
        if (access && access.client_id === client.client_id) await store.deleteAccessToken(hash);
      }
    }
    send(res, 200);
  }

  // ---- Account settings: the owner's connected agents -------------------

  async function handleConnections(req, res) {
    const user = await signedInUser(req);
    if (!user) return oauthError(res, 401, "unauthenticated", "Sign in first.");
    if (req.method === "GET") {
      const grants = (await store.listGrants(user.uid)).filter((g) => g.expires_at >= now());
      return send(res, 200, {
        connections: grants.map((g) => ({
          id: g.id,
          name: g.client_name,
          domain: g.client_host,
          scopes: parseScope(g.scope).map((name) => (SCOPES[name] || {}).description || name),
          connected_at: g.created_at,
          last_used_at: g.last_used_at,
        })),
      });
    }
    const id = req.body && req.body.id;
    const grant = typeof id === "string" && /^[0-9a-f]{64}$/.test(id) ? await store.getGrant(id) : null;
    if (!grant || grant.uid !== user.uid) return oauthError(res, 404, "not_found", "No such connection.");
    await revokeGrant(id);
    send(res, 200, { ok: true });
  }

  // ---- The inventory API ------------------------------------------------

  // Returns the access token record, or null after answering the request.
  async function authorizeApiRequest(req, res) {
    const sessionJwt = req.get("poppy-session");
    const invalidSession = (description) => oauthError(res, 400, "invalid_session", description);
    if (!sessionJwt) {
      invalidSession("The Poppy-Session header is required.");
      return null;
    }
    const accessToken = bearerToken(req);
    let session;
    try {
      session = await jwt.verifySession(sessionJwt, {
        method: req.method,
        path: req.path,
        accessToken,
      });
    } catch (err) {
      if (!isIdentityError(err)) throw err;
      invalidSession(err.message);
      return null;
    }
    if (req.get("poppy-version") !== PROTOCOL_VERSION) {
      send(res, 400, { error: "version_unsupported" });
      return null;
    }

    const challenge = (status, params) =>
      send(res, status, undefined, { "WWW-Authenticate": `Bearer ${params}` });
    if (!accessToken) {
      // Signed out: say which scope a sign-in needs, with no error code.
      challenge(401, `scope="${API_SCOPE}"`);
      return null;
    }
    const record = await store.getAccessToken(hashToken(accessToken));
    if (!record || record.expires_at < now()) {
      challenge(401, 'error="invalid_token"');
      return null;
    }
    // A token is only good in the hands of the agent it was issued to.
    if (record.client_id !== session.clientId) {
      invalidSession("The access token was issued to another agent.");
      return null;
    }
    if (!parseScope(record.scope).includes(API_SCOPE)) {
      challenge(403, `error="insufficient_scope", scope="${API_SCOPE}"`);
      return null;
    }
    return record;
  }

  async function handleItems(req, res, itemId) {
    const record = await authorizeApiRequest(req, res);
    if (!record) return;
    let items = shapeItems(await store.listItems(record.uid));
    if (itemId !== undefined) {
      const item = items.find((i) => i.id === itemId);
      return item ? send(res, 200, item) : oauthError(res, 404, "not_found", "No such item.");
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    if (q) {
      items = items.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
      );
    }
    const at = typeof req.query.location_id === "string" ? req.query.location_id : "";
    if (at) items = items.filter((i) => i.location_id === (at === "root" ? null : at));
    send(res, 200, { items, total: items.length });
  }

  // ---- Routing ----------------------------------------------------------

  const cached = { "Cache-Control": "public, max-age=300" };
  const routes = {
    "GET /.well-known/poppy.json": (req, res) => send(res, 200, documents.poppyJson(), cached),
    "GET /.well-known/oauth-protected-resource": (req, res) =>
      send(res, 200, documents.protectedResourceMetadata(), cached),
    "GET /.well-known/oauth-authorization-server": (req, res) =>
      send(res, 200, documents.authorizationServerMetadata(), cached),
    [`GET ${PATHS.openapi}`]: (req, res) => send(res, 200, documents.openApi(), cached),
    "POST /oauth/request": handleRequestInfo,
    "POST /oauth/decision": handleDecision,
    [`POST ${PATHS.token}`]: handleToken,
    [`POST ${PATHS.revoke}`]: handleRevoke,
    "GET /oauth/connections": handleConnections,
    "POST /oauth/connections/revoke": handleConnections,
    [`GET ${PATHS.api}/items`]: (req, res) => handleItems(req, res),
  };

  return async function handle(req, res) {
    try {
      const route = routes[`${req.method} ${req.path}`];
      if (route) return await route(req, res);
      const item = new RegExp(`^${PATHS.api}/items/([A-Za-z0-9_-]{1,64})$`).exec(req.path);
      if (item && req.method === "GET") return await handleItems(req, res, item[1]);
      oauthError(res, 404, "not_found", "No such endpoint.");
    } catch (err) {
      // Message only: requests carry tokens and Session JWTs, which are secrets.
      console.error("poppy handler failed:", err && err.message);
      oauthError(res, 500, "server_error", "Something went wrong.");
    }
  };
}

module.exports = { createPoppyHandler, shapeItems, hashToken };
