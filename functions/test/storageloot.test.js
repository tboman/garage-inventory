// End-to-end tests of public agent browsing on storageloot.shop: the
// anonymous browser join and the read-only listing pages, with a fake agent,
// an in-memory store, and no network. Run with `npm test` from functions/.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ClientError, createClientDirectory } = require("../src/poppy/clientMetadata");
const { createJwtVerifier } = require("../src/poppy/jwt");
const { createStorageLootHandler } = require("../src/poppy/storageloot");
const { makeAgent, makeCaller, makeBrowser, JOIN } = require("../test-support/fakeAgent");

const ORIGIN = "https://storageloot.shop";
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
  return {
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

async function setup({ approvedOnly = true } = {}) {
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
    jwt: createJwtVerifier({ clients, issuer: ORIGIN, origin: ORIGIN }),
    now: () => Date.now() + clock.aheadMs,
    approvedClients: [muse.clientId],
    approvedOnly,
    logIdentity: (entry) => identityLog.push(entry),
  });
  const call = makeCaller(handler);

  // The agent authorizes its browser's code with its Session header alone.
  async function authorize(agent, code, { version = "1.0", session = {}, headers: extra = {} } = {}) {
    const path = `${JOIN}/authorize`;
    const headers = { "Poppy-Session": await agent.sessionHeader({ method: "POST", path, ...session }), ...extra };
    if (version) headers["Poppy-Version"] = version;
    return call("POST", path, { headers, body: { code } });
  }

  return { muse, other, store, clock, call, authorize, identityLog };
}

test("discovery: poppy.json offers public browsing and nothing else", async () => {
  const { call } = await setup();
  const r = await call("GET", "/.well-known/poppy.json");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    protocol_version: "1.0",
    organization: { name: "StorageLoot", domain: "storageloot.shop" },
    auth: { issuer: ORIGIN, scopes: {}, scope_hints: {} },
    web: { browser_session_endpoint: `${ORIGIN}${JOIN}` },
  });
  // The issuer's metadata is JSON and offers no way to sign in.
  const server = await call("GET", "/.well-known/oauth-authorization-server");
  assert.equal(server.status, 200);
  assert.equal(server.body.issuer, r.body.auth.issuer);
  assert.deepEqual(server.body.grant_types_supported, []);
  assert.deepEqual(server.body.scopes_supported, []);
  assert.equal(server.body.token_endpoint, undefined);
  const resource = await call("GET", "/.well-known/oauth-protected-resource");
  assert.deepEqual(resource.body, { resource: ORIGIN, authorization_servers: [ORIGIN], scopes_supported: [] });
  // Anything else under the metadata path is a JSON 404, never the web app.
  const suffixed = await call("GET", "/.well-known/oauth-protected-resource/browse");
  assert.equal(suffixed.status, 404);
  assert.equal(suffixed.body.error, "not_found");
  // No sign-in endpoints on this site.
  assert.equal((await call("POST", "/oauth/token")).status, 404);
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
