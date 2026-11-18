// Web browsing for Personal Agents (spec section 6) on hunapuka.com: the
// read-only inventory pages a joined browser is shown. The join itself is
// shared with other sites (join.js); here it requires an access token.
//
// The pages are rendered here, not by the React app. That app signs people in
// with Google and reads Firestore directly, with everything the account can
// do. These pages are built from the same field-by-field shape as the API, so
// an agent's browser sees item names, descriptions, and structure only: no
// photos, and no way to change anything.

const { PATHS, BROWSER_SCOPE } = require("./config");
const { createBrowserJoin, readCookie, writeCookie, sendHtml, document, esc } = require("./join");

const READ = "inventory:read";

function createWebPages({ store, now, checkAgent, shutOut, send, shapeItems, hashToken, newToken, parseScope }) {
  // An access token carrying the browser sign-in scope is required, as at an
  // API. The spec also lets an agent join its browser signed out, but this
  // site shows nothing to a signed-out browser, so a request without a token
  // is refused with a 401 naming the scope rather than joining a browser that
  // can only reach a dead end.
  async function authorizeAgent(req, res) {
    const checked = await checkAgent(req, res, BROWSER_SCOPE);
    if (!checked) return null;
    const { record, session } = checked;
    return {
      uid: record.uid,
      client_id: record.client_id,
      grant_id: record.grant_id,
      scope: record.scope,
      sid: session ? session.sid : null,
    };
  }
  const join = createBrowserJoin({
    store,
    now,
    send,
    hashToken,
    newToken,
    siteName: "HunaPuka",
    tokenPrefix: "hpw",
    authorizeAgent,
  });

  // ---- The pages ------------------------------------------------------------

  // Who the browser's cookie stands for right now. Looked up on every request,
  // so disconnecting the agent, or its sign-in lapsing, shows at once.
  async function whoIsBrowsing(req) {
    const session = await join.webSession(req);
    if (!session) return { joined: false };
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

  return { joinPage: join.joinPage, authorizeCode: join.authorizeCode, submitCode: join.submitCode, browse };
}

module.exports = { createWebPages, readCookie, writeCookie };
