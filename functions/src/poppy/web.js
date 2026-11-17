// Web browsing for Personal Agents (spec section 6): the browser join, and the
// read-only inventory pages a joined browser is shown.
//
// The join has three steps. The agent's browser loads the join page, which
// holds a one-time code and sets a cookie tying that code to this browser.
// The agent authorizes the code in a request of its own, with its Session
// header and access token. The browser then submits the code and is given
// the web session's cookie. The access token never passes through the browser.
//
// The pages are rendered here, not by the React app. That app signs people in
// with Google and reads Firestore directly, with everything the account can
// do. These pages are built from the same field-by-field shape as the API, so
// an agent's browser sees item names, descriptions, and structure only: no
// photos, and no way to change anything.

const { randomBytes } = require("node:crypto");
const {
  PATHS,
  BROWSER_SCOPE,
  BROWSER_CODE_TTL_MS,
  WEB_SESSION_TTL_MS,
  WEB_COOKIE,
} = require("./config");

const READ = "inventory:read";

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The one cookie holds up to two values: `j`, the secret that ties a join code
// to this browser, and `w`, the web session's token. Both are base64url, with
// or without a prefix, so "." and "~" are safe separators.
function readCookie(req) {
  const out = {};
  for (const pair of String(req.get("cookie") || "").split(";")) {
    const at = pair.indexOf("=");
    if (at < 0 || pair.slice(0, at).trim() !== WEB_COOKIE) continue;
    for (const part of pair.slice(at + 1).trim().split("~")) {
      const [key, value] = part.split(".");
      if ((key === "j" || key === "w") && /^[A-Za-z0-9_-]{20,200}$/.test(value || "")) out[key] = value;
    }
  }
  return out;
}

// Not readable by scripts, sent only over HTTPS, and never with a request
// another site started. It cannot carry the __Host- prefix the spec's guides
// suggest, because Hosting only forwards a cookie with this exact name.
function writeCookie(values) {
  const parts = ["j", "w"].filter((k) => values[k]).map((k) => `${k}.${values[k]}`);
  const life = parts.length ? Math.floor(WEB_SESSION_TTL_MS / 1000) : 0;
  return `${WEB_COOKIE}=${parts.join("~")}; Path=/; Max-Age=${life}; Secure; HttpOnly; SameSite=Strict`;
}

const STYLE =
  "body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#1c1c1c}" +
  "a{color:#0b57d0}h1{font-size:1.4rem}ul{padding-left:1.2rem}li{margin:.3rem 0}" +
  ".muted{color:#666;font-size:.9rem}.note{border:1px solid #d0d0d0;border-radius:6px;padding:.6rem .8rem}" +
  "input[type=search]{font:inherit;padding:.3rem .5rem;width:60%}button{font:inherit;padding:.3rem .8rem}";

const document = (title, body) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head>` +
  `<body>${body}</body></html>`;

function sendHtml(res, status, html, headers = {}) {
  res.status(status);
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    // No scripts and nothing loaded from elsewhere; forms post only to us.
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.send(html);
}

function createWebPages({ store, now, checkAgent, shutOut, send, shapeItems, hashToken, newToken, parseScope }) {
  // ---- The join -----------------------------------------------------------

  // Step 1. Starts, ends, and changes no session: a web session the browser
  // already has is written back unchanged beside the new join secret.
  async function joinPage(req, res) {
    const code = newToken("bc");
    const joinSecret = randomBytes(32).toString("base64url");
    await store.putBrowserCode(hashToken(code), {
      join_hash: hashToken(joinSecret),
      status: "issued",
      expires_at: now() + BROWSER_CODE_TTL_MS,
    });
    const html = document(
      "Connecting",
      `<h1>Connecting your agent's browser to HunaPuka</h1>` +
        `<p class="muted">This page is for a personal AI agent's own browser. If you are a person, ` +
        `<a href="/">open HunaPuka</a> instead.</p>` +
        `<form method="post" action="${PATHS.browserSession}">` +
        `<input type="hidden" name="code" value="${esc(code)}"><button>Continue</button></form>`,
    );
    sendHtml(res, 200, html, { "Set-Cookie": writeCookie({ j: joinSecret, w: readCookie(req).w }) });
  }

  // Step 2. The agent vouches for the code: this Session, this account, and
  // these scopes. An access token carrying the browser sign-in scope is
  // required, as at an API. The spec also lets an agent join its browser
  // signed out, but this site shows nothing to a signed-out browser, so a
  // request without a token is refused with a 401 naming the scope rather
  // than joining a browser that can only reach a dead end.
  async function authorizeCode(req, res) {
    const checked = await checkAgent(req, res, BROWSER_SCOPE);
    if (!checked) return;
    const { record, session } = checked;
    const invalid = () => send(res, 400, { error: "invalid_request" });
    const code = req.body && req.body.code;
    if (typeof code !== "string" || code.length > 200) return invalid();
    const hash = hashToken(code);
    const issued = await store.getBrowserCode(hash);
    if (!issued || issued.expires_at < now()) return invalid();
    const authorized = await store.moveBrowserCode(hash, "issued", {
      status: "authorized",
      uid: record.uid,
      client_id: record.client_id,
      grant_id: record.grant_id,
      scope: record.scope,
      sid: session ? session.sid : null,
    });
    if (!authorized) return invalid();
    send(res, 204);
  }

  // Step 3. The browser trades the code for the web session's cookie. The
  // code is used up by the first submission, whatever comes of it.
  async function submitCode(req, res) {
    const code = req.body && req.body.code;
    const used = typeof code === "string" && code.length <= 200 ? await store.useBrowserCode(hashToken(code)) : null;
    const joinSecret = readCookie(req).j;
    // The first problem found, in this order, so the message names the cause.
    let problem = null;
    if (!used) problem = "This code has already been used, or is not one HunaPuka issued.";
    else if (!joinSecret || hashToken(joinSecret) !== used.join_hash)
      problem = "This code was issued to a different browser, or this browser did not keep its cookie.";
    else if (used.expires_at < now()) problem = "This code expired before it was used.";
    else if (used.status !== "authorized")
      problem =
        "Your agent had not authorized this code yet. The agent has to authorize the code " +
        `at ${PATHS.browserSession}/authorize before its browser continues.`;
    if (problem) {
      const html = document(
        "Could not connect",
        `<h1>This browser could not be connected</h1>` +
          `<p>${esc(problem)}</p>` +
          `<p>Each code works only once. Start again at <a href="${PATHS.browserSession}">${PATHS.browserSession}</a>.</p>`,
      );
      return sendHtml(res, 400, html);
    }
    const token = newToken("hpw");
    await store.putWebSession(hashToken(token), {
      uid: used.uid,
      client_id: used.client_id,
      grant_id: used.grant_id,
      scope: used.scope,
      sid: used.sid,
      created_at: now(),
      expires_at: now() + WEB_SESSION_TTL_MS,
    });
    // Only the session now: the join secret has done its job.
    res.status(303);
    res.set({ "Cache-Control": "no-store", Location: PATHS.browse, "Set-Cookie": writeCookie({ w: token }) });
    res.end();
  }

  // ---- The pages ------------------------------------------------------------

  // Who the browser's cookie stands for right now. Looked up on every request,
  // so disconnecting the agent, or its sign-in lapsing, shows at once.
  async function whoIsBrowsing(req) {
    const token = readCookie(req).w;
    const session = token ? await store.getWebSession(hashToken(token)) : null;
    if (!session || session.expires_at < now()) return { joined: false };
    if (!session.uid || !session.grant_id) return { joined: true, signedIn: false };
    const grant = await store.getGrant(session.grant_id);
    const live = grant && !grant.revoked && grant.expires_at >= now() && !shutOut(grant.client_id);
    if (!live) return { joined: true, signedIn: false };
    return {
      joined: true,
      signedIn: true,
      uid: session.uid,
      agent: grant.client_name,
      canRead: parseScope(session.scope).includes(READ),
    };
  }

  const itemLink = (item) => `<a href="${PATHS.browse}/items/${encodeURIComponent(item.id)}">${esc(item.name || "(no name)")}</a>`;
  const inside = (n) => (n ? ` <span class="muted">(${n} inside)</span>` : "");
  const describe = (item) => (item.description ? `<div class="muted">${esc(item.description)}</div>` : "");
  const list = (items, withPath) =>
    items.length
      ? `<ul>${items
          .map(
            (i) =>
              `<li>${itemLink(i)}${inside(i.child_count)}` +
              (withPath ? ` <span class="muted">in ${esc(i.path.length ? i.path.join(" › ") : "the top level")}</span>` : "") +
              `${describe(i)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">Nothing here.</p>`;
  const searchForm = (q) =>
    `<form method="get" action="${PATHS.browse}" role="search">` +
    `<input type="search" name="q" value="${esc(q)}" placeholder="Search names and descriptions" aria-label="Search the inventory"> ` +
    `<button>Search</button></form>`;
  const footer = (agent) =>
    `<p class="muted note">Read-only view of this inventory for ${esc(agent || "a personal AI agent")}. ` +
    `Nothing can be added, changed, or deleted from these pages, and photos are not shown. ` +
    `Changes go through the API described at <a href="${PATHS.openapi}">${PATHS.openapi}</a>.</p>`;

  // The inventory, read-only: the top level, one container, or a search.
  async function browse(req, res, itemId) {
    const who = await whoIsBrowsing(req);
    if (!who.joined) {
      const html = document(
        "HunaPuka for agents",
        `<h1>This is HunaPuka's read-only view for personal AI agents</h1>` +
          `<p>Your browser is not connected to an agent Session. An agent's browser joins at ` +
          `<a href="${PATHS.browserSession}">${PATHS.browserSession}</a> first.</p>` +
          `<p>If you are a person, <a href="/">open HunaPuka</a> instead.</p>`,
      );
      return sendHtml(res, 401, html);
    }
    // Name the missing scopes, so the agent knows what to ask the person for.
    const missing = !who.signedIn ? [READ, BROWSER_SCOPE] : who.canRead ? [] : [READ];
    if (missing.length) {
      const html = document(
        "Not signed in",
        `<h1>${who.signedIn ? "This sign-in cannot see the inventory" : "This browser is not signed in"}</h1>` +
          `<p>HunaPuka has nothing to show without the person's approval. Missing scope${missing.length > 1 ? "s" : ""}: ` +
          `${missing.map((s) => `<code>${esc(s)}</code>`).join(" and ")}.</p>` +
          `<p>Sign in through the agent with ${missing.length > 1 ? "those scopes" : "that scope"}, then join this browser again at ` +
          `<a href="${PATHS.browserSession}">${PATHS.browserSession}</a>.</p>`,
      );
      return sendHtml(res, 403, html);
    }

    const items = shapeItems(await store.listItems(who.uid));
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    let title;
    let body;
    if (itemId !== undefined) {
      const item = items.find((i) => i.id === itemId);
      if (!item) {
        const html = document("Not found", `<h1>No such item</h1><p><a href="${PATHS.browse}">Back to the inventory</a></p>`);
        return sendHtml(res, 404, html);
      }
      // The trail of containers above this item, each one a link.
      const trail = [];
      for (let at = items.find((i) => i.id === item.location_id); at; at = items.find((i) => i.id === at.location_id)) {
        if (trail.includes(at)) break;
        trail.unshift(at);
      }
      title = item.name;
      body =
        `<p class="muted"><a href="${PATHS.browse}">Inventory</a>${trail.map((t) => ` › ${itemLink(t)}`).join("")}</p>` +
        `<h1>${esc(item.name || "(no name)")}</h1>${describe(item)}` +
        `<h2>Inside</h2>${list(items.filter((i) => i.location_id === item.id))}`;
    } else if (q) {
      const needle = q.toLowerCase();
      const hits = items.filter((i) => i.name.toLowerCase().includes(needle) || i.description.toLowerCase().includes(needle));
      title = `Search: ${q}`;
      body =
        `<p class="muted"><a href="${PATHS.browse}">Inventory</a></p><h1>${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(q)}”</h1>` +
        `${searchForm(q)}${list(hits, true)}`;
    } else {
      title = "Inventory";
      body = `<h1>Inventory</h1>${searchForm("")}<p class="muted">${items.length} item${items.length === 1 ? "" : "s"} in all. At the top level:</p>${list(items.filter((i) => i.location_id === null))}`;
    }
    sendHtml(res, 200, document(`${title} - HunaPuka`, body + footer(who.agent)));
  }

  return { joinPage, authorizeCode, submitCode, browse };
}

module.exports = { createWebPages, readCookie, writeCookie };
