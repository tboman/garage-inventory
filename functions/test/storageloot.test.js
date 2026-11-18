// End-to-end tests of public agent browsing on storageloot.shop: the
// anonymous browser join and the read-only listing pages, with a fake agent,
// an in-memory store, and no network. Run with `npm test` from functions/.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ClientError, createClientDirectory } = require("../src/poppy/clientMetadata");
const { createJwtVerifier } = require("../src/poppy/jwt");
const { createStorageLootHandler } = require("../src/poppy/storageloot");
const { makeAgent, makeCaller, makeBrowser, JOIN, b64, sha } = require("../test-support/fakeAgent");
const { memoryAuthStore } = require("../test-support/memoryAuthStore");
const { randomBytes } = require("node:crypto");

const ORIGIN = "https://storageloot.shop";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const PHOTO = "https://firebasestorage.googleapis.com/v0/b/bucket/o/listings%2Fdrill%2F0.jpg?alt=media";

const LISTINGS = [
  {
    id: "drill",
    sellerId: "alice-uid",
    sellerDisplayName: "Alice",
    title: "Cordless drill",
    description: "18V with two batteries",
    price: 4500,
    currency: "USD",
    condition: "good",
    category: "tools",
    photos: [PHOTO, "https://evil.example/tracker.gif"],
    status: "active",
    createdAt: 3,
  },
  {
    id: "sofa",
    sellerId: "bob-uid",
    sellerDisplayName: "Bob",
    title: "Leather sofa",
    description: "Brown, three seats",
    price: 20000,
    currency: "USD",
    condition: "fair",
    category: "furniture",
    photos: [],
    status: "active",
    createdAt: 2,
  },
  { id: "bike", title: "Sold bike", price: 100, status: "sold", category: "sports", createdAt: 1 },
  { id: "draft", title: "Secret draft", price: 100, status: "draft", category: "tools", createdAt: 0 },
];

function memoryStore() {
  const browserCodes = new Map();
  const webSessions = new Map();
  const conversations = new Map();
  const messages = new Map(); // conversation id -> [message]
  const auth = memoryAuthStore();
  let nextId = 1;
  const names = { "alice-uid": "Alice", "bob-uid": "Bob", "carol-uid": "Carol" };
  return {
    ...auth,
    conversations,
    messages,
    async getConversation(id) {
      return conversations.has(id) ? { id, ...conversations.get(id) } : null;
    },
    async listConversations(uid) {
      return [...conversations]
        .filter(([, c]) => c.participants.includes(uid))
        .sort(([, a], [, b]) => b.lastMessageAt - a.lastMessageAt)
        .map(([id, c]) => ({ id, ...c }));
    },
    async listMessages(id) {
      return (messages.get(id) || []).map((m) => ({ ...m }));
    },
    async postMessage(id, { create, patch, message }) {
      if (conversations.has(id)) Object.assign(conversations.get(id), patch);
      else if (create) conversations.set(id, { ...create });
      else return null;
      const msg = { id: `m${nextId++}`, ...message };
      messages.set(id, [...(messages.get(id) || []), msg]);
      return msg.id;
    },
    async getUserName(uid) {
      return names[uid] || null;
    },
    async takeMessageAllowance(grantId, nowMs, limit, windowMs) {
      const g = auth.grants.get(grantId);
      if (!g) return false;
      const fresh = !(g.message_window_start + windowMs > nowMs);
      const count = fresh ? 0 : g.message_count || 0;
      if (count >= limit) return false;
      g.message_window_start = fresh ? nowMs : g.message_window_start;
      g.message_count = count + 1;
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
    async listActiveListings() {
      return LISTINGS.filter((l) => l.status === "active").map((l) => ({ ...l }));
    },
    async getListing(id) {
      const l = LISTINGS.find((x) => x.id === id);
      return l ? { ...l } : null;
    },
    webSessions,
  };
}

async function setup({ approvedOnly = true, enforce = true } = {}) {
  const muse = await makeAgent("agent.example", { origin: ORIGIN });
  const other = await makeAgent("other.example", { origin: ORIGIN });
  const docs = { ...muse.documents, ...other.documents };
  const clients = createClientDirectory({
    fetchJson: async (url) => {
      if (!docs[url]) throw new ClientError("HTTP 404.");
      return docs[url];
    },
  });
  const store = memoryStore();
  const clock = { aheadMs: 0, advance: (seconds) => (clock.aheadMs += seconds * 1000) };
  const identityLog = [];
  const handler = createStorageLootHandler({
    store,
    clients,
    jwt: createJwtVerifier({ clients, issuer: ORIGIN, origin: ORIGIN }),
    verifyIdToken: async (t) => {
      const google = { email_verified: true, firebase: { sign_in_provider: "google.com" } };
      const who = { "alice-id-token": "alice-uid", "bob-id-token": "bob-uid", "carol-id-token": "carol-uid" }[t];
      if (who) return { uid: who, ...google };
      throw new Error("bad token");
    },
    now: () => Date.now() + clock.aheadMs,
    enforceAgentIdentity: enforce,
    approvedClients: [muse.clientId],
    approvedOnly,
    logIdentity: (entry) => identityLog.push(entry),
  });
  const call = makeCaller(handler);

  // Direct Sign-In for `idToken`'s person, asking for `scope`.
  const verifier = b64(randomBytes(32));
  const tokenForm = async (agent, fields) => ({
    client_assertion_type: ASSERTION_TYPE,
    client_assertion: await agent.assertion(),
    ...fields,
  });
  async function signIn(agent, { idToken = "bob-id-token", scope = "messages:read messages:send" } = {}) {
    const decision = await call("POST", "/oauth/decision", {
      headers: { authorization: `Bearer ${idToken}` },
      body: {
        request: {
          response_type: "code",
          client_id: agent.clientId,
          redirect_uri: agent.redirectUri,
          scope,
          state: "st8",
          code_challenge: sha(verifier),
          code_challenge_method: "S256",
        },
        approve: true,
      },
    });
    const back = new URL(decision.body.redirect);
    const code = back.searchParams.get("code");
    const token = await call("POST", "/oauth/token", {
      body: await tokenForm(agent, {
        grant_type: "authorization_code",
        code,
        redirect_uri: agent.redirectUri,
        code_verifier: verifier,
      }),
    });
    return { back, token };
  }

  async function api(agent, path, { accessToken, method = "GET", body, query, version = "1.0" } = {}) {
    const headers = { "Poppy-Session": await agent.sessionHeader({ method, path, accessToken }) };
    if (version) headers["Poppy-Version"] = version;
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return call(method, path, { headers, body, query });
  }

  // The agent authorizes its browser's code with its Session header alone.
  async function authorize(agent, code, { version = "1.0", session = {}, headers: extra = {} } = {}) {
    const path = `${JOIN}/authorize`;
    const headers = { "Poppy-Session": await agent.sessionHeader({ method: "POST", path, ...session }), ...extra };
    if (version) headers["Poppy-Version"] = version;
    return call("POST", path, { headers, body: { code } });
  }

  return { muse, other, store, clock, call, authorize, identityLog, signIn, api, tokenForm };
}

test("discovery: storageloot.shop is its own issuer, with message scopes, an API, and browsing", async () => {
  const { call } = await setup();
  const poppy = (await call("GET", "/.well-known/poppy.json")).body;
  assert.equal(poppy.protocol_version, "1.0");
  assert.deepEqual(poppy.organization, { name: "StorageLoot", domain: "storageloot.shop", logo_uri: `${ORIGIN}/logo512.png` });
  assert.equal(poppy.auth.issuer, ORIGIN);
  assert.deepEqual(Object.keys(poppy.auth.scopes).sort(), ["messages:read", "messages:send"]);
  assert.deepEqual(Object.keys(poppy.auth.scope_hints).sort(), ["messages:read", "messages:send"]);
  assert.equal(poppy.apis[0].url, `${ORIGIN}/api/openapi.json`);
  assert.deepEqual(poppy.web, { browser_session_endpoint: `${ORIGIN}${JOIN}` });

  const server = (await call("GET", "/.well-known/oauth-authorization-server")).body;
  assert.equal(server.issuer, ORIGIN);
  assert.deepEqual(server.grant_types_supported, ["authorization_code", "refresh_token", DEVICE_GRANT]);
  assert.equal(server.token_endpoint, `${ORIGIN}/oauth/token`);
  assert.equal(server.device_authorization_endpoint, `${ORIGIN}/oauth/device`);
  assert.deepEqual(server.scopes_supported.sort(), ["messages:read", "messages:send"]);

  const resource = (await call("GET", "/.well-known/oauth-protected-resource")).body;
  assert.equal(resource.resource, ORIGIN);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  // A client may build the metadata address from an API URL (RFC 9728).
  const forApi = await call("GET", "/.well-known/oauth-protected-resource/api/v1/conversations");
  assert.equal(forApi.status, 200);
  assert.equal(forApi.body.resource, `${ORIGIN}/api/v1/conversations`);
  // Anything else under the metadata path is a JSON 404, never the web app.
  const suffixed = await call("GET", "/.well-known/oauth-protected-resource/browse");
  assert.equal(suffixed.status, 404);
  assert.equal(suffixed.body.error, "not_found");

  const openapi = (await call("GET", "/api/openapi.json")).body;
  assert.equal(openapi.servers[0].url, `${ORIGIN}/api/v1`);
  assert.ok(openapi.paths["/listings/{id}/messages"].post);
  assert.ok(openapi.paths["/conversations/{id}/messages"].post);
});

test("anonymous join: the agent's browser joins and browses active listings read-only", async () => {
  const { muse, store, clock, call, authorize, identityLog } = await setup();
  const browser = makeBrowser(call);
  assert.equal((await browser.visit("GET", "/browse")).status, 401);

  // Clicking Continue before the agent authorizes uses the code up.
  const early = await browser.loadJoinPage();
  const tooSoon = await browser.submit(early.code);
  assert.equal(tooSoon.status, 400);
  assert.match(tooSoon.body, /had not authorized this code/);

  // Loading the page again starts a new join; only its code fits this browser.
  const { page, code } = await browser.loadJoinPage();
  assert.equal(page.status, 200);
  assert.match(page.body, /StorageLoot/);
  assert.ok(page.headers["Set-Cookie"].startsWith("__session="));

  // The agent authorizes with its Session header only, and it is logged.
  assert.equal((await authorize(muse, code)).status, 204);
  assert.deepEqual(identityLog.at(-1), {
    stage: "web",
    clientId: muse.clientId,
    sid: "sid_1",
    user: "usr_1",
    request: `POST ${JOIN}/authorize`,
  });
  assert.equal((await authorize(muse, code)).status, 400);

  const joined = await browser.submit(code);
  assert.equal(joined.status, 303);
  assert.equal(joined.headers.Location, "/browse");
  const [session] = [...store.webSessions.values()];
  assert.equal(session.uid, null);
  assert.equal(session.grant_id, null);
  assert.equal(session.sid, "sid_1");
  assert.equal(session.client_id, muse.clientId);

  // The listings: active only, newest first, photos from Firebase Storage only.
  const home = await browser.visit("GET", "/browse");
  assert.equal(home.status, 200);
  assert.match(home.body, /2 active listings/);
  assert.ok(home.body.indexOf("Cordless drill") < home.body.indexOf("Leather sofa"));
  assert.ok(!home.body.includes("Sold bike") && !home.body.includes("Secret draft"));
  assert.match(home.body, /\$45\.00/);
  assert.ok(home.body.includes(PHOTO.replace(/&/g, "&amp;")));
  assert.ok(!home.body.includes("evil.example"));
  assert.match(home.headers["Content-Security-Policy"], /img-src https:\/\/firebasestorage\.googleapis\.com https:\/\/storage\.googleapis\.com/);
  assert.ok(!home.body.includes("alice-uid"));
  assert.ok(!/<form[^>]*method="post"/i.test(home.body));

  // Search and category filter.
  const search = await browser.visit("GET", "/browse", { query: { q: "BATTERIES" } });
  assert.match(search.body, /1 listing for “BATTERIES”/);
  assert.ok(search.body.includes("Cordless drill") && !search.body.includes("Leather sofa"));
  const furniture = await browser.visit("GET", "/browse", { query: { category: "furniture" } });
  assert.ok(furniture.body.includes("Leather sofa") && !furniture.body.includes("Cordless drill"));
  const bogus = await browser.visit("GET", "/browse", { query: { category: "<script>" } });
  assert.match(bogus.body, /2 active listings/);

  // One listing, and nothing that is not public.
  const drill = await browser.visit("GET", "/browse/listings/drill");
  assert.equal(drill.status, 200);
  assert.match(drill.body, /Cordless drill/);
  assert.match(drill.body, /Condition: Good · Category: Tools · Seller: Alice/);
  assert.match(drill.body, /href="\/listing\/drill"/);
  for (const hidden of ["bike", "draft", "nope", "..%2F..", "a".repeat(65)]) {
    assert.equal((await browser.visit("GET", `/browse/listings/${hidden}`)).status, 404, hidden);
  }
  // Read only: nothing but GET is served under /browse.
  assert.equal((await browser.visit("POST", "/browse", { body: { title: "x" } })).status, 404);
  assert.equal((await browser.visit("DELETE", "/browse/listings/drill")).status, 404);

  // The web session lasts an hour.
  clock.advance(3601);
  assert.equal((await browser.visit("GET", "/browse")).status, 401);
});

test("anonymous join: only an approved agent with a valid Session header can authorize", async () => {
  const { muse, other, call, authorize, identityLog } = await setup();
  const browser = makeBrowser(call);
  const fresh = async () => (await browser.loadJoinPage()).code;

  // No Session header at all.
  const bare = await call("POST", `${JOIN}/authorize`, { body: { code: await fresh() } });
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error, "invalid_session");
  assert.equal(identityLog.at(-1).reason, "The Poppy-Session header is required.");

  // A well-identified agent that is not approved.
  const stranger = await authorize(other, await fresh());
  assert.equal(stranger.status, 400);
  assert.equal(stranger.body.error, "invalid_session");
  assert.match(stranger.body.error_description, /not on the list of approved agents/);

  // A Session addressed to hunapuka.com is no good here.
  const elsewhere = await authorize(muse, await fresh(), { session: { to: "https://hunapuka.com" } });
  assert.equal(elsewhere.status, 400);
  assert.equal(elsewhere.body.error, "invalid_session");

  // This site issues no tokens, so a bearer token is refused rather than ignored.
  const withToken = await authorize(muse, await fresh(), { headers: { Authorization: "Bearer hpa_whatever" } });
  assert.equal(withToken.status, 400);
  assert.equal(withToken.body.error, "invalid_request");
  assert.match(withToken.body.error_description, /issues no access tokens/);

  // A protocol version this site does not speak.
  const old = await authorize(muse, await fresh(), { version: "2.0" });
  assert.equal(old.status, 400);
  assert.equal(old.body.error, "version_unsupported");

  // None of those joined the browser.
  assert.equal((await browser.visit("GET", "/browse")).status, 401);
});

test("anonymous join: a code works only in its own browser and only for five minutes", async () => {
  const { muse, clock, call, authorize } = await setup();
  const browser = makeBrowser(call);
  const thief = makeBrowser(call);

  const { code } = await browser.loadJoinPage();
  await thief.loadJoinPage();
  assert.equal((await authorize(muse, code)).status, 204);
  const stolen = await thief.submit(code);
  assert.equal(stolen.status, 400);
  assert.match(stolen.body, /different browser/);
  // Trying it elsewhere used it up.
  assert.equal((await browser.submit(code)).status, 400);

  const late = await browser.loadJoinPage();
  clock.advance(301);
  assert.equal((await authorize(muse, late.code)).status, 400);
  assert.equal((await browser.visit("GET", "/browse")).status, 401);
});

test("replay: a Session JWT used on one instance is refused on another sharing the record", async () => {
  const { memoryUsedIds } = require("../src/poppy/jwt");
  const agent = await makeAgent("agent.example", { origin: ORIGIN });
  const clients = createClientDirectory({ fetchJson: async (url) => agent.documents[url] });
  const usedIds = memoryUsedIds();
  // Two function instances: separate verifiers, one shared replay record.
  const first = createJwtVerifier({ clients, issuer: ORIGIN, origin: ORIGIN, usedIds });
  const second = createJwtVerifier({ clients, issuer: ORIGIN, origin: ORIGIN, usedIds });
  const path = `${JOIN}/authorize`;
  const header = await agent.sessionHeader({ method: "POST", path });
  await first.verifySession(header, { method: "POST", path, accessToken: null });
  await assert.rejects(
    second.verifySession(header, { method: "POST", path, accessToken: null }),
    /already used/,
  );
  // Without the shared record, the second instance would have accepted it.
  const isolated = createJwtVerifier({ clients, issuer: ORIGIN, origin: ORIGIN });
  await isolated.verifySession(header, { method: "POST", path, accessToken: null });
});

test("cleanup: deletes every expired record, not just the first batch", async () => {
  const { deleteExpiredIn } = require("../src/poppy/store");
  const docs = new Map(Array.from({ length: 1003 }, (_, i) => [`c${i}`, { expires_at: i < 1001 ? 1 : 10 }]));
  const db = {
    collection: () => ({
      where: (_f, _op, nowMs) => ({
        limit: (n) => ({
          get: async () => {
            const hit = [...docs].filter(([, d]) => d.expires_at < nowMs).slice(0, n);
            return { empty: !hit.length, size: hit.length, docs: hit.map(([id]) => ({ ref: id })) };
          },
        }),
      }),
    }),
    batch: () => {
      const refs = [];
      return { delete: (r) => refs.push(r), commit: async () => refs.forEach((r) => docs.delete(r)) };
    },
  };
  assert.equal(await deleteExpiredIn(db, ["storageloot_poppy_browser_codes"], 5), 1001);
  assert.equal(docs.size, 2);
});

// ---- Sign-in and the messages API ------------------------------------------

test("sign-in: Direct Sign-In grants storageloot's own scopes and tokens", async () => {
  const { muse, call, signIn } = await setup();
  const { back, token } = await signIn(muse);
  assert.equal(back.searchParams.get("iss"), ORIGIN);
  assert.equal(token.status, 200);
  assert.match(token.body.access_token, /^sla_/);
  assert.match(token.body.refresh_token, /^slr_/);
  assert.equal(token.body.scope, "messages:read messages:send");

  // hunapuka.com's scopes mean nothing here.
  const wrong = await call("POST", "/oauth/request", {
    body: {
      response_type: "code",
      client_id: muse.clientId,
      redirect_uri: muse.redirectUri,
      scope: "inventory:read",
      code_challenge: sha("x".repeat(43)),
      code_challenge_method: "S256",
    },
  });
  assert.equal(new URL(wrong.body.redirect).searchParams.get("error"), "invalid_scope");

  // The person sees and can disconnect the agent.
  const mine = await call("GET", "/oauth/connections", { headers: { authorization: "Bearer bob-id-token" } });
  assert.equal(mine.body.connections.length, 1);
  assert.deepEqual(mine.body.connections[0].scopes, ["messages:read", "messages:send"]);
});

test("sign-in: an agent not on the approved list is refused at the consent page", async () => {
  const { other, call } = await setup();
  const r = await call("POST", "/oauth/request", {
    body: {
      response_type: "code",
      client_id: other.clientId,
      redirect_uri: other.redirectUri,
      scope: "messages:read",
      code_challenge: sha("x".repeat(43)),
      code_challenge_method: "S256",
    },
  });
  assert.match(r.body.error, /not one StorageLoot has approved/);
});

test("sign-in: Device Sign-In points the person at storageloot.shop/device", async () => {
  const { muse, call, clock, tokenForm } = await setup();
  const start = await call("POST", "/oauth/device", { body: await tokenForm(muse, { scope: "messages:read" }) });
  assert.equal(start.status, 200);
  assert.equal(start.body.verification_uri, `${ORIGIN}/device`);
  const as = { authorization: "Bearer bob-id-token" };
  const seen = await call("POST", "/oauth/device/request", { headers: as, body: { user_code: start.body.user_code } });
  assert.equal(seen.body.found, true);
  assert.equal(seen.body.scopes[0].name, "messages:read");
  await call("POST", "/oauth/device/decision", { headers: as, body: { user_code: start.body.user_code, approve: true } });
  clock.advance(6);
  const tokens = await call("POST", "/oauth/token", {
    body: await tokenForm(muse, { grant_type: DEVICE_GRANT, device_code: start.body.device_code }),
  });
  assert.equal(tokens.status, 200);
  assert.match(tokens.body.access_token, /^sla_/);
});

test("listings API: a verified Session header is enough, and only active listings show", async () => {
  const { muse, other, call, api } = await setup();
  const all = await api(muse, "/api/v1/listings");
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.listings.map((l) => l.id), ["drill", "sofa"]);
  const drill = all.body.listings[0];
  assert.equal(drill.price_cents, 4500);
  assert.equal(drill.seller_name, "Alice");
  assert.deepEqual(drill.photos, [PHOTO]);
  assert.equal(drill.url, `${ORIGIN}/listing/drill`);
  assert.equal(drill.sellerId, undefined);

  assert.deepEqual((await api(muse, "/api/v1/listings", { query: { q: "sofa" } })).body.listings.map((l) => l.id), ["sofa"]);
  assert.deepEqual(
    (await api(muse, "/api/v1/listings", { query: { category: "tools" } })).body.listings.map((l) => l.id),
    ["drill"],
  );
  assert.equal((await api(muse, "/api/v1/listings/bike")).status, 404);
  assert.equal((await api(muse, "/api/v1/listings/drill")).body.title, "Cordless drill");

  // No Session header, or one from an agent that is not approved.
  assert.equal((await call("GET", "/api/v1/listings")).status, 400);
  const outsider = await api(other, "/api/v1/listings");
  assert.equal(outsider.status, 400);
  assert.equal(outsider.body.error, "invalid_session");
});

test("messages: a buyer's agent asks, offers, and requests eBay; the seller's agent reads and replies", async () => {
  const { muse, store, signIn, api } = await setup();
  const bob = (await signIn(muse)).token.body.access_token;
  const post = (path, body, accessToken = bob) => api(muse, path, { method: "POST", body, accessToken });

  const asked = await post("/api/v1/listings/drill/messages", { kind: "inquiry", text: "Still available?" });
  assert.equal(asked.status, 201);
  assert.equal(asked.body.conversation_id, "drill_bob-uid");
  assert.equal((await post("/api/v1/listings/drill/messages", { kind: "offer", offer_amount: 4000 })).status, 201);
  const requested = await post("/api/v1/listings/drill/messages", {
    kind: "listing_request",
    platform: "ebay",
    text: "I pay with eBay",
  });
  assert.equal(requested.status, 201);

  // Stored the way the web app writes it, marked as sent by an agent.
  const convo = store.conversations.get("drill_bob-uid");
  assert.equal(convo.sellerId, "alice-uid");
  assert.equal(convo.buyerDisplayName, "Bob");
  assert.deepEqual(convo.participants, ["alice-uid", "bob-uid"]);
  assert.equal(convo.lastMessageText, "Asked to list it on eBay · I pay with eBay");
  const stored = store.messages.get("drill_bob-uid");
  assert.equal(stored.length, 3);
  assert.ok(stored.every((m) => m.via === "agent" && m.agentClientId === muse.clientId && m.senderRole === "buyer"));
  assert.equal(stored[1].offerStatus, "pending");
  assert.equal(stored[1].currency, "USD");

  // The seller's own sign-in sees it from the other side.
  const alice = (await signIn(muse, { idToken: "alice-id-token" })).token.body.access_token;
  const list = await api(muse, "/api/v1/conversations", { accessToken: alice });
  assert.equal(list.status, 200);
  assert.equal(list.body.conversations.length, 1);
  const c = list.body.conversations[0];
  assert.equal(c.role, "seller");
  assert.equal(c.other_party, "Bob");
  assert.equal(c.unread, true);
  assert.equal(c.last_from, "them");

  const full = await api(muse, "/api/v1/conversations/drill_bob-uid", { accessToken: alice });
  assert.deepEqual(full.body.messages.map((m) => m.kind), ["inquiry", "offer", "listing_request"]);
  assert.deepEqual(full.body.messages[1].offer, { amount_cents: 4000, currency: "USD", status: "pending" });
  assert.equal(full.body.messages[2].platform, "ebay");
  assert.ok(full.body.messages.every((m) => m.from === "them" && m.via_agent));

  const reply = await post("/api/v1/conversations/drill_bob-uid/messages", { text: "Yes, come Saturday" }, alice);
  assert.equal(reply.status, 201);
  assert.equal(store.messages.get("drill_bob-uid")[3].senderRole, "seller");
  const forBob = (await api(muse, "/api/v1/conversations", { accessToken: bob })).body.conversations[0];
  assert.equal(forBob.role, "buyer");
  assert.equal(forBob.unread, true);
  assert.equal(forBob.last_message, "Yes, come Saturday");
});

test("messages: what an agent sends is checked like the web app's", async () => {
  const { muse, signIn, api } = await setup();
  const bob = (await signIn(muse)).token.body.access_token;
  const alice = (await signIn(muse, { idToken: "alice-id-token" })).token.body.access_token;
  const post = (path, body, accessToken = bob) => api(muse, path, { method: "POST", body, accessToken });
  const to = "/api/v1/listings/drill/messages";
  for (const body of [
    { kind: "inquiry", text: "   " },
    { kind: "offer", offer_amount: 0 },
    { kind: "offer", offer_amount: 12.5 },
    { kind: "offer", offer_amount: 100, currency: "dollars" },
    { kind: "listing_request", platform: "nextdoor" },
    { kind: "reply", text: "hi" },
    { kind: "accept" },
    { kind: "inquiry", text: "x".repeat(2001) },
  ]) {
    const r = await post(to, body);
    assert.equal(r.status, 422, JSON.stringify(body));
  }
  assert.equal((await post("/api/v1/listings/bike/messages", { kind: "inquiry", text: "hi" })).status, 404);
  assert.equal((await post("/api/v1/listings/nope/messages", { kind: "inquiry", text: "hi" })).status, 404);
  // A seller cannot write to their own listing.
  const own = await post(to, { kind: "inquiry", text: "hi" }, alice);
  assert.equal(own.status, 409);
  assert.equal(own.body.error, "own_listing");
});

test("messages: scopes are enforced, and only participants see a conversation", async () => {
  const { muse, call, signIn, api } = await setup();
  const bob = (await signIn(muse)).token.body.access_token;
  await api(muse, "/api/v1/listings/drill/messages", {
    method: "POST",
    body: { kind: "inquiry", text: "hi" },
    accessToken: bob,
  });

  const readOnly = (await signIn(muse, { idToken: "carol-id-token", scope: "messages:read" })).token.body.access_token;
  const send = await api(muse, "/api/v1/listings/sofa/messages", {
    method: "POST",
    body: { kind: "inquiry", text: "hi" },
    accessToken: readOnly,
  });
  assert.equal(send.status, 403);
  assert.match(send.headers["WWW-Authenticate"], /insufficient_scope/);

  const sendOnly = (await signIn(muse, { scope: "messages:send" })).token.body.access_token;
  assert.equal((await api(muse, "/api/v1/conversations", { accessToken: sendOnly })).status, 403);

  // Signed out: told which scope to sign in for.
  const signedOut = await api(muse, "/api/v1/conversations");
  assert.equal(signedOut.status, 401);
  assert.match(signedOut.headers["WWW-Authenticate"], /scope="messages:read"/);

  // Carol is not part of the conversation between Bob and Alice.
  assert.equal((await api(muse, "/api/v1/conversations/drill_bob-uid", { accessToken: readOnly })).status, 404);
  assert.deepEqual((await api(muse, "/api/v1/conversations", { accessToken: readOnly })).body.conversations, []);
  const carolSend = (await signIn(muse, { idToken: "carol-id-token", scope: "messages:send" })).token.body.access_token;
  const intrude = await api(muse, "/api/v1/conversations/drill_bob-uid/messages", {
    method: "POST",
    body: { text: "hello" },
    accessToken: carolSend,
  });
  assert.equal(intrude.status, 404);

  // There is no way for an agent to answer an offer.
  assert.equal((await call("PATCH", "/api/v1/conversations/drill_bob-uid/messages/m2")).status, 404);
});

test("messages: an agent may send 30 messages an hour", async () => {
  const { muse, store, clock, signIn, api } = await setup();
  const bob = (await signIn(muse)).token.body.access_token;
  const send = () =>
    api(muse, "/api/v1/listings/drill/messages", {
      method: "POST",
      body: { kind: "inquiry", text: "hi" },
      accessToken: bob,
    });
  assert.equal((await send()).status, 201);
  const [grant] = [...store.grants.values()].filter((g) => g.uid === "bob-uid");
  grant.message_count = 30;
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "rate_limited");
  // An hour after the window opened, the count starts again.
  grant.message_window_start = Date.now() + clock.aheadMs - 3601 * 1000;
  assert.equal((await send()).status, 201);
});

test("listing requests: the placeholder counts requests and keeps the seller's status", () => {
  const { placeholderAfterRequest, previewOf } = require("../src/messages");
  assert.deepEqual(placeholderAfterRequest(null, 5), {
    status: "requested",
    requestCount: 1,
    lastRequestedAt: 5,
    updatedAt: 5,
  });
  assert.deepEqual(placeholderAfterRequest({ status: "listed", requestCount: 2, url: "https://x" }, 9), {
    status: "listed",
    requestCount: 3,
    lastRequestedAt: 9,
    updatedAt: 9,
  });
  assert.equal(previewOf({ kind: "offer", offerAmount: 4000, currency: "USD", text: "" }), "Offer: $40.00");
  assert.equal(previewOf({ kind: "reply", text: "x".repeat(200) }).length, 140);
});
