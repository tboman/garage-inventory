// End-to-end tests of the Poppy handler with a fake Personal Agent, an
// in-memory store, and no network. Run with `npm test` from functions/.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const jose = require("jose");
const { ClientError, createClientDirectory } = require("../src/poppy/clientMetadata");
const { createJwtVerifier } = require("../src/poppy/jwt");
const { createPoppyHandler, shapeItems } = require("../src/poppy/handler");

const ORIGIN = "https://hunapuka.com";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sha = (v) => createHash("sha256").update(v).digest("base64url");
const rid = () => b64(randomBytes(12));

function memoryStore(itemsByUid) {
  const codes = new Map();
  const grants = new Map();
  const access = new Map();
  return {
    async putCode(h, d) {
      codes.set(h, { ...d });
    },
    async consumeCode(h) {
      const d = codes.get(h);
      if (!d) return { status: "missing" };
      if (d.used) return { status: "used", data: { ...d } };
      d.used = true;
      return { status: "ok", data: { ...d } };
    },
    async linkCodeToGrant(h, id) {
      codes.get(h).grant_id = id;
    },
    async putGrant(id, d) {
      grants.set(id, { ...d });
    },
    async getGrant(id) {
      return grants.has(id) ? { ...grants.get(id) } : null;
    },
    async updateGrant(id, patch) {
      Object.assign(grants.get(id), patch);
    },
    async listGrants(uid) {
      return [...grants]
        .filter(([, g]) => g.uid === uid && !g.revoked)
        .map(([id, g]) => ({ id, ...g }));
    },
    async putAccessToken(h, d) {
      access.set(h, { ...d });
    },
    async getAccessToken(h) {
      return access.has(h) ? { ...access.get(h) } : null;
    },
    async deleteAccessToken(h) {
      access.delete(h);
    },
    async deleteAccessTokensForGrant(id, before) {
      for (const [h, t] of access) {
        if (t.grant_id === id && (before === undefined || t.expires_at < before)) access.delete(h);
      }
    },
    async listItems(uid) {
      return (itemsByUid[uid] || []).map((i) => ({ ...i }));
    },
    async createItem(uid, id, data) {
      const list = (itemsByUid[uid] = itemsByUid[uid] || []);
      if (list.some((i) => i.id === id)) return false;
      list.push({ id, ...data });
      return true;
    },
    async updateItem(uid, id, patch) {
      Object.assign(
        itemsByUid[uid].find((i) => i.id === id),
        patch,
      );
    },
    async deleteItem(uid, id) {
      itemsByUid[uid] = itemsByUid[uid].filter((i) => i.id !== id);
    },
    raw: itemsByUid,
  };
}

// A Personal Agent with a published root key and a delegated Session key.
async function makeAgent(host, { alg = "ES256" } = {}) {
  const root = await jose.generateKeyPair(alg, { extractable: true });
  const rootJwk = { ...(await jose.exportJWK(root.publicKey)), kid: `root-${host}`, use: "sig" };
  const session = await jose.generateKeyPair("ES256", { extractable: true });
  const sessionJwk = await jose.exportJWK(session.publicKey);
  const clientId = `https://${host}/agent.json`;
  const redirectUri = `https://${host}/oauth/callback`;
  const nowS = () => Math.floor(Date.now() / 1000);

  return {
    clientId,
    redirectUri,
    documents: {
      [clientId]: {
        client_id: clientId,
        client_name: "Muse",
        jwks_uri: `https://${host}/jwks.json`,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "private_key_jwt",
      },
      [`https://${host}/jwks.json`]: { keys: [rootJwk] },
    },
    assertion({ aud = ORIGIN } = {}) {
      return new jose.SignJWT({ jti: rid() })
        .setProtectedHeader({ alg, kid: rootJwk.kid })
        .setIssuer(clientId)
        .setSubject(clientId)
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(root.privateKey);
    },
    async sessionHeader({ method = "GET", path, accessToken, claims = {}, header = {} }) {
      const delegation = await new jose.SignJWT({ cnf: { jwk: sessionJwk }, jti: rid() })
        .setProtectedHeader({ alg, typ: "poppy-delegation+jwt", kid: rootJwk.kid })
        .setIssuer(clientId)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(root.privateKey);
      const body = {
        iss: clientId,
        aud: ORIGIN,
        sid: "sid_1",
        sub: "usr_1",
        htm: method,
        htu: `${ORIGIN}${path}`,
        iat: nowS(),
        jti: rid(),
        ...(accessToken ? { ath: sha(accessToken) } : {}),
        ...claims,
      };
      return new jose.SignJWT(body)
        .setProtectedHeader({
          alg: "ES256",
          typ: "poppy-session+jwt",
          kid: await jose.calculateJwkThumbprint(sessionJwk),
          poppy_dlg: delegation,
          ...header,
        })
        .sign(session.privateKey);
    },
  };
}

const ITEMS = {
  alice: [
    {
      id: "g",
      name: "Garage",
      description: "",
      locationId: null,
      photos: ["https://drive/secret1"],
      x: 0.1,
      y: 0.2,
      order: 0,
      createdAt: 1700000000000,
    },
    { id: "s", name: "Shelf", description: "metal", locationId: "g", photos: [], order: 1 },
    {
      id: "d",
      name: "Cordless drill",
      description: "18V with two batteries",
      locationId: "s",
      photos: ["https://drive/secret2"],
    },
  ],
  bob: [{ id: "b", name: "Bobs bike", locationId: null }],
};

// Tests run with agent identity enforced unless they say otherwise, so the
// strict behaviour stays covered while production runs unenforced.
async function setup({ enforce = true } = {}) {
  const identityLog = [];
  const muse = await makeAgent("agent.example");
  const other = await makeAgent("other.example");
  const pss = await makeAgent("pss.example", { alg: "PS384" });
  const docs = { ...muse.documents, ...other.documents, ...pss.documents };
  const clients = createClientDirectory({
    fetchJson: async (url) => {
      if (!docs[url]) throw new ClientError("HTTP 404.");
      return docs[url];
    },
  });
  const store = memoryStore(structuredClone(ITEMS));
  const handler = createPoppyHandler({
    enforceAgentIdentity: enforce,
    logIdentity: (entry) => identityLog.push(entry),
    store,
    clients,
    jwt: createJwtVerifier({ clients }),
    verifyIdToken: async (t) => {
      const google = { email_verified: true, firebase: { sign_in_provider: "google.com" } };
      if (t === "alice-id-token") return { uid: "alice", ...google };
      if (t === "bob-id-token") return { uid: "bob", ...google };
      // Valid Firebase tokens that are not a real Google sign-in.
      if (t === "anonymous-id-token") return { uid: "alice", firebase: { sign_in_provider: "anonymous" } };
      if (t === "password-id-token") {
        return { uid: "alice", email_verified: true, firebase: { sign_in_provider: "password" } };
      }
      if (t === "unverified-id-token") {
        return { uid: "alice", email_verified: false, firebase: { sign_in_provider: "google.com" } };
      }
      throw new Error("bad token");
    },
  });

  async function call(method, path, { headers = {}, body, query = {} } = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const out = { status: 200, headers: {}, body: undefined };
    const res = {
      status(s) {
        out.status = s;
        return res;
      },
      set(h) {
        Object.assign(out.headers, h);
        return res;
      },
      json(b) {
        out.body = b;
      },
      end() {},
    };
    await handler({ method, path, query, body, get: (n) => lower[n.toLowerCase()] }, res);
    return out;
  }

  const verifier = b64(randomBytes(32));
  const authRequest = (agent, extra = {}) => ({
    response_type: "code",
    client_id: agent.clientId,
    redirect_uri: agent.redirectUri,
    scope: "inventory:read",
    state: "st8",
    code_challenge: sha(verifier),
    code_challenge_method: "S256",
    ...extra,
  });

  const tokenForm = async (agent, fields) => ({
    client_assertion_type: ASSERTION_TYPE,
    client_assertion: await agent.assertion(),
    ...fields,
  });

  // `ask` is what the agent requests; `allow` is what the user ticks, when
  // that differs.
  async function approve(agent, { idToken = "alice-id-token", ask, allow } = {}) {
    const decision = await call("POST", "/oauth/decision", {
      headers: { authorization: `Bearer ${idToken}` },
      body: {
        request: authRequest(agent, ask ? { scope: ask } : {}),
        approve: true,
        ...(allow ? { scopes: allow } : {}),
      },
    });
    return new URL(decision.body.redirect).searchParams.get("code");
  }

  async function signIn(agent, options) {
    const code = await approve(agent, options);
    const token = await call("POST", "/oauth/token", {
      body: await tokenForm(agent, {
        grant_type: "authorization_code",
        code,
        redirect_uri: agent.redirectUri,
        code_verifier: verifier,
      }),
    });
    return { code, token };
  }

  async function api(
    agent,
    path,
    { accessToken, session = {}, version = "0.4", query, method = "GET", body, headers: extra = {} } = {},
  ) {
    const headers = {
      "Poppy-Session": await agent.sessionHeader({ method, path, accessToken, ...session }),
      ...extra,
    };
    if (version) headers["Poppy-Version"] = version;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return call(method, path, { headers, query, body });
  }

  return { muse, other, pss, store, call, authRequest, approve, signIn, api, tokenForm, verifier, identityLog };
}

test("discovery documents agree with each other", async () => {
  const { call } = await setup();
  const poppy = (await call("GET", "/.well-known/poppy.json")).body;
  const resource = (await call("GET", "/.well-known/oauth-protected-resource")).body;
  const server = (await call("GET", "/.well-known/oauth-authorization-server")).body;
  assert.equal(poppy.protocol_version, "0.4");
  assert.equal(poppy.organization.domain, "hunapuka.com");
  assert.equal(resource.resource, `https://${poppy.organization.domain}`);
  assert.deepEqual(resource.authorization_servers, [server.issuer]);
  assert.equal(poppy.auth.issuer, server.issuer);
  assert.ok(server.protected_resources.includes(resource.resource));
  assert.ok(server.grant_types_supported.includes("refresh_token"));
  assert.ok(server.grant_types_supported.includes("authorization_code"));
  assert.ok(server.revocation_endpoint && server.token_endpoint && server.authorization_endpoint);
  for (const scope of server.scopes_supported) {
    assert.ok(poppy.auth.scopes[scope]);
    assert.ok(poppy.auth.scope_hints[scope]);
  }
  const openapi = (await call("GET", "/api/openapi.json")).body;
  assert.equal(poppy.apis[0].url, "https://hunapuka.com/api/openapi.json");
  assert.ok(openapi.paths["/items"].get);
});

test("the consent page learns who is asking, and bad requests go nowhere unsafe", async () => {
  const { call, muse, authRequest } = await setup();
  const ok = await call("POST", "/oauth/request", { body: authRequest(muse) });
  assert.equal(ok.body.client.name, "Muse");
  assert.equal(ok.body.client.domain, "agent.example");
  assert.equal(ok.body.scopes[0].name, "inventory:read");

  // An unregistered redirect_uri must never be redirected to.
  const evil = await call("POST", "/oauth/request", {
    body: authRequest(muse, { redirect_uri: "https://evil.example/cb" }),
  });
  assert.ok(evil.body.error);
  assert.equal(evil.body.redirect, undefined);

  const unknown = await call("POST", "/oauth/request", {
    body: authRequest(muse, { client_id: "https://nobody.example/agent.json" }),
  });
  assert.ok(unknown.body.error);

  for (const [extra, error] of [
    [{ scope: "inventory:read inventory:admin" }, "invalid_scope"],
    [{ scope: undefined }, "invalid_scope"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ resource: "https://elsewhere.example" }, "invalid_target"],
  ]) {
    const r = await call("POST", "/oauth/request", { body: authRequest(muse, extra) });
    const back = new URL(r.body.redirect);
    assert.equal(back.origin + back.pathname, muse.redirectUri);
    assert.equal(back.searchParams.get("error"), error);
    assert.equal(back.searchParams.get("iss"), ORIGIN);
    assert.equal(back.searchParams.get("state"), "st8");
  }
});

test("approving needs a signed-in user; declining returns access_denied", async () => {
  const { call, muse, authRequest } = await setup();
  const anon = await call("POST", "/oauth/decision", {
    body: { request: authRequest(muse), approve: true },
  });
  assert.equal(anon.status, 401);
  const forged = await call("POST", "/oauth/decision", {
    headers: { authorization: "Bearer not-a-real-token" },
    body: { request: authRequest(muse), approve: true },
  });
  assert.equal(forged.status, 401);

  const declined = await call("POST", "/oauth/decision", {
    body: { request: authRequest(muse), approve: false },
  });
  const back = new URL(declined.body.redirect);
  assert.equal(back.searchParams.get("error"), "access_denied");
  assert.equal(back.searchParams.get("iss"), ORIGIN);
  assert.equal(back.searchParams.get("code"), null);
});

test("full sign-in returns tokens, and the inventory comes back without photos", async () => {
  const { muse, signIn, api } = await setup();
  const { token } = await signIn(muse);
  assert.equal(token.status, 200);
  assert.equal(token.body.token_type, "Bearer");
  assert.equal(token.body.scope, "inventory:read");
  assert.ok(token.body.refresh_token && token.body.access_token && token.body.expires_in);
  assert.equal(token.headers["Cache-Control"], "no-store");
  const accessToken = token.body.access_token;

  const list = await api(muse, "/api/v1/items", { accessToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  const drill = list.body.items.find((i) => i.id === "d");
  assert.deepEqual(drill.path, ["Garage", "Shelf"]);
  assert.equal(drill.location_id, "s");
  const text = JSON.stringify(list.body);
  assert.ok(!text.includes("photos") && !text.includes("drive/secret"));
  assert.ok(!text.includes("Bobs"));
  const allowed = ["child_count", "created_at", "description", "id", "location_id", "name", "path"];
  for (const item of list.body.items) {
    for (const key of Object.keys(item)) assert.ok(allowed.includes(key), `unexpected field ${key}`);
  }

  const search = await api(muse, "/api/v1/items", { accessToken, query: { q: "DRILL" } });
  assert.deepEqual(
    search.body.items.map((i) => i.id),
    ["d"],
  );
  const top = await api(muse, "/api/v1/items", { accessToken, query: { location_id: "root" } });
  assert.deepEqual(
    top.body.items.map((i) => i.id),
    ["g"],
  );
  const one = await api(muse, "/api/v1/items/s", { accessToken });
  assert.equal(one.body.name, "Shelf");
  assert.equal(one.body.child_count, 1);
  // Another person's item is simply not there.
  assert.equal((await api(muse, "/api/v1/items/b", { accessToken })).status, 404);
});

test("the code is single use, bound to PKCE, the client, and the redirect", async () => {
  const { muse, other, call, approve, signIn, api, tokenForm, verifier } = await setup();
  const exchange = async (agent, fields) =>
    call("POST", "/oauth/token", {
      body: await tokenForm(agent, {
        grant_type: "authorization_code",
        redirect_uri: muse.redirectUri,
        code_verifier: verifier,
        ...fields,
      }),
    });

  const wrongVerifier = await exchange(muse, { code: await approve(muse), code_verifier: "x".repeat(43) });
  assert.equal(wrongVerifier.body.error, "invalid_grant");
  const wrongClient = await exchange(other, { code: await approve(muse) });
  assert.equal(wrongClient.body.error, "invalid_grant");
  const wrongRedirect = await exchange(muse, {
    code: await approve(muse),
    redirect_uri: "https://agent.example/elsewhere",
  });
  assert.equal(wrongRedirect.body.error, "invalid_grant");
  assert.equal((await exchange(muse, { code: "hpc_nope" })).body.error, "invalid_grant");

  // Replaying a redeemed code fails and revokes what the first use bought.
  const { code, token } = await signIn(muse);
  const accessToken = token.body.access_token;
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 200);
  const replay = await exchange(muse, { code });
  assert.equal(replay.body.error, "invalid_grant");
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 401);
});

test("the token endpoint only accepts a valid client assertion", async () => {
  const { muse, pss, call, signIn } = await setup();
  const post = (body) => call("POST", "/oauth/token", { body });
  const base = { grant_type: "refresh_token", refresh_token: "x", client_assertion_type: ASSERTION_TYPE };

  assert.equal((await post({ grant_type: "refresh_token", refresh_token: "x" })).status, 401);
  const wrongAud = await post({
    ...base,
    client_assertion: await muse.assertion({ aud: "https://hunapuka.com/oauth/token" }),
  });
  assert.equal(wrongAud.body.error, "invalid_client");

  const assertion = await muse.assertion();
  const first = await post({ ...base, client_assertion: assertion });
  assert.equal(first.body.error, "invalid_grant");
  const reused = await post({ ...base, client_assertion: assertion });
  assert.equal(reused.body.error, "invalid_client");

  const mismatch = await post({
    ...base,
    client_id: "https://other.example/agent.json",
    client_assertion: await muse.assertion(),
  });
  assert.equal(mismatch.body.error, "invalid_client");

  // PS384 root keys are accepted for assertions and delegations alike.
  const { token } = await signIn(pss);
  assert.equal(token.status, 200);
});

test("the API verifies the Session header before anything else", async () => {
  const { muse, other, pss, call, signIn, api } = await setup();
  const { token } = await signIn(muse);
  const accessToken = token.body.access_token;
  const path = "/api/v1/items";

  const none = await call("GET", path, {
    headers: { Authorization: `Bearer ${accessToken}`, "Poppy-Version": "0.4" },
  });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "invalid_session");

  const signedOut = await api(muse, path);
  assert.equal(signedOut.status, 401);
  assert.equal(signedOut.headers["WWW-Authenticate"], 'Bearer scope="inventory:read"');

  const bad = async (session) => {
    const r = await api(muse, path, { accessToken, session });
    assert.equal(r.status, 400, JSON.stringify(session));
    assert.equal(r.body.error, "invalid_session");
  };
  await bad({ claims: { htu: "https://hunapuka.com/api/v1/other" } });
  await bad({ claims: { htu: "https://evil.example/api/v1/items" } });
  await bad({ claims: { htm: "POST" } });
  await bad({ claims: { aud: "https://elsewhere.example" } });
  await bad({ claims: { iat: Math.floor(Date.now() / 1000) - 600 } });
  await bad({ claims: { ath: "wrong" } });
  await bad({ header: { typ: "JWT" } });
  await bad({ header: { kid: "not-the-thumbprint" } });
  await bad({ header: { poppy_dlg: undefined } });

  // ath on a request that carries no access token
  const stray = await call("GET", path, {
    headers: {
      "Poppy-Session": await muse.sessionHeader({ path, accessToken }),
      "Poppy-Version": "0.4",
    },
  });
  assert.equal(stray.body.error, "invalid_session");

  // A stolen access token is useless to another agent.
  const stolen = await api(other, path, { accessToken });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.error, "invalid_session");

  assert.equal((await api(muse, path, { accessToken, version: null })).body.error, "version_unsupported");
  assert.equal((await api(muse, path, { accessToken, version: "0.3" })).body.error, "version_unsupported");

  const garbage = await api(muse, path, { accessToken: "hpa_unknown" });
  assert.equal(garbage.status, 401);
  assert.equal(garbage.headers["WWW-Authenticate"], 'Bearer error="invalid_token"');

  // A PS384-signed delegation works at the API too.
  const second = await signIn(pss);
  assert.equal((await api(pss, path, { accessToken: second.token.body.access_token })).status, 200);
});

test("refresh issues new access tokens; revoking signs the agent out at once", async () => {
  const { muse, other, call, signIn, api, tokenForm } = await setup();
  const { token } = await signIn(muse);
  const refreshToken = token.body.refresh_token;
  const refreshWith = async (agent, extra = {}) =>
    call("POST", "/oauth/token", {
      body: await tokenForm(agent, { grant_type: "refresh_token", refresh_token: refreshToken, ...extra }),
    });

  const refreshed = await refreshWith(muse);
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.refresh_token, undefined);
  assert.notEqual(refreshed.body.access_token, token.body.access_token);
  const accessToken = refreshed.body.access_token;
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 200);

  assert.equal((await refreshWith(muse, { scope: "inventory:read inventory:write" })).body.error, "invalid_scope");
  assert.equal((await refreshWith(other)).body.error, "invalid_grant");

  // Another agent cannot revoke it, and gets the same quiet 200.
  const foreign = await call("POST", "/oauth/revoke", { body: await tokenForm(other, { token: refreshToken }) });
  assert.equal(foreign.status, 200);
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 200);

  const revoked = await call("POST", "/oauth/revoke", {
    body: await tokenForm(muse, { token: refreshToken, token_type_hint: "refresh_token" }),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 401);
  assert.equal((await refreshWith(muse)).body.error, "invalid_grant");
});

test("the owner can see and disconnect agents, and only their own", async () => {
  const { muse, call, signIn, api } = await setup();
  const { token } = await signIn(muse);
  const accessToken = token.body.access_token;
  const as = (t) => ({ headers: { authorization: `Bearer ${t}` } });

  assert.equal((await call("GET", "/oauth/connections")).status, 401);
  const mine = await call("GET", "/oauth/connections", as("alice-id-token"));
  assert.equal(mine.body.connections.length, 1);
  assert.equal(mine.body.connections[0].domain, "agent.example");
  assert.equal((await call("GET", "/oauth/connections", as("bob-id-token"))).body.connections.length, 0);

  const id = mine.body.connections[0].id;
  const bob = await call("POST", "/oauth/connections/revoke", { ...as("bob-id-token"), body: { id } });
  assert.equal(bob.status, 404);
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 200);

  const ok = await call("POST", "/oauth/connections/revoke", { ...as("alice-id-token"), body: { id } });
  assert.equal(ok.status, 200);
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 401);
  assert.equal((await call("GET", "/oauth/connections", as("alice-id-token"))).body.connections.length, 0);
});

test("read and write are separate grants, and the user can approve just one", async () => {
  const { muse, call, authRequest, signIn, api } = await setup();
  const both = "inventory:read inventory:write";
  const path = "/api/v1/items";
  const post = (accessToken, body, headers) => api(muse, path, { accessToken, method: "POST", body, headers });

  const info = await call("POST", "/oauth/request", { body: authRequest(muse, { scope: both }) });
  assert.deepEqual(
    info.body.scopes.map((s) => [s.name, s.hints.changes]),
    [
      ["inventory:read", "none"],
      ["inventory:write", "reversible"],
    ],
  );

  // Asked for both, the user ticks only read: the token cannot write.
  const readOnly = (await signIn(muse, { ask: both, allow: ["inventory:read"] })).token.body;
  assert.equal(readOnly.scope, "inventory:read");
  assert.equal((await api(muse, path, { accessToken: readOnly.access_token })).status, 200);
  const refused = await post(readOnly.access_token, { name: "Ladder" });
  assert.equal(refused.status, 403);
  assert.equal(refused.headers["WWW-Authenticate"], 'Bearer error="insufficient_scope", scope="inventory:write"');

  // Write alone cannot list the inventory.
  const writeOnly = (await signIn(muse, { ask: both, allow: ["inventory:write"] })).token.body;
  assert.equal(writeOnly.scope, "inventory:write");
  assert.equal((await api(muse, path, { accessToken: writeOnly.access_token })).status, 403);
  assert.equal((await post(writeOnly.access_token, { name: "Ladder" })).status, 201);

  // Ticking a scope the agent never asked for adds nothing, and ticking none declines.
  const sneaky = (await signIn(muse, { allow: ["inventory:read", "inventory:write"] })).token.body;
  assert.equal(sneaky.scope, "inventory:read");
  const none = await call("POST", "/oauth/decision", {
    headers: { authorization: "Bearer alice-id-token" },
    body: { request: authRequest(muse, { scope: both }), approve: true, scopes: [] },
  });
  assert.equal(new URL(none.body.redirect).searchParams.get("error"), "access_denied");

  // A signed-out write is told which scope to sign in for.
  const signedOut = await api(muse, path, { method: "POST", body: { name: "x" } });
  assert.equal(signedOut.headers["WWW-Authenticate"], 'Bearer scope="inventory:write"');
});

test("an agent with write access can add, edit, and move items, but not break the tree", async () => {
  const { muse, store, signIn, api } = await setup();
  const { token } = await signIn(muse, { ask: "inventory:read inventory:write" });
  const accessToken = token.body.access_token;
  const post = (body, headers) => api(muse, "/api/v1/items", { accessToken, method: "POST", body, headers });
  const patch = (id, body) => api(muse, `/api/v1/items/${id}`, { accessToken, method: "PATCH", body });

  const made = await post({ name: "  Ladder ", description: "6 ft", location_id: "g" });
  assert.equal(made.status, 201);
  assert.equal(made.body.name, "Ladder");
  assert.deepEqual(made.body.path, ["Garage"]);
  const stored = store.raw.alice.find((i) => i.id === made.body.id);
  // The shape the web app expects of an item, placed ahead of its siblings.
  assert.deepEqual(stored.photos, []);
  assert.equal(stored.order, 0);
  assert.equal(typeof stored.createdAt, "number");

  // The same Idempotency-Key returns the first item instead of adding another.
  const key = { "Idempotency-Key": "retry-1" };
  const first = await post({ name: "Rake" }, key);
  const again = await post({ name: "Rake" }, key);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(store.raw.alice.filter((i) => i.name === "Rake").length, 1);

  for (const body of [{}, { name: "" }, { name: 5 }, { name: "x".repeat(201) }, { name: "a", location_id: "nope" }, { name: "a", description: 3 }]) {
    assert.equal((await post(body)).status, 422, JSON.stringify(body));
  }
  // Nobody else's container can be used as a location.
  assert.equal((await post({ name: "a", location_id: "b" })).status, 422);

  const renamed = await patch("d", { name: "Drill", description: "18V" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, "Drill");
  assert.deepEqual(renamed.body.path, ["Garage", "Shelf"]);
  // Editing leaves photos and everything else on the item alone.
  assert.deepEqual(store.raw.alice.find((i) => i.id === "d").photos, ["https://drive/secret2"]);
  assert.ok(!JSON.stringify(renamed.body).includes("secret"));

  const moved = await patch("d", { location_id: null });
  assert.deepEqual(moved.body.path, []);
  const drill = store.raw.alice.find((i) => i.id === "d");
  assert.equal(drill.locationId, null);
  assert.equal(drill.x, null);

  assert.equal((await patch("g", { location_id: "g" })).status, 422);
  assert.equal((await patch("g", { location_id: "s" })).status, 422);
  assert.equal(store.raw.alice.find((i) => i.id === "g").locationId, null);
  assert.equal((await patch("d", {})).status, 422);
  assert.equal((await patch("b", { name: "Mine now" })).status, 404);
  assert.equal(store.raw.bob[0].name, "Bobs bike");

  // Write does not include deleting.
  const del = await api(muse, "/api/v1/items/d", { accessToken, method: "DELETE" });
  assert.equal(del.status, 403);
  assert.equal(del.headers["WWW-Authenticate"], 'Bearer error="insufficient_scope", scope="inventory:delete"');
  assert.ok(store.raw.alice.some((i) => i.id === "d"));
});

test("nothing is available without a real Google sign-in, reading included", async () => {
  const { muse, call, authRequest, signIn, api } = await setup();

  // Every operation the API describes demands an access token.
  const openapi = (await call("GET", "/api/openapi.json")).body;
  const operations = [];
  for (const [path, methods] of Object.entries(openapi.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      assert.ok(op.security && op.security.length && op.security.every((s) => s.hunapuka.length), op.operationId);
      operations.push([method.toUpperCase(), `/api/v1${path.replace("{id}", "g")}`]);
    }
  }
  assert.equal(operations.length, 5);

  // An agent with a perfectly valid Session but no sign-in gets a challenge
  // on each of them, never data.
  for (const [method, path] of operations) {
    const r = await api(muse, path, { method, body: { name: "x" } });
    assert.equal(r.status, 401, `${method} ${path}`);
    assert.match(r.headers["WWW-Authenticate"], /^Bearer scope="inventory:(read|write|delete)"$/);
    assert.equal(r.body, undefined);
  }

  // Approval is refused for anything but a verified Google account, so no
  // anonymous or other Firebase account can hand out access.
  for (const idToken of ["anonymous-id-token", "password-id-token", "unverified-id-token"]) {
    const r = await call("POST", "/oauth/decision", {
      headers: { authorization: `Bearer ${idToken}` },
      body: { request: authRequest(muse), approve: true },
    });
    assert.equal(r.status, 401, idToken);
    assert.equal(r.body.redirect, undefined);
    assert.equal((await call("GET", "/oauth/connections", { headers: { authorization: `Bearer ${idToken}` } })).status, 401);
  }

  // The real thing still works.
  const { token } = await signIn(muse);
  assert.equal((await api(muse, "/api/v1/items", { accessToken: token.body.access_token })).status, 200);
});

test("delete is its own grant, removes one item at a time, and never a full container", async () => {
  const { muse, store, call, authRequest, signIn, api } = await setup();
  const all = "inventory:read inventory:write inventory:delete";
  const del = (accessToken, id) => api(muse, `/api/v1/items/${id}`, { accessToken, method: "DELETE" });

  const info = await call("POST", "/oauth/request", { body: authRequest(muse, { scope: all }) });
  assert.equal(info.body.scopes.find((s) => s.name === "inventory:delete").hints.changes, "irreversible");

  // Read plus write, with delete unticked, cannot delete.
  const noDelete = (await signIn(muse, { ask: all, allow: ["inventory:read", "inventory:write"] })).token.body;
  assert.equal(noDelete.scope, "inventory:read inventory:write");
  assert.equal((await del(noDelete.access_token, "d")).status, 403);
  assert.ok(store.raw.alice.some((i) => i.id === "d"));

  // Delete alone can delete, but cannot read or change.
  const only = (await signIn(muse, { ask: all, allow: ["inventory:delete"] })).token.body.access_token;
  assert.equal((await api(muse, "/api/v1/items", { accessToken: only })).status, 403);
  assert.equal((await api(muse, "/api/v1/items/d", { accessToken: only, method: "PATCH", body: { name: "x" } })).status, 403);

  // A container with things inside is refused, and nothing is touched.
  const full = await del(only, "g");
  assert.equal(full.status, 409);
  assert.equal(full.body.error, "not_empty");
  assert.equal(store.raw.alice.length, 3);

  assert.equal((await del(only, "b")).status, 404);
  assert.equal(store.raw.bob.length, 1);
  assert.equal((await del(only, "missing")).status, 404);

  // Leaf first, then the container it emptied.
  const gone = await del(only, "d");
  assert.equal(gone.status, 204);
  assert.equal(gone.body, undefined);
  assert.ok(!store.raw.alice.some((i) => i.id === "d"));
  assert.equal((await del(only, "d")).status, 404);
  assert.equal((await del(only, "s")).status, 204);
  assert.equal((await del(only, "g")).status, 204);
  assert.equal(store.raw.alice.length, 0);
});

test("identity checks are logged either way when enforced", async () => {
  const { muse, call, authRequest, signIn, api, identityLog } = await setup();
  await call("POST", "/oauth/request", {
    body: authRequest(muse, { client_id: "https://nobody.example/agent.json" }),
  });
  assert.deepEqual(identityLog.at(-1), {
    stage: "authorize",
    clientId: "https://nobody.example/agent.json",
    reason: "HTTP 404.",
  });
  const { token } = await signIn(muse);
  assert.ok(identityLog.some((e) => e.stage === "token" && e.clientId === muse.clientId && !e.reason));
  const before = identityLog.length;
  await api(muse, "/api/v1/items", { accessToken: token.body.access_token });
  // A passing API check is not logged on every request, only failures are.
  assert.equal(identityLog.length, before);
});

test("unenforced, an agent that cannot identify itself is logged and let through", async () => {
  const { muse, call, signIn, api, verifier, identityLog } = await setup({ enforce: false });
  const anon = { clientId: "muse-desktop", redirectUri: "https://muse.example/cb" };
  const request = {
    response_type: "code",
    client_id: anon.clientId,
    redirect_uri: anon.redirectUri,
    scope: "inventory:read",
    state: "s",
    code_challenge: sha(verifier),
    code_challenge_method: "S256",
  };

  // The consent page is shown instead of the dead end, marked unverified and
  // named by where the approval will be sent.
  const info = await call("POST", "/oauth/request", { body: request });
  assert.equal(info.body.error, undefined);
  assert.equal(info.body.client.verified, false);
  assert.equal(info.body.client.name, "muse.example");
  assert.equal(info.body.client.domain, "muse.example");
  assert.deepEqual(
    identityLog.filter((e) => e.stage === "authorize").map((e) => [e.clientId, typeof e.reason]),
    [["muse-desktop", "string"]],
  );

  // Still refused: no client_id at all, or a return address that is not HTTPS.
  assert.ok((await call("POST", "/oauth/request", { body: { ...request, client_id: undefined } })).body.error);
  for (const redirect_uri of ["http://muse.example/cb", "javascript:alert(1)", "myapp://cb", undefined]) {
    const r = await call("POST", "/oauth/request", { body: { ...request, redirect_uri } });
    assert.ok(r.body.error, String(redirect_uri));
    assert.equal(r.body.redirect, undefined);
  }
  // A person must still sign in with Google to approve.
  assert.equal((await call("POST", "/oauth/decision", { body: { request, approve: true } })).status, 401);

  const decision = await call("POST", "/oauth/decision", {
    headers: { authorization: "Bearer alice-id-token" },
    body: { request, approve: true },
  });
  const code = new URL(decision.body.redirect).searchParams.get("code");
  const exchange = (fields) =>
    call("POST", "/oauth/token", {
      body: { grant_type: "authorization_code", redirect_uri: anon.redirectUri, client_id: anon.clientId, ...fields },
    });

  // No client assertion is needed now, but PKCE and the client_id binding are.
  assert.equal((await call("POST", "/oauth/token", { body: { grant_type: "authorization_code", code } })).status, 401);
  const token = await exchange({ code, code_verifier: verifier });
  assert.equal(token.status, 200);
  assert.ok(identityLog.some((e) => e.stage === "token" && e.clientId === "muse-desktop" && e.reason));

  const second = await call("POST", "/oauth/decision", {
    headers: { authorization: "Bearer alice-id-token" },
    body: { request, approve: true },
  });
  const code2 = new URL(second.body.redirect).searchParams.get("code");
  assert.equal((await exchange({ code: code2, code_verifier: "y".repeat(43) })).body.error, "invalid_grant");

  // Plain bearer calls work with no Session header or version header...
  const bearer = { Authorization: `Bearer ${token.body.access_token}` };
  const list = await call("GET", "/api/v1/items", { headers: bearer });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  assert.ok(identityLog.some((e) => e.stage === "api" && e.reason === "The Poppy-Session header is required."));
  // ...and so does a broken Session header, which is logged with its reason.
  const broken = await call("GET", "/api/v1/items", { headers: { ...bearer, "Poppy-Session": "garbage" } });
  assert.equal(broken.status, 200);
  // But there is still no access without a token, or beyond its scope.
  assert.equal((await call("GET", "/api/v1/items")).status, 401);
  assert.equal((await call("POST", "/api/v1/items", { headers: bearer, body: { name: "x" } })).status, 403);

  // The refresh token only works for the client_id it was issued to.
  const refresh = (client_id) =>
    call("POST", "/oauth/token", {
      body: { grant_type: "refresh_token", refresh_token: token.body.refresh_token, client_id },
    });
  assert.equal((await refresh("someone-else")).body.error, "invalid_grant");
  assert.equal((await refresh("muse-desktop")).status, 200);

  // The owner sees that the connection is unverified.
  const mine = await call("GET", "/oauth/connections", { headers: { authorization: "Bearer alice-id-token" } });
  assert.equal(mine.body.connections[0].verified, false);
  assert.equal(mine.body.connections[0].domain, "muse.example");

  // An agent that does identify itself is still checked, and still held to
  // its registered addresses and to its own tokens.
  const strict = await call("POST", "/oauth/request", {
    body: { ...request, client_id: muse.clientId, redirect_uri: "https://evil.example/cb" },
  });
  assert.ok(strict.body.error);
  const proper = await signIn(muse);
  assert.equal(proper.token.status, 200);
  const stolen = await api(muse, "/api/v1/items", { accessToken: token.body.access_token });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.error, "invalid_session");
});

test("shapeItems survives a location cycle and a missing parent", () => {
  const shaped = shapeItems([
    { id: "a", name: "A", locationId: "b" },
    { id: "b", name: "B", locationId: "a" },
    { id: "c", name: "C", locationId: "gone" },
  ]);
  assert.deepEqual(shaped.find((i) => i.id === "a").path, ["B"]);
  assert.equal(shaped.find((i) => i.id === "c").location_id, null);
});
