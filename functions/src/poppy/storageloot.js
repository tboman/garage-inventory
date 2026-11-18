// The Poppy endpoints for storageloot.shop (spec sections 3-7), as one handler:
//
//   discovery   /.well-known/poppy.json, the OAuth metadata, and
//               /api/openapi.json (storagelootDocuments.js). storageloot.shop
//               is its own issuer, with its own scopes and tokens.
//   sign-in     shared with hunapuka.com (auth.js): the consent page the web
//               app serves at /oauth/authorize, Device Sign-In at /device,
//               /oauth/token, /oauth/revoke, and /oauth/connections.
//   the join    /poppy/browser-session, shared with hunapuka.com (join.js).
//               Here the agent authorizes its browser's code anonymously: a
//               verified Poppy-Session header and no access token.
//   the pages   /browse lists the marketplace's active listings, with search
//               and a category filter; /browse/listings/{id} shows one. Read
//               only, and only what the public site already shows.
//   the API     /api/v1: listings (Session header only), and the person's
//               conversations with buyers and sellers (messages:read,
//               messages:send). Agents cannot accept or decline offers.
//   guests      people write to sellers without signing in. A browser guest
//               (`sla_…`) is made by POST /api/guest/session when the person
//               first sends a message; its token rides in the __session
//               cookie and is traded for a Firebase custom token, so the web
//               app keeps writing through Firestore under its rules. An agent
//               guest (`slg_…`) is the person behind a verified Session: the
//               message and conversation endpoints, called with no
//               Authorization header, act for the account derived from the
//               Session's client_id and user.
//
// The anonymous join and agent guests are not open to anyone: the Session
// header must verify against storageloot.shop and come from an approved
// agent, whatever ENFORCE_AGENT_IDENTITY says. With no access token behind
// it, the Session is the only thing they could be tied to.

const { createHash, randomBytes } = require("node:crypto");
const {
  STORAGELOOT,
  PATHS,
  ENFORCE_AGENT_IDENTITY,
  APPROVED_CLIENTS,
  APPROVED_CLIENTS_ONLY,
  GUEST_SESSION_TTL_MS,
} = require("./config");
const { createBrowserJoin, sendHtml, document, esc, csp, readCookie, writeCookie } = require("./join");
const { JwtError, peekIssuer } = require("./jwt");
const { ClientError } = require("./clientMetadata");
const {
  createAgentAuth,
  hashToken,
  newToken,
  send,
  oauthError,
  versionServed,
  toIso,
  defaultLogIdentity,
} = require("./auth");
const documents = require("./storagelootDocuments");
const { MessageError, validateMessage, previewOf, conversationId } = require("../messages");

const { ORIGIN, NAME, DOMAIN, IMAGE_HOSTS, SCOPES, AGENT_MESSAGES_PER_HOUR, GUEST } = STORAGELOOT;
const READ = "messages:read";
const SEND = "messages:send";
const HOUR_MS = 60 * 60 * 1000;
const GUEST_PATH = "/api/guest";

// Guest account ids. Firebase uids for Google accounts are 28 letters and
// digits, so the underscore keeps these from ever naming a real person.
// A browser guest's is random. An agent guest's is derived from the agent and
// its own id for the person, so the same pair always finds the same account,
// and another agent naming the same user gets a different one.
const newBrowserGuestId = () => `sla_${randomBytes(16).toString("base64url")}`;
const agentGuestId = (clientId, user) =>
  `slg_${createHash("sha256").update(`${clientId}\n${user}`).digest("base64url").slice(0, 32)}`;
// The Firebase custom token's extra claim, so rules and logs can tell guests apart.
const GUEST_CLAIMS = { sl_guest: true };

const defaultGuestOrigins = () =>
  GUEST.ORIGINS.concat(process.env.FUNCTIONS_EMULATOR === "true" ? GUEST.EMULATOR_ORIGINS : []);

// The caller's IP address, for counting new guests. Best effort: Hosting puts
// the client's address in Fastly-Client-IP, and X-Forwarded-For first.
function clientIp(req) {
  const fastly = req.get("fastly-client-ip");
  if (fastly) return fastly.trim();
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.ip || "unknown";
}

const CONDITIONS = { new: "New", like_new: "Like New", good: "Good", fair: "Fair", poor: "Poor" };
const CATEGORIES = {
  tools: "Tools",
  electronics: "Electronics",
  furniture: "Furniture",
  sports: "Sports",
  automotive: "Automotive",
  household: "Household",
  clothing: "Clothing",
  other: "Other",
};
const LISTING_ID = /^[A-Za-z0-9_-]{1,64}$/;
// `{listingId}_{buyerUid}`. Only the shape is checked here; whether the
// person is part of the conversation is what decides access.
const CONVERSATION_ID = /^[A-Za-z0-9_-]{3,200}$/;

// storageloot.shop as auth.js sees it.
const SITE = {
  origin: ORIGIN,
  issuer: ORIGIN,
  name: NAME,
  scopes: SCOPES,
  apiPath: PATHS.api,
  tokenPrefix: "sl",
  protectedResourceMetadata: (resource) => documents.protectedResourceMetadata(resource),
  describeScopes: () => ({}),
};

// Prices are stored in cents.
function formatPrice(cents, currency) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ""}`.trim();
  }
}

// Only photo URLs from Firebase Storage are shown, the same hosts the page's
// Content-Security-Policy allows, so a stray URL can never load from elsewhere.
const photosOf = (listing) =>
  (Array.isArray(listing.photos) ? listing.photos : []).filter(
    (u) => typeof u === "string" && IMAGE_HOSTS.some((host) => u.startsWith(`${host}/`)),
  );

const isPublic = (listing) => listing && listing.status === "active";

// The listings a search asks for: `q` in titles and descriptions, and a
// `category`. Used by the /browse pages and the API alike.
function filterListings(listings, query) {
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 200).toLowerCase() : "";
  const category = typeof query.category === "string" && CATEGORIES[query.category] ? query.category : "";
  let out = listings;
  if (category) out = out.filter((l) => l.category === category);
  if (q) {
    out = out.filter(
      (l) => String(l.title || "").toLowerCase().includes(q) || String(l.description || "").toLowerCase().includes(q),
    );
  }
  return out;
}

function createStorageLootHandler({
  store,
  clients,
  jwt,
  verifyIdToken,
  now = Date.now,
  enforceAgentIdentity = ENFORCE_AGENT_IDENTITY,
  approvedClients = APPROVED_CLIENTS,
  approvedOnly = APPROVED_CLIENTS_ONLY,
  logIdentity = defaultLogIdentity,
  // (uid, claims) => a Firebase custom token, for browser guests.
  mintCustomToken,
  guestOrigins = defaultGuestOrigins(),
}) {
  const auth = createAgentAuth({
    site: SITE,
    store,
    clients,
    jwt,
    verifyIdToken,
    now,
    enforceAgentIdentity,
    approvedClients,
    approvedOnly,
    logIdentity,
  });
  const { shutOut } = auth;

  // The agent vouches for its browser's code with its Session header alone.
  async function authorizeAgent(req, res) {
    const request = `${req.method} ${req.path}`;
    const sessionJwt = req.get("poppy-session");
    const refuse = (clientId, reason) => {
      logIdentity({ stage: "web", clientId, reason, request });
      oauthError(res, 400, "invalid_session", reason);
      return null;
    };
    if (req.get("authorization")) {
      oauthError(
        res,
        400,
        "invalid_request",
        `${DOMAIN} issues no access tokens. Authorize the code with the Poppy-Session header alone.`,
      );
      return null;
    }
    if (!sessionJwt) return refuse(null, "The Poppy-Session header is required.");
    let session;
    try {
      session = await jwt.verifySession(sessionJwt, { method: req.method, path: req.path, accessToken: null });
    } catch (err) {
      if (!(err instanceof JwtError || err instanceof ClientError)) throw err;
      return refuse(peekIssuer(sessionJwt), err.message);
    }
    if (shutOut(session.clientId)) {
      return refuse(session.clientId, "This client_id is not on the list of approved agents.");
    }
    if (!versionServed(req.get("poppy-version"))) {
      send(res, 400, { error: "version_unsupported" });
      return null;
    }
    logIdentity({ stage: "web", clientId: session.clientId, sid: session.sid, user: session.userId, request });
    return { uid: null, client_id: session.clientId, grant_id: null, scope: "", sid: session.sid };
  }

  const join = createBrowserJoin({
    store,
    now,
    send,
    hashToken,
    newToken,
    siteName: NAME,
    tokenPrefix: "slw",
    authorizeAgent,
  });
  // ---- The pages ------------------------------------------------------------

  const imagePolicy = { "Content-Security-Policy": csp(IMAGE_HOSTS.join(" ")) };
  const page = (res, status, title, body) =>
    sendHtml(res, status, document(`${title} - ${NAME}`, body), imagePolicy);

  const listingUrl = (l) => `${PATHS.browse}/listings/${encodeURIComponent(l.id)}`;
  const facts = (l) =>
    [formatPrice(l.price, l.currency), CONDITIONS[l.condition], CATEGORIES[l.category]].filter(Boolean).map(esc).join(" · ");
  const footer =
    `<p class="muted note">Read-only view of ${esc(NAME)}'s public listings for a personal AI agent. ` +
    `Nothing can be bought, changed, or posted from these pages. ` +
    `People browse the same listings at <a href="/">${esc(DOMAIN)}</a>.</p>`;

  function filters(q, category) {
    const options = [`<option value="">All categories</option>`]
      .concat(
        Object.entries(CATEGORIES).map(
          ([value, label]) => `<option value="${value}"${value === category ? " selected" : ""}>${esc(label)}</option>`,
        ),
      )
      .join("");
    return (
      `<form method="get" action="${PATHS.browse}" role="search">` +
      `<input type="search" name="q" value="${esc(q)}" placeholder="Search titles and descriptions" aria-label="Search listings"> ` +
      `<select name="category" aria-label="Category">${options}</select> <button>Search</button></form>`
    );
  }

  function list(listings) {
    if (!listings.length) return `<p class="muted">No listings match.</p>`;
    return (
      `<ul>` +
      listings
        .map((l) => {
          const photo = photosOf(l)[0];
          return (
            `<li><a href="${listingUrl(l)}">${esc(l.title || "(untitled)")}</a> <span class="muted">${facts(l)}</span>` +
            (photo ? `<br><img src="${esc(photo)}" alt="" width="160" loading="lazy">` : "") +
            `</li>`
          );
        })
        .join("") +
      `</ul>`
    );
  }

  async function browse(req, res, listingId) {
    if (!(await join.webSession(req))) {
      return page(
        res,
        401,
        "For agents",
        `<h1>This is ${esc(NAME)}'s read-only view for personal AI agents</h1>` +
          `<p>Your browser is not connected to an agent Session. An agent's browser joins at ` +
          `<a href="${PATHS.browserSession}">${PATHS.browserSession}</a> first.</p>` +
          `<p>If you are a person, <a href="/">open ${esc(NAME)}</a> instead.</p>`,
      );
    }

    if (listingId !== undefined) {
      const listing = LISTING_ID.test(listingId) ? await store.getListing(listingId) : null;
      if (!isPublic(listing)) {
        return page(res, 404, "Not found", `<h1>No such listing</h1><p><a href="${PATHS.browse}">Back to the listings</a></p>`);
      }
      const photos = photosOf(listing);
      const seller = typeof listing.sellerDisplayName === "string" ? listing.sellerDisplayName : "";
      return page(
        res,
        200,
        listing.title || "Listing",
        `<p class="muted"><a href="${PATHS.browse}">Listings</a></p>` +
          `<h1>${esc(listing.title || "(untitled)")}</h1>` +
          `<p><strong>${esc(formatPrice(listing.price, listing.currency))}</strong></p>` +
          `<p class="muted">Condition: ${esc(CONDITIONS[listing.condition] || "Not given")} · ` +
          `Category: ${esc(CATEGORIES[listing.category] || "Other")}` +
          (seller ? ` · Seller: ${esc(seller)}` : "") +
          `</p>` +
          (listing.description ? `<p>${esc(listing.description).replace(/\n/g, "<br>")}</p>` : "") +
          photos.map((u, i) => `<p><img src="${esc(u)}" alt="Photo ${i + 1} of ${esc(listing.title || "the listing")}"></p>`).join("") +
          `<p class="muted">Public page for people: <a href="/listing/${encodeURIComponent(listing.id)}">${esc(DOMAIN)}/listing/${esc(listing.id)}</a></p>` +
          footer,
      );
    }

    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const category = typeof req.query.category === "string" && CATEGORIES[req.query.category] ? req.query.category : "";
    const listings = filterListings((await store.listActiveListings()).filter(isPublic), req.query);
    const heading = q || category
      ? `${listings.length} listing${listings.length === 1 ? "" : "s"}` +
        (q ? ` for “${esc(q)}”` : "") +
        (category ? ` in ${esc(CATEGORIES[category])}` : "")
      : `${listings.length} active listing${listings.length === 1 ? "" : "s"}`;
    return page(res, 200, q || category ? "Search" : "Listings", `<h1>${heading}</h1>${filters(q, category)}${list(listings)}${footer}`);
  }
  // ---- Browser guests -----------------------------------------------------

  // Only the site's own pages may trade the cookie for a sign-in. The cookie
  // is SameSite=Strict as well; this also turns away a page elsewhere that
  // gets a browser to post here.
  function fromOurPages(req, res) {
    if (guestOrigins.includes(req.get("origin"))) return true;
    oauthError(res, 403, "forbidden", `Only ${DOMAIN}'s own pages may do this.`);
    return false;
  }

  // POST /api/guest/session {create}. With a live guest in the cookie, signs
  // it in again (and keeps it another year). Otherwise, with create: true,
  // starts a new guest; with create: false, answers 204 and makes nothing.
  // A sign-in is { account_id, token }, the token a Firebase custom token.
  async function handleGuestSession(req, res) {
    if (!fromOurPages(req, res)) return;
    const cookie = readCookie(req);
    const at = now();
    let token = cookie.a;
    let session = token ? await store.getGuestSession(hashToken(token)) : null;
    if (session && !(session.expires_at >= at)) session = null;

    if (session) {
      await store.updateGuestSession(hashToken(token), { expires_at: at + GUEST_SESSION_TTL_MS });
      await store.updateAccount(session.account_id, { last_seen_at: at });
    } else {
      const forget = cookie.a ? { "Set-Cookie": writeCookie({ ...cookie, a: undefined }) } : {};
      if (body(req).create !== true) return send(res, 204, undefined, forget);
      const ipHash = hashToken(`guest-ip\n${clientIp(req)}`);
      if (!(await store.takeNewGuestAllowance(ipHash, at, GUEST.NEW_PER_IP_PER_HOUR, HOUR_MS))) {
        return oauthError(res, 429, "rate_limited", "Too many new guests from this network. Try again later.", forget);
      }
      const accountId = newBrowserGuestId();
      await store.ensureAccount(accountId, { kind: "guest", created_at: at, last_seen_at: at });
      token = newToken("sls");
      session = { account_id: accountId, created_at: at, expires_at: at + GUEST_SESSION_TTL_MS };
      await store.putGuestSession(hashToken(token), session);
    }
    const firebaseToken = await mintCustomToken(session.account_id, GUEST_CLAIMS);
    send(res, 200, { account_id: session.account_id, token: firebaseToken }, {
      "Set-Cookie": writeCookie({ ...cookie, a: token }),
    });
  }

  // POST /api/guest/sign-out. The guest's cookie session ends for good: there
  // is no other way back into a browser guest's account.
  async function handleGuestSignOut(req, res) {
    if (!fromOurPages(req, res)) return;
    const cookie = readCookie(req);
    if (cookie.a) await store.deleteGuestSession(hashToken(cookie.a));
    send(res, 204, undefined, { "Set-Cookie": writeCookie({ ...cookie, a: undefined }) });
  }

  // ---- Agent guests ------------------------------------------------------

  // Who a request with no Authorization header acts for: the guest anchored
  // to the agent's Session. The Session must verify and come from an approved
  // agent, whatever ENFORCE_AGENT_IDENTITY says, and name the person (`sub`).
  // Returns { uid, client_id, guest: true }, or null after answering.
  async function agentGuest(req, res) {
    const request = `${req.method} ${req.path}`;
    const sessionJwt = req.get("poppy-session");
    const refuse = (clientId, reason) => {
      logIdentity({ stage: "api", clientId, reason, request });
      oauthError(res, 400, "invalid_session", reason);
      return null;
    };
    if (!sessionJwt) return refuse(null, "The Poppy-Session header is required.");
    let session;
    try {
      session = await jwt.verifySession(sessionJwt, { method: req.method, path: req.path, accessToken: null });
    } catch (err) {
      if (!(err instanceof JwtError || err instanceof ClientError)) throw err;
      return refuse(peekIssuer(sessionJwt), err.message);
    }
    if (!approvedClients.includes(session.clientId)) {
      return refuse(session.clientId, "This client_id is not on the list of approved agents.");
    }
    if (typeof session.userId !== "string" || !session.userId) {
      return refuse(session.clientId, "The Session JWT names no user (sub) to keep a guest account for.");
    }
    if (!versionServed(req.get("poppy-version"))) {
      send(res, 400, { error: "version_unsupported" });
      return null;
    }
    const uid = agentGuestId(session.clientId, session.userId);
    logIdentity({ stage: "api", clientId: session.clientId, sid: session.sid, user: session.userId, guest: uid, request });
    return { uid, client_id: session.clientId, grant_id: null, guest: true };
  }

  // How a guest's agent is named to the seller.
  async function guestName(clientId) {
    try {
      const client = await clients.getClient(clientId);
      const name = client && (client.client_name || client.host);
      return `Guest via ${String(name || "agent")}`.slice(0, 100);
    } catch {
      return "Guest via agent";
    }
  }

  // ---- The API ------------------------------------------------------------

  const listingUrlFor = (id) => `${ORIGIN}/listing/${encodeURIComponent(id)}`;

  // The public shape of a listing: what the public page shows, field by field.
  function shapeListing(l) {
    return {
      id: l.id,
      title: String(l.title || ""),
      description: typeof l.description === "string" ? l.description : "",
      price_cents: typeof l.price === "number" ? l.price : null,
      currency: l.currency || "USD",
      condition: CONDITIONS[l.condition] ? l.condition : null,
      category: CATEGORIES[l.category] ? l.category : "other",
      photos: photosOf(l),
      seller_name: typeof l.sellerDisplayName === "string" ? l.sellerDisplayName : "",
      url: listingUrlFor(l.id),
      created_at: toIso(l.createdAt),
    };
  }

  const roleIn = (c, uid) => (c.sellerId === uid ? "seller" : "buyer");
  const readAtOf = (c, uid) => (c.sellerId === uid ? c.sellerReadAt : c.buyerReadAt);
  const millis = (v) => (typeof v === "number" ? v : v && typeof v.toMillis === "function" ? v.toMillis() : 0);

  function shapeConversation(c, uid) {
    return {
      id: c.id,
      listing: { id: c.listingId, title: c.listingTitle, url: listingUrlFor(c.listingId) },
      role: roleIn(c, uid),
      other_party: c.sellerId === uid ? c.buyerDisplayName : c.sellerDisplayName,
      last_message: c.lastMessageText || "",
      last_message_at: toIso(c.lastMessageAt),
      last_from: c.lastSenderId === uid ? "you" : "them",
      unread: c.lastSenderId !== uid && millis(c.lastMessageAt) > millis(readAtOf(c, uid)),
    };
  }

  function shapeMessage(m, uid) {
    return {
      id: m.id,
      from: m.senderId === uid ? "you" : "them",
      role: m.senderRole,
      kind: m.kind,
      text: m.text || "",
      ...(m.kind === "offer"
        ? { offer: { amount_cents: m.offerAmount, currency: m.currency, status: m.offerStatus } }
        : {}),
      ...(m.kind === "listing_request" ? { platform: m.platform } : {}),
      via_agent: m.via === "agent",
      created_at: toIso(m.createdAt),
    };
  }

  // Listings are public: a verified Session header from an approved agent is
  // enough, with no access token (an agent may still send one).
  async function sessionOnly(req, res) {
    const checked = await auth.checkAgent(req, res, READ, { tokenOptional: !req.get("authorization") });
    if (!checked) return false;
    if (!checked.session) {
      oauthError(res, 400, "invalid_session", "A verified Poppy-Session header is required.");
      return false;
    }
    return true;
  }

  async function handleListings(req, res, listingId) {
    if (!(await sessionOnly(req, res))) return;
    if (listingId !== undefined) {
      const listing = LISTING_ID.test(listingId) ? await store.getListing(listingId) : null;
      return isPublic(listing)
        ? send(res, 200, shapeListing(listing))
        : oauthError(res, 404, "not_found", "No active listing with that id.");
    }
    const listings = filterListings((await store.listActiveListings()).filter(isPublic), req.query);
    send(res, 200, { listings: listings.map(shapeListing), total: listings.length });
  }

  // Who the request acts for: with an access token, the person who signed in
  // (the token's record: uid, client_id, grant_id), if it carries `scope`;
  // with no Authorization header, the agent guest. Null after answering.
  async function actor(req, res, scope) {
    if (!req.get("authorization")) return agentGuest(req, res);
    const checked = await auth.checkAgent(req, res, scope);
    return checked && checked.record;
  }

  // The conversation, if the signed-in person is part of it; otherwise answers 404.
  async function theirConversation(res, record, id) {
    const c = CONVERSATION_ID.test(id) ? await store.getConversation(id) : null;
    if (!c || !Array.isArray(c.participants) || !c.participants.includes(record.uid)) {
      oauthError(res, 404, "not_found", "No such conversation.");
      return null;
    }
    return c;
  }

  async function handleConversations(req, res, id) {
    const record = await actor(req, res, READ);
    if (!record) return;
    if (id === undefined) {
      const list = await store.listConversations(record.uid);
      return send(res, 200, { conversations: list.map((c) => shapeConversation(c, record.uid)) });
    }
    const c = await theirConversation(res, record, id);
    if (!c) return;
    const messages = await store.listMessages(c.id);
    send(res, 200, { ...shapeConversation(c, record.uid), messages: messages.map((m) => shapeMessage(m, record.uid)) });
  }

  const invalid = (res, description) => oauthError(res, 422, "invalid_request", description);
  const body = (req) => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});

  // Counts the message against the agent's hourly allowance (on its sign-in,
  // or for a guest on the guest's account); answers 429 when spent.
  async function allowance(res, record) {
    const taken = record.guest
      ? await store.takeGuestAllowance(record.uid, now(), AGENT_MESSAGES_PER_HOUR, HOUR_MS)
      : await store.takeMessageAllowance(record.grant_id, now(), AGENT_MESSAGES_PER_HOUR, HOUR_MS);
    if (taken) return true;
    oauthError(res, 429, "rate_limited", `An agent may send ${AGENT_MESSAGES_PER_HOUR} messages an hour. Try again later.`);
    return false;
  }

  function messageFrom(record, role, fields) {
    return {
      senderId: record.uid,
      senderRole: role,
      ...fields,
      createdAt: now(),
      via: "agent",
      agentClientId: record.client_id,
    };
  }

  // The person, as a buyer, writes to a listing's seller. An agent guest's
  // account is made here, by its first message.
  async function handleMessageSeller(req, res, listingId) {
    const record = await actor(req, res, SEND);
    if (!record) return;
    const listing = LISTING_ID.test(listingId) ? await store.getListing(listingId) : null;
    if (!isPublic(listing)) return oauthError(res, 404, "not_found", "No active listing with that id.");
    if (listing.sellerId === record.uid) {
      return oauthError(res, 409, "own_listing", "This is the person's own listing.");
    }
    const b = body(req);
    let fields;
    try {
      fields = validateMessage({
        role: "buyer",
        kind: b.kind,
        text: b.text,
        offerAmount: b.offer_amount,
        currency: b.currency === undefined ? listing.currency || "USD" : b.currency,
        platform: b.platform,
      });
    } catch (err) {
      if (err instanceof MessageError) return invalid(res, err.message);
      throw err;
    }
    if (fields.kind === "reply") return invalid(res, "kind must be inquiry, offer, or listing_request.");
    if (record.guest) {
      await store.ensureAccount(record.uid, { kind: "agent", client_id: record.client_id, created_at: now(), last_seen_at: now() });
    }
    if (!(await allowance(res, record))) return;

    const id = conversationId(listing.id, record.uid);
    const message = messageFrom(record, "buyer", fields);
    const preview = previewOf(message);
    const at = now();
    const buyerName = record.guest
      ? await guestName(record.client_id)
      : ((await store.getUserName(record.uid)) || "Buyer").slice(0, 100);
    const messageId = await store.postMessage(id, {
      create: {
        listingId: listing.id,
        listingTitle: String(listing.title || "").slice(0, 120),
        listingPhoto: photosOf(listing)[0] || null,
        sellerId: listing.sellerId,
        sellerDisplayName: String(listing.sellerDisplayName || "Seller").slice(0, 100),
        buyerId: record.uid,
        buyerDisplayName: buyerName,
        ...(record.guest ? { buyerGuest: true } : {}),
        participants: [listing.sellerId, record.uid],
        createdAt: at,
        lastMessageAt: at,
        lastMessageText: preview,
        lastSenderId: record.uid,
        sellerReadAt: null,
        buyerReadAt: at,
      },
      patch: { lastMessageAt: at, lastMessageText: preview, lastSenderId: record.uid, buyerReadAt: at },
      message,
    });
    send(res, 201, { conversation_id: id, message_id: messageId });
  }

  // A reply from either side of one of the person's conversations.
  async function handleReply(req, res, id) {
    const record = await actor(req, res, SEND);
    if (!record) return;
    const c = await theirConversation(res, record, id);
    if (!c) return;
    const role = roleIn(c, record.uid);
    let fields;
    try {
      fields = validateMessage({ role, kind: "reply", text: body(req).text });
    } catch (err) {
      if (err instanceof MessageError) return invalid(res, err.message);
      throw err;
    }
    if (!(await allowance(res, record))) return;
    const message = messageFrom(record, role, fields);
    const at = now();
    const messageId = await store.postMessage(c.id, {
      patch: {
        lastMessageAt: at,
        lastMessageText: previewOf(message),
        lastSenderId: record.uid,
        [role === "seller" ? "sellerReadAt" : "buyerReadAt"]: at,
      },
      message,
    });
    if (!messageId) return oauthError(res, 404, "not_found", "No such conversation.");
    send(res, 201, { conversation_id: c.id, message_id: messageId });
  }

  // ---- Routing ----------------------------------------------------------

  const cached = { "Cache-Control": "public, max-age=300" };
  const routes = {
    "GET /.well-known/poppy.json": (req, res) => send(res, 200, documents.poppyJson(), cached),
    "GET /.well-known/oauth-authorization-server": (req, res) =>
      send(res, 200, documents.authorizationServerMetadata(), cached),
    "GET /.well-known/oauth-protected-resource": (req, res) =>
      send(res, 200, documents.protectedResourceMetadata(), cached),
    [`GET ${PATHS.openapi}`]: (req, res) => send(res, 200, documents.openApi(), cached),
    ...auth.routes,
    [`GET ${PATHS.browserSession}`]: join.joinPage,
    [`POST ${PATHS.browserSession}`]: join.submitCode,
    [`POST ${PATHS.browserSession}/authorize`]: join.authorizeCode,
    [`GET ${PATHS.browse}`]: (req, res) => browse(req, res),
    [`GET ${PATHS.api}/listings`]: (req, res) => handleListings(req, res),
    [`GET ${PATHS.api}/conversations`]: (req, res) => handleConversations(req, res),
    [`POST ${GUEST_PATH}/session`]: handleGuestSession,
    [`POST ${GUEST_PATH}/sign-out`]: handleGuestSignOut,
  };

  const match = (pattern, path) => new RegExp(pattern).exec(path);

  return async function handle(req, res) {
    try {
      const route = routes[`${req.method} ${req.path}`];
      if (route) return await route(req, res);
      const api = PATHS.api;
      let m;
      if ((m = match(`^${api}/listings/([^/]+)/messages$`, req.path)) && req.method === "POST") {
        return await handleMessageSeller(req, res, m[1]);
      }
      if ((m = match(`^${api}/listings/([^/]+)$`, req.path)) && req.method === "GET") {
        return await handleListings(req, res, m[1]);
      }
      if ((m = match(`^${api}/conversations/([^/]+)/messages$`, req.path)) && req.method === "POST") {
        return await handleReply(req, res, m[1]);
      }
      if ((m = match(`^${api}/conversations/([^/]+)$`, req.path)) && req.method === "GET") {
        return await handleConversations(req, res, m[1]);
      }
      if ((m = /^\/\.well-known\/oauth-protected-resource(\/.*)$/.exec(req.path)) && req.method === "GET") {
        const doc = auth.resourceMetadataFor(m[1]);
        return doc ? send(res, 200, doc, cached) : oauthError(res, 404, "not_found", "No such resource.");
      }
      if ((m = match(`^${PATHS.browse}/listings/([^/]+)$`, req.path)) && req.method === "GET") {
        return await browse(req, res, m[1]);
      }
      oauthError(res, 404, "not_found", "No such endpoint.");
    } catch (err) {
      // Message only: requests carry tokens and Session JWTs, which are secrets.
      console.error("poppy storageloot handler failed:", err && err.message);
      oauthError(res, 500, "server_error", "Something went wrong.");
    }
  };
}

module.exports = { createStorageLootHandler, poppyJson: documents.poppyJson };
