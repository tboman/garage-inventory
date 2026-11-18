// Public browsing for Personal Agents on storageloot.shop (spec section 6):
//
//   discovery   /.well-known/poppy.json names the site and its
//               browser_session_endpoint. There is no sign-in here: no OAuth
//               issuer, scopes, or API, only public pages.
//   the join    /poppy/browser-session, shared with hunapuka.com (join.js).
//               The agent authorizes its browser's code anonymously: a
//               verified Poppy-Session header and no access token.
//   the pages   /browse lists the marketplace's active listings, with search
//               and a category filter; /browse/listings/{id} shows one. Read
//               only, and only what the public site already shows.
//
// The join is anonymous, but not open to anyone: the Session header must
// verify against storageloot.shop and come from an approved agent, whatever
// ENFORCE_AGENT_IDENTITY says. With no access token behind it, the Session is
// the only thing the join could be tied to.

const { STORAGELOOT, PATHS, PROTOCOL_VERSION, APPROVED_CLIENTS, APPROVED_CLIENTS_ONLY } = require("./config");
const { createBrowserJoin, sendHtml, document, esc, csp } = require("./join");
const { JwtError, peekIssuer } = require("./jwt");
const { ClientError } = require("./clientMetadata");
const { hashToken, newToken, send, oauthError, versionServed, defaultLogIdentity } = require("./handler");

const { ORIGIN, NAME, DOMAIN, IMAGE_HOSTS } = STORAGELOOT;

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

function poppyJson() {
  return {
    protocol_version: PROTOCOL_VERSION,
    organization: { name: NAME, domain: DOMAIN },
    // The site is the Company agents address their Session JWTs to, so it is
    // named as issuer, but it grants nothing: no scopes, and its metadata
    // below lists no grant types. There is no way to sign in here.
    auth: { issuer: ORIGIN, scopes: {}, scope_hints: {} },
    // Anonymous browsing of public pages only: the join takes a Session header
    // and no access token, and the pages under /browse show active listings.
    web: { browser_session_endpoint: `${ORIGIN}${PATHS.browserSession}` },
  };
}

// The OAuth metadata the issuer above implies (RFC 8414, RFC 9728), saying
// there is nothing to sign in to: no grant types, response types, or scopes.
// Served so an agent that follows `auth.issuer` gets JSON, not the web app.
function authorizationServerMetadata() {
  return {
    issuer: ORIGIN,
    response_types_supported: [],
    grant_types_supported: [],
    scopes_supported: [],
    protected_resources: [ORIGIN],
  };
}

function protectedResourceMetadata() {
  return { resource: ORIGIN, authorization_servers: [ORIGIN], scopes_supported: [] };
}

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

function createStorageLootHandler({
  store,
  jwt,
  now = Date.now,
  approvedClients = APPROVED_CLIENTS,
  approvedOnly = APPROVED_CLIENTS_ONLY,
  logIdentity = defaultLogIdentity,
}) {
  const shutOut = (clientId) => approvedOnly && !approvedClients.includes(clientId);

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
    let listings = (await store.listActiveListings()).filter(isPublic);
    if (category) listings = listings.filter((l) => l.category === category);
    if (q) {
      const needle = q.toLowerCase();
      listings = listings.filter(
        (l) =>
          String(l.title || "").toLowerCase().includes(needle) ||
          String(l.description || "").toLowerCase().includes(needle),
      );
    }
    const heading = q || category
      ? `${listings.length} listing${listings.length === 1 ? "" : "s"}` +
        (q ? ` for “${esc(q)}”` : "") +
        (category ? ` in ${esc(CATEGORIES[category])}` : "")
      : `${listings.length} active listing${listings.length === 1 ? "" : "s"}`;
    return page(res, 200, q || category ? "Search" : "Listings", `<h1>${heading}</h1>${filters(q, category)}${list(listings)}${footer}`);
  }

  // ---- Routing ----------------------------------------------------------

  const cached = { "Cache-Control": "public, max-age=300" };
  const routes = {
    "GET /.well-known/poppy.json": (req, res) => send(res, 200, poppyJson(), cached),
    "GET /.well-known/oauth-authorization-server": (req, res) => send(res, 200, authorizationServerMetadata(), cached),
    "GET /.well-known/oauth-protected-resource": (req, res) => send(res, 200, protectedResourceMetadata(), cached),
    [`GET ${PATHS.browserSession}`]: join.joinPage,
    [`POST ${PATHS.browserSession}`]: join.submitCode,
    [`POST ${PATHS.browserSession}/authorize`]: join.authorizeCode,
    [`GET ${PATHS.browse}`]: (req, res) => browse(req, res),
  };

  return async function handle(req, res) {
    try {
      const route = routes[`${req.method} ${req.path}`];
      if (route) return await route(req, res);
      const viewed = new RegExp(`^${PATHS.browse}/listings/([^/]+)$`).exec(req.path);
      if (viewed && req.method === "GET") return await browse(req, res, viewed[1]);
      oauthError(res, 404, "not_found", "No such endpoint.");
    } catch (err) {
      // Message only: requests carry Session JWTs, which are secrets.
      console.error("poppy storageloot handler failed:", err && err.message);
      oauthError(res, 500, "server_error", "Something went wrong.");
    }
  };
}

module.exports = { createStorageLootHandler, poppyJson };
