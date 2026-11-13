// Fetches a Personal Agent's client metadata document and key set (spec 4.1).
// The URLs come from the agent, so every fetch is treated as hostile input:
// HTTPS only, no redirects, public addresses only, small bodies, short timeout.

const dns = require("node:dns").promises;
const net = require("node:net");

const TTL_MS = 5 * 60 * 1000;
const MIN_REFETCH_MS = 30 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

class ClientError extends Error {}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateAddress(bare)) throw new ClientError("Address is not public.");
    return;
  }
  let records;
  try {
    records = await dns.lookup(bare, { all: true });
  } catch {
    throw new ClientError("Host does not resolve.");
  }
  if (records.length === 0 || records.some((r) => isPrivateAddress(r.address))) {
    throw new ClientError("Address is not public.");
  }
}

function parseHttpsUrl(value) {
  if (typeof value !== "string") return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password || u.hash) return null;
  return u;
}

async function defaultFetchJson(url) {
  const u = parseHttpsUrl(url);
  if (!u) throw new ClientError("Not an HTTPS URL.");
  await assertPublicHost(u.hostname);
  let resp;
  try {
    resp = await fetch(u, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ClientError("Fetch failed.");
  }
  if (resp.status !== 200) throw new ClientError(`HTTP ${resp.status}.`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength > MAX_BODY_BYTES) throw new ClientError("Document is too large.");
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new ClientError("Document is not JSON.");
  }
}

// The spec says "the same domain" without defining it. Read here as the same
// host or a parent or child of it, so an agent may keep keys on a subdomain.
// The rule protects the agent's own identity, so a loose reading costs us nothing.
function sameDomain(a, b) {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function isLoopbackRedirect(u) {
  return (
    u.protocol === "http:" &&
    (u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "localhost")
  );
}

function validateMetadata(body, clientId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ClientError("Client metadata must be a JSON object.");
  }
  if (body.client_id !== clientId) {
    throw new ClientError("client_id in the metadata must equal its URL.");
  }
  const host = new URL(clientId).hostname;
  const jwks = parseHttpsUrl(body.jwks_uri);
  if (!jwks || !sameDomain(jwks.hostname, host)) {
    throw new ClientError("jwks_uri must be an HTTPS URL on the client_id's domain.");
  }
  if (
    body.token_endpoint_auth_method !== undefined &&
    body.token_endpoint_auth_method !== "private_key_jwt"
  ) {
    throw new ClientError("token_endpoint_auth_method must be private_key_jwt.");
  }
  const redirectUris = [];
  for (const raw of Array.isArray(body.redirect_uris) ? body.redirect_uris : []) {
    if (typeof raw !== "string") continue;
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.hash) continue;
    // Same domain as the client_id, or a loopback URI for an app on the User's
    // own computer (RFC 8252 §7.3). Anything else is dropped, not trusted.
    if ((u.protocol === "https:" && sameDomain(u.hostname, host)) || isLoopbackRedirect(u)) {
      redirectUris.push(raw);
    }
  }
  const logo = parseHttpsUrl(body.logo_uri);
  return {
    client_id: clientId,
    client_name:
      typeof body.client_name === "string" ? body.client_name.slice(0, 80).trim() : "",
    logo_uri: logo ? logo.href : null,
    jwks_uri: jwks.href,
    redirect_uris: redirectUris,
    host,
  };
}

// True when `redirectUri` is registered, comparing exactly except for the port
// of a loopback URI, which the agent picks at run time (spec 4.2).
function redirectUriAllowed(client, redirectUri) {
  if (typeof redirectUri !== "string") return false;
  if (client.redirect_uris.includes(redirectUri)) return true;
  let asked;
  try {
    asked = new URL(redirectUri);
  } catch {
    return false;
  }
  if (!isLoopbackRedirect(asked) || asked.hash) return false;
  return client.redirect_uris.some((raw) => {
    const reg = new URL(raw);
    return (
      isLoopbackRedirect(reg) &&
      reg.hostname === asked.hostname &&
      reg.pathname === asked.pathname &&
      reg.search === asked.search
    );
  });
}

function createClientDirectory({ fetchJson = defaultFetchJson, now = Date.now } = {}) {
  const docs = new Map();
  const keySets = new Map();

  async function getClient(clientId) {
    const u = parseHttpsUrl(clientId);
    if (!u || u.href.length > 2000) throw new ClientError("client_id must be an HTTPS URL.");
    const hit = docs.get(clientId);
    if (hit && hit.expiresAt > now()) return hit.client;
    const client = validateMetadata(await fetchJson(clientId), clientId);
    docs.set(clientId, { client, expiresAt: now() + TTL_MS });
    return client;
  }

  async function loadKeys(client, force) {
    const hit = keySets.get(client.jwks_uri);
    if (hit && !force && hit.expiresAt > now()) return hit.keys;
    // A missing kid can mean the agent rotated keys, so one refetch is allowed,
    // but not so often that a bad kid turns us into a request amplifier.
    if (hit && force && now() - hit.fetchedAt < MIN_REFETCH_MS) return hit.keys;
    const body = await fetchJson(client.jwks_uri);
    const keys = (body && Array.isArray(body.keys) ? body.keys : []).filter(
      (k) => k && typeof k === "object" && typeof k.kty === "string" && k.d === undefined,
    );
    keySets.set(client.jwks_uri, { keys, fetchedAt: now(), expiresAt: now() + TTL_MS });
    return keys;
  }

  // The agent's published key named by `kid`, usable with `alg`.
  async function getKey(client, kid, alg) {
    const fits = (k) =>
      k.kid === kid &&
      (alg === "ES256" ? k.kty === "EC" && k.crv === "P-256" : k.kty === "RSA") &&
      (k.use === undefined || k.use === "sig");
    if (typeof kid !== "string" || !kid) throw new ClientError("JWT has no kid.");
    let key = (await loadKeys(client, false)).find(fits);
    if (!key) key = (await loadKeys(client, true)).find(fits);
    if (!key) throw new ClientError("No published key matches the JWT's kid.");
    return key;
  }

  return { getClient, getKey };
}

module.exports = {
  ClientError,
  createClientDirectory,
  redirectUriAllowed,
  isPrivateAddress,
  parseHttpsUrl,
};
