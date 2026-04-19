const TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;

export interface CimdDocument {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  scope: string;
  token_endpoint_auth_method: 'none';
}

export interface CimdError {
  error:
    | 'invalid_client_metadata'
    | 'invalid_redirect_uri'
    | 'invalid_request'
    | 'server_error';
  error_description: string;
}

interface CacheEntry {
  doc: CimdDocument;
  expiresAt: number;
  etag: string | null;
}

const cache = new Map<string, CacheEntry>();

export function isCimdClientId(clientId: string): boolean {
  if (typeof clientId !== 'string' || !clientId.startsWith('https://')) {
    return false;
  }
  try {
    const u = new URL(clientId);
    return u.protocol === 'https:' && u.hostname.length > 0 && !u.hash;
  } catch {
    return false;
  }
}

export async function fetchCimd(
  clientIdUrl: string,
  supportedScopes: readonly string[],
): Promise<CimdDocument | CimdError> {
  if (!isCimdClientId(clientIdUrl)) {
    return {
      error: 'invalid_request',
      error_description: 'client_id is not a valid HTTPS URL.',
    };
  }

  const now = Date.now();
  const cached = cache.get(clientIdUrl);
  if (cached && cached.expiresAt > now) return cached.doc;

  let resp: Response;
  try {
    resp = await fetch(clientIdUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(cached?.etag ? { 'if-none-match': cached.etag } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (err) {
    return {
      error: 'server_error',
      error_description: `Failed to fetch client metadata: ${(err as Error).message}`,
    };
  }

  if (resp.status === 304 && cached) {
    cached.expiresAt = now + TTL_MS;
    return cached.doc;
  }

  if (!resp.ok) {
    return {
      error: 'invalid_request',
      error_description: `Client metadata URL returned HTTP ${resp.status}.`,
    };
  }

  const declaredLen = Number(resp.headers.get('content-length') ?? '0');
  if (declaredLen > MAX_BODY_BYTES) {
    return {
      error: 'invalid_client_metadata',
      error_description: `Client metadata exceeds ${MAX_BODY_BYTES} bytes.`,
    };
  }

  let buf: ArrayBuffer;
  try {
    buf = await resp.arrayBuffer();
  } catch (err) {
    return {
      error: 'server_error',
      error_description: `Failed to read client metadata: ${(err as Error).message}`,
    };
  }
  if (buf.byteLength > MAX_BODY_BYTES) {
    return {
      error: 'invalid_client_metadata',
      error_description: `Client metadata exceeds ${MAX_BODY_BYTES} bytes.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(buf).toString('utf8'));
  } catch {
    return {
      error: 'invalid_client_metadata',
      error_description: 'Client metadata document is not valid JSON.',
    };
  }

  const validated = validate(parsed, clientIdUrl, supportedScopes);
  if ('error' in validated) return validated;

  cache.set(clientIdUrl, {
    doc: validated,
    expiresAt: now + TTL_MS,
    etag: resp.headers.get('etag'),
  });
  return validated;
}

function validate(
  body: unknown,
  expectedClientId: string,
  supportedScopes: readonly string[],
): CimdDocument | CimdError {
  if (!body || typeof body !== 'object') {
    return {
      error: 'invalid_client_metadata',
      error_description: 'Client metadata must be a JSON object.',
    };
  }
  const b = body as Record<string, unknown>;

  if (b['client_id'] !== expectedClientId) {
    return {
      error: 'invalid_client_metadata',
      error_description:
        'client_id in metadata document must equal the fetch URL.',
    };
  }

  if (b['token_endpoint_auth_method'] !== 'none') {
    return {
      error: 'invalid_client_metadata',
      error_description:
        'CIMD clients must set token_endpoint_auth_method to "none" (public PKCE client).',
    };
  }

  const uris = b['redirect_uris'];
  if (!Array.isArray(uris) || uris.length === 0) {
    return {
      error: 'invalid_redirect_uri',
      error_description: '`redirect_uris` is required and must be non-empty.',
    };
  }
  for (const u of uris) {
    if (typeof u !== 'string') {
      return {
        error: 'invalid_redirect_uri',
        error_description: 'Each redirect URI must be a string.',
      };
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:') {
        return {
          error: 'invalid_redirect_uri',
          error_description: `Redirect URI must be https: ${u}.`,
        };
      }
      if (parsed.hash) {
        return {
          error: 'invalid_redirect_uri',
          error_description: `Redirect URI must not contain a fragment: ${u}.`,
        };
      }
    } catch {
      return {
        error: 'invalid_redirect_uri',
        error_description: `Invalid redirect URI: ${u}.`,
      };
    }
  }

  const name = typeof b['client_name'] === 'string' ? b['client_name'] : '';
  if (name.length > 200) {
    return {
      error: 'invalid_client_metadata',
      error_description: 'client_name must be <= 200 chars.',
    };
  }

  const scopeStr =
    typeof b['scope'] === 'string' ? b['scope'] : supportedScopes.join(' ');
  const scopes = scopeStr.split(/\s+/).filter(Boolean);
  const allowed = new Set(supportedScopes);
  for (const s of scopes) {
    if (!allowed.has(s)) {
      return {
        error: 'invalid_client_metadata',
        error_description: `Unsupported scope: ${s}.`,
      };
    }
  }

  return {
    client_id: expectedClientId,
    client_name: name,
    redirect_uris: uris as string[],
    scope: scopes.join(' '),
    token_endpoint_auth_method: 'none',
  };
}
