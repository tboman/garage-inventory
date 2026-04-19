const AUTHORIZE_URL = 'https://auth.ebay.com/oauth2/authorize';
const STATE_KEY = 'ebay_oauth_state';
const RETURN_KEY = 'ebay_oauth_return';

export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
];

export const REQUIRED_LISTINGS_SCOPE =
  'https://api.ebay.com/oauth/api_scope/sell.inventory';

function randomState() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function startEbayLogin(extraScopes = [], returnTo = null) {
  const clientId = process.env.REACT_APP_EBAY_CLIENT_ID;
  const runame = process.env.REACT_APP_EBAY_RUNAME;
  if (!clientId || !runame) {
    throw new Error('Missing REACT_APP_EBAY_CLIENT_ID or REACT_APP_EBAY_RUNAME.');
  }

  const state = randomState();
  sessionStorage.setItem(STATE_KEY, state);
  if (returnTo) {
    sessionStorage.setItem(RETURN_KEY, returnTo);
  } else {
    sessionStorage.removeItem(RETURN_KEY);
  }

  const scopes = Array.from(new Set([...EBAY_SCOPES, ...extraScopes]));

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', runame);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);

  window.location.href = url.toString();
}

export function consumeEbayState(returnedState) {
  const saved = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return Boolean(saved) && saved === returnedState;
}

export function consumeEbayReturnTo() {
  const returnTo = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return returnTo;
}

export function hasScope(integration, scope) {
  if (!integration?.scopes) return false;
  const granted = Array.isArray(integration.scopes)
    ? integration.scopes
    : String(integration.scopes).split(/\s+/);
  return granted.includes(scope);
}
