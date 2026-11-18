// End-to-end tests of the Poppy handler with a fake Personal Agent, an
// in-memory store, and no network. Run with `npm test` from functions/.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { ClientError, createClientDirectory } = require("../src/poppy/clientMetadata");
const { createJwtVerifier } = require("../src/poppy/jwt");
const { createPoppyHandler, shapeItems } = require("../src/poppy/handler");
const { makeAgent, makeCaller, makeBrowser, JOIN } = require("../test-support/fakeAgent");

const ORIGIN = "https://hunapuka.com";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sha = (v) => createHash("sha256").update(v).digest("base64url");
const rid = () => b64(randomBytes(12));

function memoryStore(itemsByUid) {
  const codes = new Map();
  const grants = new Map();
  const access = new Map();
  const device = new Map();
  const misses = new Map();
  const browserCodes = new Map();
  const webSessions = new Map();
  return {
    async putDeviceRequest(h, d) {
      device.set(h, { ...d });
    },
    async getDeviceRequest(h) {
      return device.has(h) ? { ...device.get(h) } : null;
    },
    async findDeviceRequest(userCodeHash) {
      const hits = [...device].filter(([, d]) => d.user_code_hash === userCodeHash);
      return hits.length === 1 ? { id: hits[0][0], ...hits[0][1] } : null;
    },
    async updateDeviceRequest(h, patch) {
      Object.assign(device.get(h), patch);
    },
    async moveDeviceRequest(h, from, patch) {
      const d = device.get(h);
      if (!d || d.status !== from) return false;
      Object.assign(d, patch);
      return true;
    },
    async putBrowserCode(h, d) {
      browserCodes.set(h, { ...d });
    },
    async getBrowserCode(h) {
      return browserCodes.has(h) ? { ...browserCodes.get(h) } : null;
    },
    async moveBrowserCode(h, from, patch) {
      const d = browserCodes.get(h);
      if (!d || d.status !== from) return false;
      Object.assign(d, patch);
      return true;
    },
    async useBrowserCode(h) {
      const d = browserCodes.get(h);
      if (!d || d.status === "used") return null;
      const before = { ...d };
      d.status = "used";
      return before;
    },
    async putWebSession(h, d) {
      webSessions.set(h, { ...d });
    },
    async getWebSession(h) {
      return webSessions.has(h) ? { ...webSessions.get(h) } : null;
    },
    async getDeviceMisses(uid) {
      return misses.has(uid) ? { ...misses.get(uid) } : null;
    },
    async putDeviceMisses(uid, d) {
      misses.set(uid, { ...d });
    },
    device,
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
    async updateAccessToken(h, patch) {
      Object.assign(access.get(h), patch);
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
// `approved` is the list of approved client_ids, empty unless a test is about
// it, and `approvedOnly` makes that list the only way in.
async function setup({ enforce = true, approved = [], approvedOnly = false } = {}) {
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
  // The handler's clock, which tests can move forward. JWTs keep real time.
  const clock = { aheadMs: 0, advance: (seconds) => (clock.aheadMs += seconds * 1000) };
  const handler = createPoppyHandler({
    now: () => Date.now() + clock.aheadMs,
    enforceAgentIdentity: enforce,
    approvedClients: approved,
    approvedOnly,
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

  const call = makeCaller(handler);

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
    { accessToken, session = {}, version = "1.0", query, method = "GET", body, headers: extra = {} } = {},
  ) {
    const headers = {
      "Poppy-Session": await agent.sessionHeader({ method, path, accessToken, ...session }),
      ...extra,
    };
    if (version) headers["Poppy-Version"] = version;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return call(method, path, { headers, query, body });
  }

  // Device Sign-In, from each side: the agent starts and polls; the person
  // looks the code up and answers on the verification page.
  const as = (idToken) => (idToken ? { authorization: `Bearer ${idToken}` } : {});
  const deviceFlow = {
    start: async (agent, fields = {}) =>
      call("POST", "/oauth/device", { body: await tokenForm(agent, { scope: "inventory:read", ...fields }) }),
    poll: async (agent, deviceCode, fields = {}) =>
      call("POST", "/oauth/token", {
        body: await tokenForm(agent, { grant_type: DEVICE_GRANT, device_code: deviceCode, ...fields }),
      }),
    lookUp: (userCode, idToken = "alice-id-token") =>
      call("POST", "/oauth/device/request", { headers: as(idToken), body: { user_code: userCode } }),
    decide: (userCode, { idToken = "alice-id-token", approve: yes = true, scopes } = {}) =>
      call("POST", "/oauth/device/decision", {
        headers: as(idToken),
        body: { user_code: userCode, approve: yes, ...(scopes ? { scopes } : {}) },
      }),
  };

  return {
    muse,
    other,
    pss,
    store,
    clock,
    call,
    authRequest,
    approve,
    signIn,
    api,
    tokenForm,
    verifier,
    identityLog,
    deviceFlow,
  };
}

test("discovery documents agree with each other", async () => {
  const { call } = await setup();
  const poppy = (await call("GET", "/.well-known/poppy.json")).body;
  const resource = (await call("GET", "/.well-known/oauth-protected-resource")).body;
  const server = (await call("GET", "/.well-known/oauth-authorization-server")).body;
  assert.equal(poppy.protocol_version, "1.0");
  assert.match(poppy.protocol_version, /^[0-9]+\.[0-9]+$/);
  assert.equal(poppy.organization.domain, "hunapuka.com");
  assert.equal(resource.resource, `https://${poppy.organization.domain}`);
  assert.deepEqual(resource.authorization_servers, [server.issuer]);
  assert.equal(poppy.auth.issuer, server.issuer);
  assert.ok(server.protected_resources.includes(resource.resource));
  assert.ok(server.grant_types_supported.includes("refresh_token"));
  assert.ok(server.grant_types_supported.includes("authorization_code"));
  assert.ok(server.revocation_endpoint && server.token_endpoint && server.authorization_endpoint);
  // Device Sign-In is offered by listing its grant, which needs its endpoint.
  assert.ok(server.grant_types_supported.includes(DEVICE_GRANT));
  assert.equal(server.device_authorization_endpoint, "https://hunapuka.com/oauth/device");
  for (const scope of server.scopes_supported) {
    assert.ok(poppy.auth.scopes[scope]);
    assert.ok(poppy.auth.scope_hints[scope]);
  }
  const openapi = (await call("GET", "/api/openapi.json")).body;
  assert.equal(poppy.apis[0].url, "https://hunapuka.com/api/openapi.json");
  assert.ok(openapi.paths["/items"].get);
  for (const alg of ["ES256", "PS384"]) {
    assert.ok(server.token_endpoint_auth_signing_alg_values_supported.includes(alg));
  }
});

test("protected resource metadata is also served at addresses built from API URLs (RFC 9728)", async () => {
  const { muse, call, authRequest } = await setup();
  // A client calling https://hunapuka.com/api/v1/items may fetch the metadata
  // at the well-known address followed by that path, and must find exactly
  // that URL as `resource`.
  for (const path of ["/api/v1", "/api/v1/items", "/api/v1/items/poppy_abc123"]) {
    const r = await call("GET", `/.well-known/oauth-protected-resource${path}`);
    assert.equal(r.status, 200, path);
    assert.equal(r.body.resource, `${ORIGIN}${path}`);
    assert.deepEqual(r.body.authorization_servers, [ORIGIN]);
    assert.ok(r.body.scopes_supported.includes("inventory:read"));
  }
  // Nothing outside the API is a protected resource, and nothing odd gets through.
  for (const path of ["/browse", "/api/v2", "/api/v1x", "/api/v1/<script>", "/"]) {
    const r = await call("GET", `/.well-known/oauth-protected-resource${path}`);
    assert.equal(r.status, 404, path);
    assert.equal(r.body.error, "not_found");
  }
  // A sign-in may name the resource by any of those URLs, but not by another site.
  const ok = await call("POST", "/oauth/request", { body: authRequest(muse, { resource: `${ORIGIN}/api/v1/items` }) });
  assert.equal(ok.body.error, undefined);
  const bad = await call("POST", "/oauth/request", { body: authRequest(muse, { resource: `${ORIGIN}.evil.example/api/v1` }) });
  assert.equal(new URL(bad.body.redirect).searchParams.get("error"), "invalid_target");
});

test("0.4 is still served, in its own document that names the same Company", async () => {
  const { call } = await setup();
  const poppy = (await call("GET", "/.well-known/poppy.json")).body;
  assert.deepEqual(Object.keys(poppy.supported_versions), ["0.4"]);
  const url = new URL(poppy.supported_versions["0.4"]);
  // Same host as poppy.json, or a Personal Agent must not use it (spec 3.4).
  assert.equal(url.origin, ORIGIN);

  const older = await call("GET", url.pathname);
  assert.equal(older.status, 200);
  assert.equal(older.body.protocol_version, "0.4");
  assert.equal(older.body.supported_versions, undefined);
  assert.equal(older.body.organization.domain, poppy.organization.domain);
  assert.equal(older.body.auth.issuer, poppy.auth.issuer);
  // Nothing else differs between the two versions' documents.
  const { protocol_version: v1, supported_versions: links, ...current } = poppy;
  const { protocol_version: v0, ...previous } = older.body;
  assert.deepEqual(previous, current);
});

test("the consent page learns who is asking, and bad requests go nowhere unsafe", async () => {
  const { call, muse, authRequest } = await setup();
  const ok = await call("POST", "/oauth/request", { body: authRequest(muse) });
  assert.equal(ok.body.client.name, "Muse");
  assert.equal(ok.body.client.domain, "agent.example");
  assert.equal(ok.body.scopes[0].name, "inventory:read");

  // prompt=consent, which 1.0 agents send, changes nothing: the page is always
  // shown, and it lists every scope the request could be granted.
  const all = "inventory:read inventory:write inventory:delete";
  const prompted = await call("POST", "/oauth/request", {
    body: authRequest(muse, { scope: all, prompt: "consent" }),
  });
  assert.equal(prompted.body.error, undefined);
  assert.equal(prompted.body.redirect, undefined);
  assert.deepEqual(
    prompted.body.scopes.map((s) => s.name),
    all.split(" "),
  );

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

  // An assertion may last 5 minutes and no longer (spec 4.1). invalid_grant
  // means the assertion was accepted and only the refresh token was unknown.
  const lasting = async (options) =>
    (await post({ ...base, client_assertion: await muse.assertion(options) })).body.error;
  assert.equal(await lasting({ lifetime: 300 }), "invalid_grant");
  assert.equal(await lasting({ lifetime: 301 }), "invalid_client");
  assert.equal(await lasting({ lifetime: 3600 }), "invalid_client");
  const nowS = Math.floor(Date.now() / 1000);
  assert.equal(await lasting({ iat: nowS + 3600, lifetime: 300 }), "invalid_client");
  assert.equal(await lasting({ iat: nowS - 600, lifetime: 300 }), "invalid_client");

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
    headers: { Authorization: `Bearer ${accessToken}`, "Poppy-Version": "1.0" },
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
      "Poppy-Version": "1.0",
    },
  });
  assert.equal(stray.body.error, "invalid_session");

  // A stolen access token is useless to another agent.
  const stolen = await api(other, path, { accessToken });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.error, "invalid_session");

  // Poppy-Version must be compatible with a version served here: any 1.x,
  // since minor versions of 1 are compatible with each other, or exactly 0.4.
  for (const version of [null, "0.0", "0.3", "0.5", "2.0", "1", "1.0.0", "v1.0", "1.0, 0.4"]) {
    const r = await api(muse, path, { accessToken, version });
    assert.equal(r.status, 400, String(version));
    assert.deepEqual(r.body, { error: "version_unsupported" }, String(version));
  }
  for (const version of ["1.0", "1.1", "1.12", "0.4"]) {
    assert.equal((await api(muse, path, { accessToken, version })).status, 200, version);
  }

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

test("device sign-in: the agent polls while the person approves with a code", async () => {
  const { muse, clock, call, deviceFlow, api, tokenForm, identityLog } = await setup();
  const all = "inventory:read inventory:write inventory:delete";

  const started = await deviceFlow.start(muse, { scope: all });
  assert.equal(started.status, 200);
  assert.equal(started.headers["Cache-Control"], "no-store");
  const { device_code: deviceCode, user_code: userCode } = started.body;
  assert.match(userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.ok(deviceCode.length > 40 && !deviceCode.includes(userCode));
  // The link is on the issuer's host, or an agent must not show it (spec 4.3).
  assert.equal(started.body.verification_uri, "https://hunapuka.com/device");
  const complete = new URL(started.body.verification_uri_complete);
  assert.equal(complete.origin + complete.pathname, started.body.verification_uri);
  assert.equal(complete.searchParams.get("user_code"), userCode);
  assert.equal(started.body.expires_in, 600);
  assert.equal(started.body.interval, 5);
  assert.ok(identityLog.some((e) => e.stage === "device" && e.clientId === muse.clientId && !e.reason));

  const waiting = await deviceFlow.poll(muse, deviceCode);
  assert.equal(waiting.status, 400);
  assert.equal(waiting.body.error, "authorization_pending");

  // The page needs a real Google sign-in before it will look a code up.
  assert.equal((await deviceFlow.lookUp(userCode, null)).status, 401);
  assert.equal((await deviceFlow.lookUp(userCode, "anonymous-id-token")).status, 401);
  // Typed in lower case with a space, it is still the same code.
  const info = await deviceFlow.lookUp(userCode.toLowerCase().replace("-", " "));
  assert.equal(info.body.found, true);
  assert.equal(info.body.user_code, userCode);
  assert.deepEqual(info.body.client, {
    verified: true,
    name: "Muse",
    domain: "agent.example",
    logo_uri: null,
  });
  assert.deepEqual(
    info.body.scopes.map((s) => [s.name, s.hints.changes]),
    [
      ["inventory:read", "none"],
      ["inventory:write", "reversible"],
      ["inventory:delete", "irreversible"],
    ],
  );
  assert.equal(info.body.access_days, 90);

  // Opening the link, which is all a lookup is, approves nothing.
  clock.advance(5);
  assert.equal((await deviceFlow.poll(muse, deviceCode)).body.error, "authorization_pending");

  // The person leaves delete unticked.
  const decided = await deviceFlow.decide(userCode, { scopes: ["inventory:read", "inventory:write"] });
  assert.deepEqual(decided.body, { found: true, approved: true });
  // An answered code cannot be answered again, by anyone.
  assert.deepEqual((await deviceFlow.decide(userCode, { idToken: "bob-id-token" })).body, { found: false });
  assert.deepEqual((await deviceFlow.lookUp(userCode)).body, { found: false });

  clock.advance(5);
  const token = await deviceFlow.poll(muse, deviceCode);
  assert.equal(token.status, 200);
  assert.equal(token.body.token_type, "Bearer");
  assert.equal(token.body.scope, "inventory:read inventory:write");
  assert.ok(token.body.access_token && token.body.refresh_token && token.body.expires_in);
  const accessToken = token.body.access_token;

  // The tokens are the same kind Direct Sign-In gives: Alice's inventory,
  // within the scopes she ticked, refreshable, and listed under her agents.
  const list = await api(muse, "/api/v1/items", { accessToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  assert.equal((await api(muse, "/api/v1/items/d", { accessToken, method: "DELETE" })).status, 403);
  const refreshed = await call("POST", "/oauth/token", {
    body: await tokenForm(muse, { grant_type: "refresh_token", refresh_token: token.body.refresh_token }),
  });
  assert.equal(refreshed.status, 200);
  const mine = await call("GET", "/oauth/connections", { headers: { authorization: "Bearer alice-id-token" } });
  assert.equal(mine.body.connections.length, 1);
  assert.equal(mine.body.connections[0].name, "Muse");
  assert.equal(mine.body.connections[0].domain, "agent.example");
  assert.equal(mine.body.connections[0].verified, true);
  assert.equal(mine.body.connections[0].can_delete, false);

  // Presenting the device_code again fails and revokes what it bought.
  clock.advance(5);
  const replay = await deviceFlow.poll(muse, deviceCode);
  assert.equal(replay.body.error, "invalid_grant");
  assert.equal((await api(muse, "/api/v1/items", { accessToken })).status, 401);
});

test("a device request can be declined, expires, and belongs to the agent that started it", async () => {
  const { muse, other, clock, call, deviceFlow, tokenForm } = await setup();
  const begin = async (fields) => (await deviceFlow.start(muse, fields)).body;
  const pollError = async (agent, deviceCode) => (await deviceFlow.poll(agent, deviceCode)).body.error;

  // Another agent that learned the device_code gets nothing from it.
  const first = await begin();
  assert.equal(await pollError(other, first.device_code), "invalid_grant");
  assert.equal(await pollError(muse, "hpd_unknown"), "invalid_grant");
  const missing = await call("POST", "/oauth/token", { body: await tokenForm(muse, { grant_type: DEVICE_GRANT }) });
  assert.equal(missing.body.error, "invalid_request");

  // Polling faster than the interval is told to slow down, then forgiven.
  assert.equal(await pollError(muse, first.device_code), "authorization_pending");
  assert.equal(await pollError(muse, first.device_code), "slow_down");
  clock.advance(2);
  assert.equal(await pollError(muse, first.device_code), "slow_down");
  clock.advance(5);
  assert.equal(await pollError(muse, first.device_code), "authorization_pending");

  // Declined, and approving with nothing ticked, both end in access_denied.
  assert.deepEqual((await deviceFlow.decide(first.user_code, { approve: false })).body, {
    found: true,
    approved: false,
  });
  clock.advance(5);
  assert.equal(await pollError(muse, first.device_code), "access_denied");
  const empty = await begin({ scope: "inventory:read inventory:write" });
  assert.deepEqual((await deviceFlow.decide(empty.user_code, { scopes: [] })).body, { found: true, approved: false });
  assert.equal(await pollError(muse, empty.device_code), "access_denied");
  // Ticking a scope the agent never asked for adds nothing.
  const narrow = await begin();
  await deviceFlow.decide(narrow.user_code, { scopes: ["inventory:read", "inventory:delete"] });
  assert.equal((await deviceFlow.poll(muse, narrow.device_code)).body.scope, "inventory:read");

  // After 10 minutes the code is dead on both sides.
  const stale = await begin();
  clock.advance(601);
  assert.equal(await pollError(muse, stale.device_code), "expired_token");
  assert.deepEqual((await deviceFlow.lookUp(stale.user_code)).body, { found: false });
  assert.deepEqual((await deviceFlow.decide(stale.user_code)).body, { found: false });

  // Approved in its last seconds, it can still be collected shortly after,
  // but an approval nobody collects does not stay open.
  const late = await begin();
  const abandoned = await begin();
  clock.advance(590);
  assert.equal((await deviceFlow.decide(late.user_code)).body.approved, true);
  assert.equal((await deviceFlow.decide(abandoned.user_code)).body.approved, true);
  clock.advance(30);
  assert.equal((await deviceFlow.poll(muse, late.device_code)).status, 200);
  clock.advance(60);
  assert.equal(await pollError(muse, abandoned.device_code), "expired_token");

  // A request has to name scopes this site has, for this site, from an agent
  // that proves who it is.
  assert.equal((await deviceFlow.start(muse, { scope: undefined })).body.error, "invalid_scope");
  assert.equal((await deviceFlow.start(muse, { scope: "inventory:admin" })).body.error, "invalid_scope");
  assert.equal(
    (await deviceFlow.start(muse, { resource: "https://elsewhere.example" })).body.error,
    "invalid_target",
  );
  const anonymous = await call("POST", "/oauth/device", {
    body: { client_id: muse.clientId, scope: "inventory:read" },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, "invalid_client");
});

test("wrong device codes are counted against the account that typed them", async () => {
  const { muse, clock, deviceFlow } = await setup();
  const real = (await deviceFlow.start(muse)).body.user_code;

  // Things that could not be a code are typos and cost nothing.
  for (const typo of ["", "1234-5678", "AEIO-UAEI", "BCDF", null, "B".repeat(100)]) {
    for (let i = 0; i < 4; i += 1) {
      assert.deepEqual((await deviceFlow.lookUp(typo, "bob-id-token")).body, { found: false });
    }
  }
  assert.equal((await deviceFlow.lookUp(real, "bob-id-token")).body.found, true);

  // Ten well-formed wrong codes, and the account has to wait, even with the
  // right code in hand, to look up or to answer.
  for (let i = 0; i < 10; i += 1) {
    const miss = await deviceFlow.lookUp("BBBB-BBBB");
    assert.equal(miss.status, 200);
    assert.deepEqual(miss.body, { found: false });
  }
  const locked = await deviceFlow.lookUp(real);
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error, "too_many_attempts");
  assert.equal((await deviceFlow.decide(real)).status, 429);
  // Nobody else is held up by it.
  assert.equal((await deviceFlow.lookUp(real, "bob-id-token")).body.found, true);

  // The wait ends by itself.
  clock.advance(15 * 60 + 1);
  const fresh = (await deviceFlow.start(muse)).body.user_code;
  assert.equal((await deviceFlow.lookUp(fresh)).body.found, true);
});

test("unenforced, an unidentified agent can use device sign-in but is shown as unverified", async () => {
  const { muse, call, deviceFlow, identityLog } = await setup({ enforce: false });
  const begin = (body) => call("POST", "/oauth/device", { body });
  const poll = (deviceCode, clientId) =>
    call("POST", "/oauth/token", {
      body: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: clientId },
    });

  // Something to bind the request to is still needed.
  assert.equal((await begin({ scope: "inventory:read" })).status, 401);
  assert.equal((await begin({ client_id: "x".repeat(2001), scope: "inventory:read" })).status, 401);

  const started = await begin({ client_id: "muse-cli", scope: "inventory:read" });
  assert.equal(started.status, 200);
  assert.ok(identityLog.some((e) => e.stage === "device" && e.clientId === "muse-cli" && e.reason));

  // The page is told nothing it could mistake for a confirmed name or address.
  const info = await deviceFlow.lookUp(started.body.user_code);
  assert.deepEqual(info.body.client, { verified: false, name: "", domain: "", logo_uri: null });
  // A person must still sign in with Google and approve.
  assert.equal((await deviceFlow.decide(started.body.user_code, { idToken: null })).status, 401);
  assert.equal((await deviceFlow.decide(started.body.user_code)).body.approved, true);

  // Only the client_id the request was started with can collect.
  assert.equal((await poll(started.body.device_code, "someone-else")).body.error, "invalid_grant");
  const token = await poll(started.body.device_code, "muse-cli");
  assert.equal(token.status, 200);
  const list = await call("GET", "/api/v1/items", {
    headers: { Authorization: `Bearer ${token.body.access_token}` },
  });
  assert.equal(list.body.total, 3);

  // The owner sees that the connection is unverified, and no invented address.
  const mine = await call("GET", "/oauth/connections", { headers: { authorization: "Bearer alice-id-token" } });
  assert.equal(mine.body.connections[0].verified, false);
  assert.equal(mine.body.connections[0].name, "Unidentified agent");
  assert.equal(mine.body.connections[0].domain, "");

  // An agent that does prove itself is named, and held to its own device_code.
  const proper = await deviceFlow.start(muse);
  const shown = await deviceFlow.lookUp(proper.body.user_code);
  assert.equal(shown.body.client.verified, true);
  assert.equal(shown.body.client.name, "Muse");
  // Claiming Muse's client_id without its keys is not being Muse.
  const impostor = await begin({ client_id: muse.clientId, scope: "inventory:read" });
  assert.equal((await deviceFlow.lookUp(impostor.body.user_code)).body.client.verified, false);
});

const MUSE_ID = "https://agent.example/agent.json";
const DOWN_ID = "https://down.example/agent.json";

test("this site ships with Muse approved, and only approved agents let in", () => {
  const { APPROVED_CLIENTS, APPROVED_CLIENTS_ONLY } = require("../src/poppy/config");
  assert.ok(APPROVED_CLIENTS.includes("https://muse.ai/poppy/agent.json"));
  assert.equal(APPROVED_CLIENTS_ONLY, true);
  for (const id of APPROVED_CLIENTS) assert.equal(new URL(id).protocol, "https:");
});

test("nobody can start a sign-in under an approved agent's client_id without being it", async () => {
  // Identity is not enforced, so an unknown agent is still served unverified.
  // DOWN_ID is approved but its metadata cannot be fetched right now.
  const { muse, call, authRequest, signIn, deviceFlow, verifier } = await setup({
    enforce: false,
    approved: [MUSE_ID, DOWN_ID],
  });
  const request = (client_id) => ({
    response_type: "code",
    client_id,
    redirect_uri: "https://elsewhere.example/cb",
    scope: "inventory:read",
    state: "s",
    code_challenge: sha(verifier),
    code_challenge_method: "S256",
  });
  const device = (client_id) => call("POST", "/oauth/device", { body: { client_id, scope: "inventory:read" } });

  // At the consent page: an agent that is not on the list gets the unverified
  // page, but an approved one whose metadata does not check out gets nothing.
  assert.equal((await call("POST", "/oauth/request", { body: request("https://nobody.example/a.json") })).body.client.verified, false);
  for (const id of [DOWN_ID, MUSE_ID]) {
    const refused = await call("POST", "/oauth/request", { body: request(id) });
    assert.ok(refused.body.error, id);
    assert.equal(refused.body.client, undefined);
    const decided = await call("POST", "/oauth/decision", {
      headers: { authorization: "Bearer alice-id-token" },
      body: { request: request(id), approve: true },
    });
    assert.ok(decided.body.error, id);
    assert.equal(decided.body.redirect, undefined);
  }

  // Device Sign-In: claiming an approved client_id takes its signature.
  assert.equal((await device("muse-cli")).status, 200);
  for (const id of [DOWN_ID, MUSE_ID]) {
    const refused = await device(id);
    assert.equal(refused.status, 401, id);
    assert.equal(refused.body.error, "invalid_client");
  }

  // The approved agent itself is unaffected, both ways in.
  assert.equal((await call("POST", "/oauth/request", { body: authRequest(muse) })).body.client.verified, true);
  assert.equal((await signIn(muse)).token.status, 200);
  const started = await deviceFlow.start(muse);
  assert.equal(started.status, 200);
  assert.equal((await deviceFlow.lookUp(started.body.user_code)).body.client.name, "Muse");
});

test("approved-only: agents that are not on the list are refused everywhere", async () => {
  const { hashToken } = require("../src/poppy/handler");
  const { muse, other, store, call, authRequest, signIn, deviceFlow, api, tokenForm, identityLog } = await setup({
    enforce: false,
    approved: [MUSE_ID],
    approvedOnly: true,
  });

  // `other` proves who it is perfectly well. It is just not approved.
  const page = await call("POST", "/oauth/request", { body: authRequest(other) });
  assert.match(page.body.error, /approved/);
  assert.equal(page.body.client, undefined);
  assert.ok(identityLog.some((e) => e.stage === "authorize" && e.clientId === other.clientId && e.reason));
  const decided = await call("POST", "/oauth/decision", {
    headers: { authorization: "Bearer alice-id-token" },
    body: { request: authRequest(other), approve: true },
  });
  assert.ok(decided.body.error);
  assert.equal(decided.body.redirect, undefined);

  const device = await deviceFlow.start(other);
  assert.equal(device.status, 401);
  assert.equal(device.body.error, "invalid_client");
  const refresh = await call("POST", "/oauth/token", {
    body: await tokenForm(other, { grant_type: "refresh_token", refresh_token: "hpr_x" }),
  });
  assert.equal(refresh.status, 401);
  assert.equal(refresh.body.error, "invalid_client");

  // Nor does skipping identity help: an unidentified agent is not on the list.
  const unidentified = { ...authRequest(other), client_id: "muse-cli", redirect_uri: "https://muse.example/cb" };
  assert.ok((await call("POST", "/oauth/request", { body: unidentified })).body.error);
  assert.equal((await call("POST", "/oauth/request", { body: { ...unidentified, client_id: undefined } })).body.client, undefined);
  for (const body of [{ client_id: "muse-cli", scope: "inventory:read" }, { scope: "inventory:read" }]) {
    assert.equal((await call("POST", "/oauth/device", { body })).status, 401);
  }

  // A token such an agent got before the list closed stops working at the API.
  await store.putAccessToken(hashToken("hpa_from_before"), {
    uid: "alice",
    client_id: other.clientId,
    scope: "inventory:read",
    grant_id: "g",
    expires_at: Date.now() + 60000,
  });
  const old = await api(other, "/api/v1/items", { accessToken: "hpa_from_before" });
  assert.equal(old.status, 401);
  assert.equal(old.headers["WWW-Authenticate"], 'Bearer error="invalid_token"');

  // The approved agent signs in and works as usual, both ways in.
  const { token } = await signIn(muse);
  assert.equal(token.status, 200);
  assert.equal((await api(muse, "/api/v1/items", { accessToken: token.body.access_token })).status, 200);
  const started = await deviceFlow.start(muse);
  assert.equal((await deviceFlow.decide(started.body.user_code)).body.approved, true);
  assert.equal((await deviceFlow.poll(muse, started.body.device_code)).status, 200);
});

// A browser the agent controls: it keeps whatever cookie the site last set.
const WEB = "inventory:read poppy:browser-sign-in";

test("web browsing: the agent's browser joins its Session and sees the inventory read-only", async () => {
  const { muse, store, clock, call, signIn, api } = await setup();
  const authorize = (code, accessToken) =>
    api(muse, `${JOIN}/authorize`, { method: "POST", accessToken, body: { code } });

  const poppy = (await call("GET", "/.well-known/poppy.json")).body;
  assert.deepEqual(poppy.web, { browser_session_endpoint: `${ORIGIN}${JOIN}` });
  assert.ok(poppy.auth.scopes["poppy:browser-sign-in"]);
  const server = (await call("GET", "/.well-known/oauth-authorization-server")).body;
  assert.ok(server.scopes_supported.includes("poppy:browser-sign-in"));

  const accessToken = (await signIn(muse, { ask: WEB })).token.body.access_token;
  const browser = makeBrowser(call);
  assert.equal((await browser.visit("GET", "/browse")).status, 401);

  // Step 1: a form with a one-time code, and a cookie tying it to this browser.
  const { page, code } = await browser.loadJoinPage();
  assert.equal(page.status, 200);
  assert.match(page.body, /<form method="post" action="\/poppy\/browser-session">/);
  assert.equal(page.headers["Cache-Control"], "no-store");
  assert.match(page.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(page.headers["Cross-Origin-Opener-Policy"], "same-origin");
  for (const attribute of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) {
    assert.ok(page.headers["Set-Cookie"].includes(attribute), attribute);
  }
  assert.ok(!page.headers["Set-Cookie"].includes(code));
  // Loading the page signs nothing in.
  assert.equal((await browser.visit("GET", "/browse")).status, 401);

  // Step 2: only the agent can authorize the code, once, and only a code we issued.
  assert.deepEqual((await authorize("bc_made_up", accessToken)).body, { error: "invalid_request" });
  const readOnly = (await signIn(muse)).token.body.access_token;
  const noScope = await authorize(code, readOnly);
  assert.equal(noScope.status, 403);
  assert.equal(noScope.headers["WWW-Authenticate"], 'Bearer error="insufficient_scope", scope="poppy:browser-sign-in"');
  assert.equal((await authorize(code, accessToken)).status, 204);
  assert.equal((await authorize(code, accessToken)).status, 400);

  // Step 3: the browser that loaded the page trades the code for the cookie.
  const joined = await browser.submit(code);
  assert.equal(joined.status, 303);
  assert.equal(joined.headers.Location, "/browse");
  assert.ok(!browser.cookie.includes("j."));
  assert.ok(!browser.cookie.includes(accessToken));
  assert.equal((await browser.submit(code)).status, 400);

  // The inventory, as pages: top level, a container, an item, a search.
  store.raw.alice.push({ id: "x", name: "<script>alert(1)</script>", description: "a & b", locationId: null });
  const top = await browser.visit("GET", "/browse");
  assert.equal(top.status, 200);
  assert.match(top.headers["Content-Type"], /^text\/html/);
  assert.match(top.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.ok(top.body.includes('<a href="/browse/items/g">Garage</a>'));
  assert.ok(!top.body.includes("Shelf") && !top.body.includes("Bobs"));
  assert.ok(top.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !top.body.includes("<script>"));
  assert.ok(top.body.includes("Read-only view of this inventory for Muse"));
  const garage = await browser.visit("GET", "/browse/items/g");
  assert.ok(garage.body.includes('<a href="/browse/items/s">Shelf</a>'));
  const drill = await browser.visit("GET", "/browse/items/d");
  assert.ok(drill.body.includes("Cordless drill") && drill.body.includes("18V with two batteries"));
  assert.ok(drill.body.indexOf("Garage") < drill.body.indexOf("Shelf"));
  const found = await browser.visit("GET", "/browse", { query: { q: "DRILL" } });
  assert.ok(found.body.includes("1 result") && found.body.includes("Garage › Shelf"));
  for (const html of [top.body, garage.body, drill.body, found.body]) {
    assert.ok(!html.includes("drive/secret") && !html.includes(accessToken));
  }
  // Someone else's item is not there, and there is nothing to post to.
  assert.equal((await browser.visit("GET", "/browse/items/b")).status, 404);
  assert.equal((await browser.visit("POST", "/browse", { body: { name: "x" } })).status, 404);
  assert.equal((await browser.visit("DELETE", "/browse/items/d")).status, 404);
  assert.ok(store.raw.alice.some((i) => i.id === "d"));

  // Loading the join page again leaves the browser signed in.
  await browser.loadJoinPage();
  assert.equal((await browser.visit("GET", "/browse")).status, 200);

  // A code is dead after five minutes, and the web session after an hour.
  const late = await browser.loadJoinPage();
  clock.advance(301);
  assert.equal((await authorize(late.code, accessToken)).status, 400);
  clock.advance(3600);
  assert.equal((await browser.visit("GET", "/browse")).status, 401);
});

test("web browsing: a code works only in its own browser, and only with the person's approval", async () => {
  const { muse, call, signIn, api } = await setup();
  const authorize = (code, accessToken) =>
    api(muse, `${JOIN}/authorize`, { method: "POST", accessToken, body: { code } });
  const signedIn = await signIn(muse, { ask: WEB });
  const accessToken = signedIn.token.body.access_token;

  // A code is no use in a browser that did not load its page, and trying
  // there uses it up. Nor is it any use before the agent has authorized it.
  const browser = makeBrowser(call);
  const thief = makeBrowser(call);
  const first = await browser.loadJoinPage();
  await thief.loadJoinPage();
  assert.equal((await authorize(first.code, accessToken)).status, 204);
  const stolen = await thief.submit(first.code);
  assert.equal(stolen.status, 400);
  assert.equal(stolen.headers["Set-Cookie"], undefined);
  assert.equal((await browser.submit(first.code)).status, 400);
  const early = await browser.loadJoinPage();
  assert.equal((await browser.submit(early.code)).status, 400);
  assert.equal((await authorize(early.code, accessToken)).status, 400);
  assert.equal((await browser.visit("GET", "/browse")).status, 401);

  // Authorizing without an access token is refused, naming the scope a
  // sign-in needs, and leaves the code unauthorized: the browser cannot join.
  const signedOut = await browser.loadJoinPage();
  const noToken = await authorize(signedOut.code);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.headers["WWW-Authenticate"], 'Bearer scope="poppy:browser-sign-in"');
  const refused = await browser.submit(signedOut.code);
  assert.equal(refused.status, 400);
  assert.ok(refused.body.includes("had not authorized this code"));
  assert.equal((await browser.visit("GET", "/browse")).status, 401);

  // The browser scope alone opens nothing: the pages apply inventory:read.
  const browserOnly = (await signIn(muse, { ask: WEB, allow: ["poppy:browser-sign-in"] })).token.body.access_token;
  const again = await browser.loadJoinPage();
  assert.equal((await authorize(again.code, browserOnly)).status, 204);
  assert.equal((await browser.submit(again.code)).status, 303);
  const noRead = await browser.visit("GET", "/browse");
  assert.equal(noRead.status, 403);
  assert.ok(noRead.body.includes("inventory:read") && !noRead.body.includes("Garage"));

  // Joined properly, then the owner disconnects the agent: the very next
  // page load is signed out.
  const proper = await browser.loadJoinPage();
  assert.equal((await authorize(proper.code, accessToken)).status, 204);
  assert.equal((await browser.submit(proper.code)).status, 303);
  assert.equal((await browser.visit("GET", "/browse/items/g")).status, 200);
  const owner = { authorization: "Bearer alice-id-token" };
  const mine = (await call("GET", "/oauth/connections", { headers: owner })).body.connections;
  for (const connection of mine) {
    await call("POST", "/oauth/connections/revoke", { headers: owner, body: { id: connection.id } });
  }
  const after = await browser.visit("GET", "/browse/items/g");
  assert.equal(after.status, 403);
  assert.ok(!after.body.includes("Shelf"));

  // The authorize call is checked like any API call: it needs the Session header.
  const fresh = await browser.loadJoinPage();
  const bare = await call("POST", `${JOIN}/authorize`, { body: { code: fresh.code } });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error, "invalid_session");
});

test("identity checks are logged either way when enforced", async () => {
  const { muse, store, clock, call, authRequest, signIn, api, identityLog } = await setup();
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
  // Every request from a verified Session is logged with the agent's Session
  // ID and its ID for the person, so one Session can be followed.
  const before = identityLog.length;
  await api(muse, "/api/v1/items", { accessToken: token.body.access_token });
  assert.equal(identityLog.length, before + 1);
  const entry = identityLog.at(-1);
  assert.equal(entry.stage, "api");
  assert.equal(entry.clientId, muse.clientId);
  assert.equal(entry.sid, "sid_1");
  assert.equal(entry.user, "usr_1");
  assert.equal(entry.request, "GET /api/v1/items");
  assert.equal(entry.reason, undefined);
  // The sign-in it used remembers the Session, written once, not per request.
  const grant = await store.getGrant(entry.grantId);
  assert.equal(grant.last_session_id, "sid_1");
  assert.equal(grant.last_session_user, "usr_1");
  const at = grant.last_session_at;
  clock.advance(5);
  await api(muse, "/api/v1/items", { accessToken: token.body.access_token });
  assert.equal(identityLog.length, before + 2);
  assert.equal((await store.getGrant(entry.grantId)).last_session_at, at);
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
