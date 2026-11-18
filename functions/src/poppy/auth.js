// Personal Agent Protocol sign-in, shared by every site that offers it
// (hunapuka.com in handler.js, storageloot.shop in storageloot.js):
//
//   sign-in        /oauth/request and /oauth/decision back the consent page the
//                  site's web app serves at /oauth/authorize; /oauth/token and
//                  /oauth/revoke
//   device sign-in /oauth/device starts one for an agent that cannot take a
//                  redirect; /oauth/device/request and /oauth/device/decision
//                  back the page the web app serves at /device; the agent polls
//                  /oauth/token
//   account        /oauth/connections lists and disconnects agents for the person
//   resources      checkAgent() checks the Session header and access token on
//                  every API request
//
// What differs between sites comes in as `site`:
//   { origin, issuer, name, scopes, apiPath, tokenPrefix,
//     protectedResourceMetadata(resource?), describeScopes(scopes) }
// Each site keeps its codes, grants, and tokens in its own collections
// (store.js), so a token one site issued means nothing to another.

const { createHash, randomBytes, randomInt } = require("node:crypto");
const {
  PROTOCOL_VERSION,
  OLDER_VERSIONS,
  ENFORCE_AGENT_IDENTITY,
  APPROVED_CLIENTS,
  APPROVED_CLIENTS_ONLY,
  CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  DEVICE_GRANT,
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_S,
  DEVICE_POLL_LEEWAY_MS,
  DEVICE_COLLECT_GRACE_MS,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  DEVICE_MISS_LIMIT,
  DEVICE_MISS_WINDOW_MS,
  PATHS,
} = require("./config");
const { ClientError, redirectUriAllowed } = require("./clientMetadata");
const { JwtError, sha256url, peekIssuer } = require("./jwt");

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

const SERVED_VERSIONS = [PROTOCOL_VERSION, ...Object.keys(OLDER_VERSIONS)];

// Whether a Poppy-Version header names a version compatible with one served
// here: the same major version and, before 1.0, the same minor version too
// (spec 3.4). So 1.1 is accepted alongside 1.0, and handled as 1.0, which is
// all this site sends.
function versionServed(value) {
  const asked = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(typeof value === "string" ? value : "");
  if (!asked) return false;
  return SERVED_VERSIONS.some((served) => {
    const [major, minor] = served.split(".");
    return asked[1] === major && (major !== "0" || asked[2] === minor);
  });
}

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const newToken = (prefix) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const isIdentityError = (err) => err instanceof ClientError || err instanceof JwtError;

// The short code a person reads off their agent and types on the verification
// page. Stored and compared without the dash; shown with it.
function newUserCode() {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i += 1) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

const formatUserCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

// What the person typed, reduced to the code itself: any case, with or without
// the dash or spaces (RFC 8628 6.1). Null when it cannot be one of our codes.
function normalizeUserCode(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  const ours = code.length === USER_CODE_LENGTH && [...code].every((c) => USER_CODE_ALPHABET.includes(c));
  return ours ? code : null;
}

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

// Where an unverified agent may send the person back to: any HTTPS address,
// or a loopback one for an app on their own computer. With no client metadata
// there is no registered list to match against, so the consent page shows the
// host instead and the person decides.
function unregisteredRedirect(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.hash || u.username || u.password) return null;
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname);
  return u.protocol === "https:" || (u.protocol === "http:" && loopback) ? u : null;
}

// One structured line per identity check, so Cloud Logging can filter on it.
// client_id and the reason are not secrets; tokens and JWTs never go in here.
// `sid` and `user` are the agent's Session ID and its own ID for the person
// (the Session JWT's `sid` and `sub`), present once a Session header has been
// verified. They are opaque to us, and logged so one agent Session can be
// followed across requests. `grantId` names the sign-in a request used, and
// `guest` the storageloot.shop guest account a tokenless request acts for.
function defaultLogIdentity({ stage, clientId, reason, sid, user, grantId, guest, request }) {
  const entry = {
    severity: reason ? "WARNING" : "INFO",
    message: reason ? "poppy agent identity check failed" : "poppy agent identity check passed",
    stage,
    client_id: typeof clientId === "string" ? clientId.slice(0, 300) : null,
    ...(sid ? { sid, user } : {}),
    ...(grantId ? { grant_id: grantId } : {}),
    ...(guest ? { guest } : {}),
    ...(request ? { request } : {}),
    ...(reason ? { reason } : {}),
  };
  console.log(JSON.stringify(entry));
}

function createAgentAuth({
  site,
  store,
  clients,
  jwt,
  verifyIdToken,
  now = Date.now,
  enforceAgentIdentity = ENFORCE_AGENT_IDENTITY,
  approvedClients = APPROVED_CLIENTS,
  approvedOnly = APPROVED_CLIENTS_ONLY,
  logIdentity = defaultLogIdentity,
}) {
  // The protected resource is the whole site (site.origin). An agent may
  // also name it by the API's URL, or any URL under it, because RFC 9728 lets a
  // client build the metadata address from the URL it calls (see
  // resourceMetadataFor). Every one of these names the same resource.
  const API_URL = `${site.origin}${site.apiPath}`;
  function knownResource(value) {
    return value === site.origin || value === API_URL || (typeof value === "string" && value.startsWith(`${API_URL}/`));
  }

  // The protected resource metadata asked for at
  // /.well-known/oauth-protected-resource followed by `suffix` (RFC 9728 3.1).
  // A client that builds the address from the URL it calls, such as
  // https://hunapuka.com/api/v1/items, asks with that URL's path as the suffix,
  // and must find exactly that URL as `resource` in the answer (RFC 9728 3.3).
  // Null for a suffix outside the API, which names nothing here.
  function resourceMetadataFor(suffix) {
    if (!suffix) return site.protectedResourceMetadata();
    const resource = `${site.origin}${suffix}`;
    // API paths use only these characters (ids are [A-Za-z0-9_-]).
    return /^\/[A-Za-z0-9._~\/-]*$/.test(suffix) && knownResource(resource)
      ? site.protectedResourceMetadata(resource)
      : null;
  }

  const isApproved = (clientId) => approvedClients.includes(clientId);
  // In approved-only mode, a client_id that is not on the list is refused
  // wherever it turns up. Otherwise the list refuses nobody.
  const shutOut = (clientId) => approvedOnly && !isApproved(clientId);
  const NOT_APPROVED = "This client_id is not on the list of approved agents.";

  // ---- Sign-in: the authorization request -------------------------------

  // Checks an authorization request the way the consent page will act on it.
  // Until client_id and redirect_uri are verified nothing may be sent back to
  // the agent, so those failures are shown to the User instead (`fatal`).
  // No earlier approval is remembered: every request gets the consent page,
  // listing every scope it could grant, so `prompt=consent` is always honoured
  // without being read (spec 4.2, 10.8).
  async function checkAuthorizationRequest(params) {
    const p = params && typeof params === "object" ? params : {};
    const str = (name) => (typeof p[name] === "string" ? p[name] : undefined);

    const clientId = str("client_id");
    const redirectUri = str("redirect_uri");
    if (shutOut(clientId)) {
      logIdentity({ stage: "authorize", clientId, reason: NOT_APPROVED });
      return { fatal: `This agent is not one ${site.name} has approved, so it cannot be connected.` };
    }
    let client;
    let verified = true;
    try {
      client = await clients.getClient(clientId);
      logIdentity({ stage: "authorize", clientId });
    } catch (err) {
      if (!isIdentityError(err)) throw err;
      logIdentity({ stage: "authorize", clientId, reason: err.message });
      // Even unenforced, a client_id is needed: codes and tokens are bound to
      // it. And an approved agent's client_id is never served unverified, or
      // anyone could sign in under it while its metadata cannot be fetched.
      if (enforceAgentIdentity || isApproved(clientId) || !clientId || clientId.length > 2000) {
        return { fatal: "This agent could not be identified, so it cannot be connected." };
      }
      verified = false;
    }
    if (verified) {
      // An agent that did publish its redirect addresses is held to them.
      if (!redirectUriAllowed(client, redirectUri)) {
        return { fatal: "This agent asked to return to an address it has not registered." };
      }
    } else {
      const target = unregisteredRedirect(redirectUri);
      if (!target) {
        return { fatal: "This agent asked to return to an address that is not a secure web address." };
      }
      // Nothing the agent says about itself is confirmed, so it is named by
      // the one thing that is real: where the person's approval will be sent.
      client = {
        client_id: clientId,
        client_name: "",
        host: target.hostname,
        logo_uri: null,
        redirect_uris: [redirectUri],
      };
    }

    const state = str("state");
    const back = (extra) => {
      const url = new URL(redirectUri);
      for (const [k, v] of Object.entries({ ...extra, state, iss: site.issuer })) {
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
    if (scopes.length === 0 || scopes.some((s) => !Object.hasOwn(site.scopes, s))) {
      return refuse("invalid_scope", "scope is required and must name supported scopes.");
    }
    const challenge = str("code_challenge");
    if (str("code_challenge_method") !== "S256" || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return refuse("invalid_request", "PKCE with code_challenge_method S256 is required.");
    }
    const resource = str("resource");
    if (resource !== undefined && !knownResource(resource)) {
      return refuse("invalid_target", "Unknown resource.");
    }
    return { client, verified, redirectUri, scopes, challenge, back };
  }

  // What the consent page needs to show before the User decides.
  async function handleRequestInfo(req, res) {
    const checked = await checkAuthorizationRequest(req.body);
    if (checked.fatal) return send(res, 200, { error: checked.fatal });
    if (checked.redirect) return send(res, 200, { redirect: checked.redirect });
    const { client, scopes } = checked;
    send(res, 200, {
      client: {
        verified: checked.verified,
        // The agent picks its own name; the domain is what the User can trust.
        name: client.client_name || client.host,
        domain: client.host,
        logo_uri: client.logo_uri,
      },
      scopes: scopes.map((name) => ({ name, ...site.scopes[name] })),
      access_days: Math.round(REFRESH_TOKEN_TTL_MS / 86400000),
    });
  }

  async function signedInUser(req) {
    const token = bearerToken(req);
    if (!token) return null;
    try {
      const user = await verifyIdToken(token);
      // Only a real Google sign-in counts. The Firebase project could also
      // mint tokens for anonymous or other kinds of account, and none of
      // those may hand an agent access to an inventory.
      const provider = user.firebase && user.firebase.sign_in_provider;
      return provider === "google.com" && user.email_verified === true ? user : null;
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
    // The User may approve only some of what was asked for. Anything not in
    // the request is ignored, and approving nothing is a decline (spec 4.7).
    const picked = Array.isArray(body.scopes) ? body.scopes : checked.scopes;
    const approved = checked.scopes.filter((s) => picked.includes(s));
    if (body.approve !== true || approved.length === 0) {
      return send(res, 200, {
        redirect: checked.back({ error: "access_denied", error_description: "The user declined." }),
      });
    }
    const user = await signedInUser(req);
    if (!user) return oauthError(res, 401, "unauthenticated", "Sign in with Google to approve.");

    const code = newToken(`${site.tokenPrefix}c`);
    await store.putCode(hashToken(code), {
      uid: user.uid,
      client_id: checked.client.client_id,
      client_name: checked.client.client_name || checked.client.host,
      client_host: checked.client.host,
      client_verified: checked.verified,
      redirect_uri: checked.redirectUri,
      scope: approved.join(" "),
      code_challenge: checked.challenge,
      expires_at: now() + CODE_TTL_MS,
      used: false,
    });
    send(res, 200, { redirect: checked.back({ code }) });
  }

  // ---- Sign-in: the token endpoint --------------------------------------

  async function authenticateClient(req, res) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientIdParam = typeof body.client_id === "string" ? body.client_id : undefined;
    const stage = { [PATHS.revoke]: "revoke", [PATHS.device]: "device" }[req.path] || "token";
    let reason = "A private_key_jwt client assertion is required.";
    if (body.client_assertion_type === ASSERTION_TYPE && typeof body.client_assertion === "string") {
      try {
        const client = await jwt.verifyClientAssertion(body.client_assertion, clientIdParam);
        if (!shutOut(client.client_id)) {
          logIdentity({ stage, clientId: client.client_id });
          return client;
        }
        reason = NOT_APPROVED;
      } catch (err) {
        if (!isIdentityError(err)) throw err;
        reason = err.message;
      }
    }
    // Unproven: fall back to the client_id the request merely claims. Codes
    // and refresh tokens are still only honoured for the client_id they were
    // issued to, and a code still needs its PKCE verifier.
    const claimed = clientIdParam || peekIssuer(body.client_assertion);
    if (claimed && shutOut(claimed)) reason = NOT_APPROVED;
    logIdentity({ stage, clientId: claimed, reason });
    if (enforceAgentIdentity || !claimed || shutOut(claimed)) {
      oauthError(res, 401, "invalid_client", reason);
      return null;
    }
    return { client_id: claimed, unverified: true };
  }

  async function issueAccessToken(grantId, grant, scope) {
    const token = newToken(`${site.tokenPrefix}a`);
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

    await grantTokens(res, data, (grantId) => store.linkCodeToGrant(codeHash, grantId));
  }

  // Turns an approved sign-in, Direct or Device, into a refresh grant and
  // answers with its first access token. `link` records the grant against the
  // code that bought it, so presenting that code again can revoke the grant.
  async function grantTokens(res, approved, link) {
    const refreshToken = newToken(`${site.tokenPrefix}r`);
    const grantId = hashToken(refreshToken);
    const grant = {
      uid: approved.uid,
      client_id: approved.client_id,
      client_name: approved.client_name,
      client_host: approved.client_host,
      client_verified: approved.client_verified !== false,
      scope: approved.scope,
      created_at: now(),
      last_used_at: now(),
      expires_at: now() + REFRESH_TOKEN_TTL_MS,
      revoked: false,
    };
    await store.putGrant(grantId, grant);
    await link(grantId);
    send(res, 200, {
      access_token: await issueAccessToken(grantId, grant, grant.scope),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: refreshToken,
      scope: grant.scope,
    });
  }

  // ---- Sign-in: Device Sign-In ------------------------------------------

  // Starts a Device Sign-In (spec 4.3, RFC 8628 3.1-3.2). Nothing is granted
  // here: the request waits until a signed-in person approves it on the
  // verification page, and only the holder of device_code can then collect.
  async function handleDeviceAuthorization(req, res) {
    const client = await authenticateClient(req, res);
    if (!client) return;
    const body = req.body;
    // A verified client_id is a URL that was fetched; a merely claimed one is
    // free text that is about to be stored, so it gets the same cap.
    if (client.unverified && client.client_id.length > 2000) {
      return oauthError(res, 401, "invalid_client", "client_id is too long.");
    }
    // Whoever holds the device_code collects the tokens, so a request under
    // an approved agent's client_id has to carry that agent's signature.
    if (client.unverified && isApproved(client.client_id)) {
      return oauthError(res, 401, "invalid_client", "This client_id must send a valid client assertion.");
    }
    if (body.resource !== undefined && !knownResource(body.resource)) {
      return oauthError(res, 400, "invalid_target", "Unknown resource.");
    }
    const scopes = [...new Set(parseScope(body.scope))];
    if (scopes.length === 0 || scopes.some((s) => !Object.hasOwn(site.scopes, s))) {
      return oauthError(res, 400, "invalid_scope", "scope is required and must name supported scopes.");
    }

    const deviceCode = newToken(`${site.tokenPrefix}d`);
    const userCode = newUserCode();
    await store.putDeviceRequest(hashToken(deviceCode), {
      user_code_hash: hashToken(userCode),
      client_id: client.client_id,
      // With no redirect address there is nothing real to name an unverified
      // agent by, so it stays nameless and the page says it is unidentified.
      client_name: client.unverified ? "" : client.client_name || client.host,
      client_host: client.unverified ? "" : client.host,
      client_logo_uri: client.unverified ? null : client.logo_uri,
      client_verified: !client.unverified,
      scope: scopes.join(" "),
      status: "pending",
      created_at: now(),
      expires_at: now() + DEVICE_CODE_TTL_MS,
    });
    // On the issuer's own host, or a Personal Agent must not show the link.
    const page = `${site.origin}${PATHS.devicePage}`;
    send(res, 200, {
      device_code: deviceCode,
      user_code: formatUserCode(userCode),
      verification_uri: page,
      verification_uri_complete: `${page}?user_code=${formatUserCode(userCode)}`,
      expires_in: DEVICE_CODE_TTL_MS / 1000,
      interval: DEVICE_POLL_INTERVAL_S,
    });
  }

  // One poll of the token endpoint (RFC 8628 3.4-3.5). Answers with the
  // tokens once the person has approved, and with why not until then.
  async function redeemDeviceCode(body, client, res) {
    if (typeof body.device_code !== "string") {
      return oauthError(res, 400, "invalid_request", "device_code is required.");
    }
    const hash = hashToken(body.device_code);
    const request = await store.getDeviceRequest(hash);
    if (!request || request.client_id !== client.client_id) {
      return oauthError(res, 400, "invalid_grant", "Unknown device_code.");
    }
    const spent = async () => {
      // As with an authorization code: a device_code presented after its
      // tokens were collected may have been stolen, so the grant is revoked.
      const latest = await store.getDeviceRequest(hash);
      if (latest && latest.grant_id) await revokeGrant(latest.grant_id);
      return oauthError(res, 400, "invalid_grant", "device_code was already used.");
    };
    if (request.status === "used") return spent();
    if (request.expires_at < now()) {
      return oauthError(res, 400, "expired_token", "The request expired. Start a new one.");
    }
    await store.updateDeviceRequest(hash, { last_poll_at: now() });
    const sinceLast = now() - (request.last_poll_at ?? -Infinity);
    if (sinceLast < DEVICE_POLL_INTERVAL_S * 1000 - DEVICE_POLL_LEEWAY_MS) {
      return oauthError(res, 400, "slow_down", `Poll every ${DEVICE_POLL_INTERVAL_S} seconds at most.`);
    }
    if (request.status === "denied") {
      return oauthError(res, 400, "access_denied", "The user declined.");
    }
    if (request.status !== "approved") {
      return oauthError(res, 400, "authorization_pending", "The user has not approved yet.");
    }
    // Two polls racing for an approved request: only one moves it to "used".
    if (!(await store.moveDeviceRequest(hash, "approved", { status: "used" }))) return spent();
    await grantTokens(
      res,
      {
        ...request,
        client_name: request.client_name || "Unidentified agent",
        scope: request.approved_scope,
      },
      (grantId) => store.updateDeviceRequest(hash, { grant_id: grantId }),
    );
  }

  // Finds the pending request for the code a person typed on the verification
  // page. They must be signed in first: wrong codes are then counted against
  // an account, which is what stops someone guessing codes (RFC 8628 5.1).
  // Returns null after answering the request when there is nothing to act on.
  async function pendingDeviceRequest(req, res) {
    const user = await signedInUser(req);
    if (!user) {
      oauthError(res, 401, "unauthenticated", "Sign in with Google first.");
      return null;
    }
    const misses = await store.getDeviceMisses(user.uid);
    const counting = misses && misses.window_start + DEVICE_MISS_WINDOW_MS > now();
    if (counting && misses.count >= DEVICE_MISS_LIMIT) {
      oauthError(res, 429, "too_many_attempts", "Too many wrong codes. Wait a few minutes, then try again.");
      return null;
    }
    const code = normalizeUserCode(req.body && req.body.user_code);
    const found = code ? await store.findDeviceRequest(hashToken(code)) : null;
    if (found && found.status === "pending" && found.expires_at >= now()) {
      return { user, request: found, code };
    }
    // Something that could not be a code at all is a typo, not a guess.
    if (code) {
      const windowStart = counting ? misses.window_start : now();
      await store.putDeviceMisses(user.uid, {
        count: counting ? misses.count + 1 : 1,
        window_start: windowStart,
        expires_at: windowStart + DEVICE_MISS_WINDOW_MS,
      });
    }
    send(res, 200, { found: false });
    return null;
  }

  // What the verification page shows once the code is known. Looking a code
  // up changes nothing: opening the link must never approve by itself.
  async function handleDeviceInfo(req, res) {
    const pending = await pendingDeviceRequest(req, res);
    if (!pending) return;
    const { request, code } = pending;
    send(res, 200, {
      found: true,
      user_code: formatUserCode(code),
      client: {
        verified: request.client_verified,
        name: request.client_name,
        domain: request.client_host,
        logo_uri: request.client_logo_uri,
      },
      scopes: parseScope(request.scope).map((name) => ({ name, ...site.scopes[name] })),
      access_days: Math.round(REFRESH_TOKEN_TTL_MS / 86400000),
    });
  }

  // The person's answer on the verification page. As at /oauth/decision, it
  // carries their Firebase ID token in a header, so it needs no CSRF token.
  async function handleDeviceDecision(req, res) {
    const pending = await pendingDeviceRequest(req, res);
    if (!pending) return;
    const { user, request } = pending;
    const asked = parseScope(request.scope);
    const picked = Array.isArray(req.body.scopes) ? req.body.scopes : asked;
    const approved = asked.filter((s) => picked.includes(s));
    const approve = req.body.approve === true && approved.length > 0;
    const moved = await store.moveDeviceRequest(
      request.id,
      "pending",
      approve
        ? {
            status: "approved",
            uid: user.uid,
            approved_scope: approved.join(" "),
            expires_at: Math.max(request.expires_at, now() + DEVICE_COLLECT_GRACE_MS),
          }
        : { status: "denied" },
    );
    // Lost a race with another answer to the same request: it stands.
    if (!moved) return send(res, 200, { found: false });
    send(res, 200, { found: true, approved: approve });
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
    if (body.resource !== undefined && !knownResource(body.resource)) {
      return oauthError(res, 400, "invalid_target", "Unknown resource.");
    }
    if (body.grant_type === "authorization_code") return exchangeCode(body, client, res);
    if (body.grant_type === "refresh_token") return refresh(body, client, res);
    if (body.grant_type === DEVICE_GRANT) return redeemDeviceCode(body, client, res);
    oauthError(
      res,
      400,
      "unsupported_grant_type",
      `Use authorization_code, refresh_token, or ${DEVICE_GRANT}.`,
    );
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
          verified: g.client_verified !== false,
          scopes: parseScope(g.scope),
          ...site.describeScopes(parseScope(g.scope)),
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

  // ---- Resources: who is calling -----------------------------------------

  // Checks who is calling a resource: the Session header, then the access
  // token. Returns { record, session }, or null after answering the request.
  // `record` is the access token's record. With `tokenOptional`, a request
  // that carries no access token is let through signed out, with a null record.
  async function checkAgent(req, res, scope, { tokenOptional = false } = {}) {
    const sessionJwt = req.get("poppy-session");
    const invalidSession = (description) => oauthError(res, 400, "invalid_session", description);
    const accessToken = bearerToken(req);
    // Null when the agent did not prove itself and that is being tolerated.
    let session = null;
    let reason = "The Poppy-Session header is required.";
    if (sessionJwt) {
      try {
        session = await jwt.verifySession(sessionJwt, {
          method: req.method,
          path: req.path,
          accessToken,
        });
      } catch (err) {
        if (!isIdentityError(err)) throw err;
        reason = err.message;
      }
    }
    if (!session) {
      logIdentity({ stage: "api", clientId: peekIssuer(sessionJwt), reason });
      if (enforceAgentIdentity) {
        invalidSession(reason);
        return null;
      }
    }
    // The version header travels with the Session header, so it is only
    // demanded of an agent that sent a valid one.
    if (session && !versionServed(req.get("poppy-version"))) {
      send(res, 400, { error: "version_unsupported" });
      return null;
    }

    const challenge = (status, params) =>
      send(res, status, undefined, { "WWW-Authenticate": `Bearer ${params}` });
    const request = `${req.method} ${req.path}`;
    if (!accessToken && tokenOptional) {
      if (session && shutOut(session.clientId)) {
        invalidSession(NOT_APPROVED);
        return null;
      }
      if (session) logIdentity({ stage: "api", clientId: session.clientId, sid: session.sid, user: session.userId, request });
      return { record: null, session };
    }
    if (!accessToken) {
      // Without tokenOptional, nothing is offered to a signed-out agent: the
      // person must have signed in and approved. Say which scope a sign-in
      // needs, with no error code (spec section 7).
      challenge(401, `scope="${scope}"`);
      return null;
    }
    const record = await store.getAccessToken(hashToken(accessToken));
    // A token issued before its agent was shut out stops working at once.
    if (!record || record.expires_at < now() || shutOut(record.client_id)) {
      challenge(401, 'error="invalid_token"');
      return null;
    }
    // A token is only good in the hands of the agent it was issued to.
    // This holds even when identity is not enforced: a different agent that
    // has proved who it is, holding someone else's token, is a mismatch and
    // not a mere failure to identify.
    if (session && record.client_id !== session.clientId) {
      invalidSession("The access token was issued to another agent.");
      return null;
    }
    if (!parseScope(record.scope).includes(scope)) {
      challenge(403, `error="insufficient_scope", scope="${scope}"`);
      return null;
    }
    if (session) {
      // Every request from a verified Session is logged with its Session ID,
      // and the sign-in it used remembers the latest one. The token remembers
      // it too, so the sign-in is written only when the Session changes.
      logIdentity({
        stage: "api",
        clientId: session.clientId,
        sid: session.sid,
        user: session.userId,
        grantId: record.grant_id,
        request,
      });
      if (record.session_id !== session.sid) {
        await store.updateAccessToken(hashToken(accessToken), { session_id: session.sid });
        await store.updateGrant(record.grant_id, {
          last_session_id: session.sid,
          last_session_user: session.userId,
          last_session_at: now(),
        });
      }
    }
    return { record, session };
  }

  const routes = {
    "POST /oauth/request": handleRequestInfo,
    "POST /oauth/decision": handleDecision,
    [`POST ${PATHS.token}`]: handleToken,
    [`POST ${PATHS.revoke}`]: handleRevoke,
    [`POST ${PATHS.device}`]: handleDeviceAuthorization,
    [`POST ${PATHS.device}/request`]: handleDeviceInfo,
    [`POST ${PATHS.device}/decision`]: handleDeviceDecision,
    "GET /oauth/connections": handleConnections,
    "POST /oauth/connections/revoke": handleConnections,
  };

  return { routes, checkAgent, shutOut, isApproved, signedInUser, resourceMetadataFor, NOT_APPROVED };
}

module.exports = {
  createAgentAuth,
  versionServed,
  hashToken,
  newToken,
  send,
  oauthError,
  parseScope,
  bearerToken,
  toIso,
  defaultLogIdentity,
};
