const SUPPORTED_SCOPES = new Set([
  'openid',
  'profile',
  'market:read',
  'market:search',
]);
const SUPPORTED_GRANTS = new Set(['authorization_code', 'refresh_token']);
const SUPPORTED_RESPONSE_TYPES = new Set(['code']);
const SUPPORTED_AUTH_METHODS = new Set([
  'none',
  'client_secret_basic',
  'client_secret_post',
]);

export interface ValidatedMetadata {
  redirect_uris: string[];
  client_name: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  scope: string;
}

export interface ValidationError {
  error: string;
  error_description: string;
}

export function validateMetadata(
  body: unknown,
): ValidatedMetadata | ValidationError {
  if (!body || typeof body !== 'object') {
    return {
      error: 'invalid_client_metadata',
      error_description: 'Body must be a JSON object.',
    };
  }
  const b = body as Record<string, unknown>;

  const uris = b['redirect_uris'];
  if (!Array.isArray(uris) || uris.length === 0) {
    return {
      error: 'invalid_redirect_uri',
      error_description: '`redirect_uris` is required and must be a non-empty array.',
    };
  }
  for (const u of uris) {
    if (typeof u !== 'string') {
      return {
        error: 'invalid_redirect_uri',
        error_description: 'Each redirect URI must be a string.',
      };
    }
    const problem = checkRedirectUri(u);
    if (problem) return problem;
  }

  const name = typeof b['client_name'] === 'string' ? b['client_name'] : '';
  if (name.length > 200) {
    return {
      error: 'invalid_client_metadata',
      error_description: 'client_name must be <= 200 chars.',
    };
  }

  const authMethod =
    typeof b['token_endpoint_auth_method'] === 'string'
      ? b['token_endpoint_auth_method']
      : 'client_secret_basic';
  if (!SUPPORTED_AUTH_METHODS.has(authMethod)) {
    return {
      error: 'invalid_client_metadata',
      error_description: `Unsupported token_endpoint_auth_method: ${authMethod}.`,
    };
  }

  const grantsRaw = b['grant_types'];
  const grants =
    Array.isArray(grantsRaw) && grantsRaw.length > 0
      ? grantsRaw
      : ['authorization_code'];
  for (const g of grants) {
    if (typeof g !== 'string' || !SUPPORTED_GRANTS.has(g)) {
      return {
        error: 'invalid_client_metadata',
        error_description: `Unsupported grant_type: ${String(g)}.`,
      };
    }
  }

  const responseRaw = b['response_types'];
  const responses =
    Array.isArray(responseRaw) && responseRaw.length > 0 ? responseRaw : ['code'];
  for (const r of responses) {
    if (typeof r !== 'string' || !SUPPORTED_RESPONSE_TYPES.has(r)) {
      return {
        error: 'invalid_client_metadata',
        error_description: `Unsupported response_type: ${String(r)}.`,
      };
    }
  }

  const scopeStr =
    typeof b['scope'] === 'string' ? b['scope'] : [...SUPPORTED_SCOPES].join(' ');
  const scopes = scopeStr.split(/\s+/).filter(Boolean);
  for (const s of scopes) {
    if (!SUPPORTED_SCOPES.has(s)) {
      return {
        error: 'invalid_client_metadata',
        error_description: `Unsupported scope: ${s}.`,
      };
    }
  }

  return {
    redirect_uris: uris as string[],
    client_name: name,
    token_endpoint_auth_method: authMethod,
    grant_types: grants as string[],
    response_types: responses as string[],
    scope: scopes.join(' '),
  };
}

function checkRedirectUri(uri: string): ValidationError | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return {
      error: 'invalid_redirect_uri',
      error_description: `Invalid URL: ${uri}.`,
    };
  }
  if (url.hash) {
    return {
      error: 'invalid_redirect_uri',
      error_description: `Redirect URI must not contain a fragment: ${uri}.`,
    };
  }
  const isLocal =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    return {
      error: 'invalid_redirect_uri',
      error_description: `Redirect URI must be https (or http://localhost for dev): ${uri}.`,
    };
  }
  return null;
}
