// The Poppy endpoints for hunapuka.com, as one request handler:
//
//   discovery      /.well-known/poppy.json, oauth-protected-resource,
//                  oauth-authorization-server, /api/openapi.json, and a
//                  document for each older protocol version still served
//   sign-in        shared with storageloot.shop: see auth.js (consent page,
//                  token, revoke, Device Sign-In, connected agents)
//   web browsing   /poppy/browser-session joins the agent's browser to its
//                  Session, and /browse is the read-only inventory it then
//                  sees (src/poppy/web.js)
//   inventory API  /api/v1/items: read, add, edit, move, delete. No photos.
//
// Dependencies are injected so the whole flow can run in tests without
// Firestore, Firebase Auth, or the network.

const { randomBytes } = require("node:crypto");
const {
  ORIGIN,
  ISSUER,
  OLDER_VERSIONS,
  SCOPES,
  ENFORCE_AGENT_IDENTITY,
  APPROVED_CLIENTS,
  APPROVED_CLIENTS_ONLY,
  NAME_MAX,
  DESCRIPTION_MAX,
  PATHS,
} = require("./config");
const documents = require("./documents");
const {
  createAgentAuth,
  versionServed,
  hashToken,
  newToken,
  send,
  oauthError,
  parseScope,
  toIso,
  defaultLogIdentity,
} = require("./auth");
const { createWebPages } = require("./web");

const READ = "inventory:read";
const WRITE = "inventory:write";
const DELETE = "inventory:delete";

// hunapuka.com as auth.js sees it.
const SITE = {
  origin: ORIGIN,
  issuer: ISSUER,
  name: "HunaPuka",
  scopes: SCOPES,
  apiPath: PATHS.api,
  tokenPrefix: "hp",
  protectedResourceMetadata: (resource) => documents.protectedResourceMetadata(resource),
  describeScopes: (scopes) => ({
    can_read: scopes.includes(READ),
    can_write: scopes.includes(WRITE),
    can_delete: scopes.includes(DELETE),
  }),
};

// The public shape of an inventory. Built field by field rather than by
// removing fields, so photos, canvas coordinates, and anything added to items
// later stay private unless someone decides to expose them here.
function shapeItems(raw) {
  const byId = new Map(raw.map((item) => [item.id, item]));
  const childCount = new Map();
  for (const item of raw) {
    if (item.locationId) childCount.set(item.locationId, (childCount.get(item.locationId) || 0) + 1);
  }
  const pathOf = (item) => {
    const names = [];
    const seen = new Set([item.id]);
    let parent = byId.get(item.locationId);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(String(parent.name || ""));
      parent = byId.get(parent.locationId);
    }
    return names;
  };
  return raw.map((item) => ({
    id: item.id,
    name: String(item.name || ""),
    description: typeof item.description === "string" ? item.description : "",
    location_id: byId.has(item.locationId) ? item.locationId : null,
    path: pathOf(item),
    child_count: childCount.get(item.id) || 0,
    created_at: toIso(item.createdAt),
  }));
}

function createPoppyHandler({
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
  const { checkAgent, shutOut, resourceMetadataFor } = auth;

  // ---- The inventory API ------------------------------------------------

  // Returns the access token record, or null after answering the request.
  async function authorizeApiRequest(req, res, scope) {
    const checked = await checkAgent(req, res, scope);
    return checked && checked.record;
  }

  const web = createWebPages({ store, now, checkAgent, shutOut, send, shapeItems, hashToken, newToken, parseScope });

  async function handleItems(req, res, itemId) {
    const record = await authorizeApiRequest(req, res, READ);
    if (!record) return;
    let items = shapeItems(await store.listItems(record.uid));
    if (itemId !== undefined) {
      const item = items.find((i) => i.id === itemId);
      return item ? send(res, 200, item) : oauthError(res, 404, "not_found", "No such item.");
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    if (q) {
      items = items.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
      );
    }
    const at = typeof req.query.location_id === "string" ? req.query.location_id : "";
    if (at) items = items.filter((i) => i.location_id === (at === "root" ? null : at));
    send(res, 200, { items, total: items.length });
  }

  // Reads the writable fields out of a request body. Returns { error } for a
  // bad value, otherwise only the fields that were actually sent.
  function readItemFields(body) {
    const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const out = {};
    if (b.name !== undefined) {
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name || name.length > NAME_MAX) {
        return { error: `name must be 1 to ${NAME_MAX} characters.` };
      }
      out.name = name;
    }
    if (b.description !== undefined) {
      if (typeof b.description !== "string" || b.description.length > DESCRIPTION_MAX) {
        return { error: `description must be text of at most ${DESCRIPTION_MAX} characters.` };
      }
      out.description = b.description;
    }
    if (b.location_id !== undefined) {
      if (b.location_id !== null && typeof b.location_id !== "string") {
        return { error: "location_id must be an item id or null." };
      }
      out.locationId = b.location_id;
    }
    return out;
  }

  const invalid = (res, description) => oauthError(res, 422, "invalid_request", description);
  const orders = (items, locationId) =>
    items.filter((i) => (i.locationId ?? null) === locationId).map((i) => i.order ?? 0);
  const shapedOne = (items, id) => shapeItems(items).find((i) => i.id === id);

  async function handleCreateItem(req, res) {
    const record = await authorizeApiRequest(req, res, WRITE);
    if (!record) return;
    const fields = readItemFields(req.body);
    if (fields.error) return invalid(res, fields.error);
    if (!fields.name) return invalid(res, "name is required.");
    const items = await store.listItems(record.uid);
    const locationId = fields.locationId ?? null;
    if (locationId !== null && !items.some((i) => i.id === locationId)) {
      return invalid(res, "location_id names no item in this inventory.");
    }

    // A retried request with the same Idempotency-Key maps to the same
    // document id, so it finds the first attempt's item instead of adding one.
    const key = req.get("idempotency-key");
    if (key !== undefined && (!key || key.length > 200)) {
      return invalid(res, "Idempotency-Key must be 1 to 200 characters.");
    }
    const id = key
      ? `poppy_${hashToken(`${record.client_id}\n${record.uid}\n${key}`).slice(0, 32)}`
      : `poppy_${randomBytes(16).toString("hex")}`;
    const existing = shapedOne(items, id);
    if (existing) return send(res, 200, existing);

    const siblings = orders(items, locationId);
    // The same shape the web app writes, new items first among their siblings.
    const data = {
      name: fields.name,
      description: fields.description || "",
      locationId,
      order: siblings.length ? Math.min(...siblings) - 1 : 0,
      photos: [],
      createdAt: now(),
    };
    if (!(await store.createItem(record.uid, id, data))) {
      // Created by a request racing this one, after our read.
      return oauthError(res, 409, "conflict", "This request is already in progress.");
    }
    send(res, 201, shapedOne([...items, { id, ...data }], id));
  }

  async function handleUpdateItem(req, res, itemId) {
    const record = await authorizeApiRequest(req, res, WRITE);
    if (!record) return;
    const fields = readItemFields(req.body);
    if (fields.error) return invalid(res, fields.error);
    if (Object.keys(fields).length === 0) {
      return invalid(res, "Send name, description, or location_id.");
    }
    const items = await store.listItems(record.uid);
    const item = items.find((i) => i.id === itemId);
    if (!item) return oauthError(res, 404, "not_found", "No such item.");

    const patch = {};
    if (fields.name !== undefined) patch.name = fields.name;
    if (fields.description !== undefined) patch.description = fields.description;
    if (fields.locationId !== undefined && fields.locationId !== (item.locationId ?? null)) {
      const target = fields.locationId;
      const byId = new Map(items.map((i) => [i.id, i]));
      if (target !== null) {
        if (!byId.has(target)) return invalid(res, "location_id names no item in this inventory.");
        // Walk up from the target: meeting the item means it would contain itself.
        const seen = new Set();
        for (let at = target; at && byId.has(at) && !seen.has(at); at = byId.get(at).locationId) {
          if (at === itemId) return invalid(res, "An item cannot be moved into itself or its contents.");
          seen.add(at);
        }
      }
      const siblings = orders(items, target);
      patch.locationId = target;
      patch.order = siblings.length ? Math.max(...siblings) + 1 : 0;
      // Canvas coordinates are relative to the old container, so a move voids them.
      patch.x = null;
      patch.y = null;
    }
    if (Object.keys(patch).length) await store.updateItem(record.uid, itemId, patch);
    send(res, 200, shapedOne(items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)), itemId));
  }

  // Deletes one item. A container with anything inside is refused rather than
  // emptied, so one request can never take a whole branch of the inventory
  // with it; the agent has to delete each thing by name. Photos live in the
  // owner's Google Drive, which the server cannot reach, so they stay there.
  async function handleDeleteItem(req, res, itemId) {
    const record = await authorizeApiRequest(req, res, DELETE);
    if (!record) return;
    const items = await store.listItems(record.uid);
    if (!items.some((i) => i.id === itemId)) {
      return oauthError(res, 404, "not_found", "No such item.");
    }
    const inside = items.filter((i) => i.locationId === itemId).length;
    if (inside > 0) {
      return oauthError(
        res,
        409,
        "not_empty",
        `This item has ${inside} item(s) inside. Move or delete those first.`,
      );
    }
    await store.deleteItem(record.uid, itemId);
    send(res, 204);
  }

  // ---- Routing ----------------------------------------------------------

  const cached = { "Cache-Control": "public, max-age=300" };
  const routes = {
    "GET /.well-known/poppy.json": (req, res) => send(res, 200, documents.poppyJson(), cached),
    "GET /.well-known/oauth-protected-resource": (req, res) =>
      send(res, 200, documents.protectedResourceMetadata(), cached),
    "GET /.well-known/oauth-authorization-server": (req, res) =>
      send(res, 200, documents.authorizationServerMetadata(), cached),
    [`GET ${PATHS.openapi}`]: (req, res) => send(res, 200, documents.openApi(), cached),
    ...Object.fromEntries(
      Object.entries(OLDER_VERSIONS).map(([version, path]) => [
        `GET ${path}`,
        (req, res) => send(res, 200, documents.poppyJson(version), cached),
      ]),
    ),
    ...auth.routes,
    [`GET ${PATHS.browserSession}`]: web.joinPage,
    [`POST ${PATHS.browserSession}`]: web.submitCode,
    [`POST ${PATHS.browserSession}/authorize`]: web.authorizeCode,
    [`GET ${PATHS.browse}`]: (req, res) => web.browse(req, res),
    [`GET ${PATHS.api}/items`]: (req, res) => handleItems(req, res),
    [`POST ${PATHS.api}/items`]: handleCreateItem,
  };

  return async function handle(req, res) {
    try {
      const route = routes[`${req.method} ${req.path}`];
      if (route) return await route(req, res);
      const item = new RegExp(`^${PATHS.api}/items/([A-Za-z0-9_-]{1,64})$`).exec(req.path);
      if (item && req.method === "GET") return await handleItems(req, res, item[1]);
      if (item && req.method === "PATCH") return await handleUpdateItem(req, res, item[1]);
      if (item && req.method === "DELETE") return await handleDeleteItem(req, res, item[1]);
      const metadata = /^\/\.well-known\/oauth-protected-resource(\/.*)$/.exec(req.path);
      if (metadata && req.method === "GET") {
        const doc = resourceMetadataFor(metadata[1]);
        return doc ? send(res, 200, doc, cached) : oauthError(res, 404, "not_found", "No such resource.");
      }
      const viewed = new RegExp(`^${PATHS.browse}/items/([A-Za-z0-9_-]{1,64})$`).exec(req.path);
      if (viewed && req.method === "GET") return await web.browse(req, res, viewed[1]);
      oauthError(res, 404, "not_found", "No such endpoint.");
    } catch (err) {
      // Message only: requests carry tokens and Session JWTs, which are secrets.
      console.error("poppy handler failed:", err && err.message);
      oauthError(res, 500, "server_error", "Something went wrong.");
    }
  };
}

module.exports = {
  createPoppyHandler,
  shapeItems,
  hashToken,
  newToken,
  send,
  oauthError,
  versionServed,
  defaultLogIdentity,
};
