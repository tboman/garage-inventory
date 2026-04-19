const TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;

const cache = new Map();

function isCimdClientId(clientId) {
  if (typeof clientId !== "string" || !clientId.startsWith("https://")) {
    return false;
  }
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.hostname.length > 0 && !u.hash;
  } catch {
    return false;
  }
}

async function fetchCimd(clientIdUrl, supportedScopes) {
  if (!isCimdClientId(clientIdUrl)) {
    return {
      error: "invalid_request",
      error_description: "client_id is not a valid HTTPS URL.",
    };
  }

  const now = Date.now();
  const cached = cache.get(clientIdUrl);
  if (cached && cached.expiresAt > now) return cached.doc;

  let resp;
  try {
    resp = await fetch(clientIdUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(cached && cached.etag ? { "if-none-match": cached.etag } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    return {
      error: "server_error",
      error_description: `Failed to fetch client metadata: ${err.message}`,
    };
  }

  if (resp.status === 304 && cached) {
    cached.expiresAt = now + TTL_MS;
    return cached.doc;
  }
  if (!resp.ok) {
    return {
      error: "invalid_request",
      error_description: `Client metadata URL returned HTTP ${resp.status}.`,
    };
  }

  const declaredLen = Number(resp.headers.get("content-length") || "0");
  if (declaredLen > MAX_BODY_BYTES) {
    return {
      error: "invalid_client_metadata",
      error_description: `Client metadata exceeds ${MAX_BODY_BYTES} bytes.`,
    };
  }

  let buf;
  try {
    buf = await resp.arrayBuffer();
  } catch (err) {
    return {
      error: "server_error",
      error_description: `Failed to read client metadata: ${err.message}`,
    };
  }
  if (buf.byteLength > MAX_BODY_BYTES) {
    return {
      error: "invalid_client_metadata",
      error_description: `Client metadata exceeds ${MAX_BODY_BYTES} bytes.`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {
    return {
      error: "invalid_client_metadata",
      error_description: "Client metadata document is not valid JSON.",
    };
  }

  const validated = validate(parsed, clientIdUrl, supportedScopes);
  if (validated.error) return validated;

  cache.set(clientIdUrl, {
    doc: validated,
    expiresAt: now + TTL_MS,
    etag: resp.headers.get("etag"),
  });
  return validated;
}

function validate(body, expectedClientId, supportedScopes) {
  if (!body || typeof body !== "object") {
    return {
      error: "invalid_client_metadata",
      error_description: "Client metadata must be a JSON object.",
    };
  }
  if (body.client_id !== expectedClientId) {
    return {
      error: "invalid_client_metadata",
      error_description:
        "client_id in metadata document must equal the fetch URL.",
    };
  }
  if (body.token_endpoint_auth_method !== "none") {
    return {
      error: "invalid_client_metadata",
      error_description:
        'CIMD clients must set token_endpoint_auth_method to "none".',
    };
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return {
      error: "invalid_redirect_uri",
      error_description: "`redirect_uris` is required and must be non-empty.",
    };
  }
  for (const u of uris) {
    if (typeof u !== "string") {
      return {
        error: "invalid_redirect_uri",
        error_description: "Each redirect URI must be a string.",
      };
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:") {
        return {
          error: "invalid_redirect_uri",
          error_description: `Redirect URI must be https: ${u}.`,
        };
      }
      if (parsed.hash) {
        return {
          error: "invalid_redirect_uri",
          error_description: `Redirect URI must not contain a fragment: ${u}.`,
        };
      }
    } catch {
      return {
        error: "invalid_redirect_uri",
        error_description: `Invalid redirect URI: ${u}.`,
      };
    }
  }

  const name = typeof body.client_name === "string" ? body.client_name : "";
  if (name.length > 200) {
    return {
      error: "invalid_client_metadata",
      error_description: "client_name must be <= 200 chars.",
    };
  }

  const scopeStr =
    typeof body.scope === "string" ? body.scope : supportedScopes.join(" ");
  const scopes = scopeStr.split(/\s+/).filter(Boolean);
  const allowed = new Set(supportedScopes);
  for (const s of scopes) {
    if (!allowed.has(s)) {
      return {
        error: "invalid_client_metadata",
        error_description: `Unsupported scope: ${s}.`,
      };
    }
  }

  return {
    client_id: expectedClientId,
    client_name: name,
    redirect_uris: uris,
    scope: scopes.join(" "),
    token_endpoint_auth_method: "none",
  };
}

module.exports = { fetchCimd, isCimdClientId };
