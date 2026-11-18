// The browser join for Personal Agents (spec section 6), shared by every site
// that offers web browsing.
//
// The join has three steps. The agent's browser loads the join page, which
// holds a one-time code and sets a cookie tying that code to this browser.
// The agent authorizes the code in a request of its own, with its Session
// header (and, where the site requires one, its access token). The browser
// then submits the code and is given the web session's cookie. Nothing the
// agent authenticates with ever passes through the browser.
//
// What the agent must show to authorize a code is the site's decision, so it
// is passed in as `authorizeAgent`. Everything else is the same everywhere.

const { randomBytes } = require("node:crypto");
const { PATHS, BROWSER_CODE_TTL_MS, WEB_SESSION_TTL_MS, WEB_COOKIE } = require("./config");

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
  "input[type=search]{font:inherit;padding:.3rem .5rem;width:60%}button,select{font:inherit;padding:.3rem .8rem}" +
  "img{max-width:100%;height:auto;border-radius:4px}";

const document = (title, body) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head>` +
  `<body>${body}</body></html>`;

// No scripts and nothing loaded from elsewhere; forms post only to us. A site
// that shows images from a known host adds it with `imgSrc`.
const csp = (imgSrc) =>
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" +
  (imgSrc ? `; img-src ${imgSrc}` : "");

function sendHtml(res, status, html, headers = {}) {
  res.status(status);
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": csp(),
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.send(html);
}

// `authorizeAgent(req, res)` resolves to what the web session will stand for,
// { uid, client_id, grant_id, scope, sid } with nulls where nothing applies,
// or to null once it has answered the request itself.
function createBrowserJoin({ store, now, send, hashToken, newToken, siteName, tokenPrefix, authorizeAgent }) {
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
      `<h1>Connecting your agent's browser to ${esc(siteName)}</h1>` +
        `<p class="muted">This page is for a personal AI agent's own browser. If you are a person, ` +
        `<a href="/">open ${esc(siteName)}</a> instead.</p>` +
        `<form method="post" action="${PATHS.browserSession}">` +
        `<input type="hidden" name="code" value="${esc(code)}"><button>Continue</button></form>`,
    );
    sendHtml(res, 200, html, { "Set-Cookie": writeCookie({ j: joinSecret, w: readCookie(req).w }) });
  }

  // Step 2. The agent vouches for the code, as `authorizeAgent` requires.
  async function authorizeCode(req, res) {
    const who = await authorizeAgent(req, res);
    if (!who) return;
    const invalid = () => send(res, 400, { error: "invalid_request" });
    const code = req.body && req.body.code;
    if (typeof code !== "string" || code.length > 200) return invalid();
    const hash = hashToken(code);
    const issued = await store.getBrowserCode(hash);
    if (!issued || issued.expires_at < now()) return invalid();
    const authorized = await store.moveBrowserCode(hash, "issued", {
      status: "authorized",
      uid: who.uid,
      client_id: who.client_id,
      grant_id: who.grant_id,
      scope: who.scope,
      sid: who.sid,
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
    if (!used) problem = `This code has already been used, or is not one ${siteName} issued.`;
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
    const token = newToken(tokenPrefix);
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

  // The web session the browser's cookie names, if it is still live.
  async function webSession(req) {
    const token = readCookie(req).w;
    const session = token ? await store.getWebSession(hashToken(token)) : null;
    return session && session.expires_at >= now() ? session : null;
  }

  return { joinPage, authorizeCode, submitCode, webSession };
}

module.exports = { createBrowserJoin, readCookie, writeCookie, sendHtml, document, esc, csp };
