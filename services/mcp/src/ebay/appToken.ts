import { config } from '../config.js';
import { getSecret } from '../secrets.js';

const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const EXPIRY_BUFFER_MS = 60_000;

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;
let inFlight: Promise<string> | null = null;

export class EbayCredsMissingError extends Error {
  constructor(which: string) {
    super(`eBay credentials missing: ${which}`);
    this.name = 'EbayCredsMissingError';
  }
}

async function loadClientSecret(): Promise<string> {
  if (config.ebay.clientSecretInline) return config.ebay.clientSecretInline;
  if (!config.gcpProject) {
    throw new EbayCredsMissingError(
      'EBAY_CLIENT_SECRET (inline) or GCP_PROJECT for Secret Manager',
    );
  }
  return getSecret(config.ebay.clientSecretName, config.gcpProject);
}

async function fetchAppToken(): Promise<string> {
  if (!config.ebay.clientId) throw new EbayCredsMissingError('EBAY_CLIENT_ID');
  const clientSecret = await loadClientSecret();
  const basic = Buffer.from(
    `${config.ebay.clientId}:${clientSecret}`,
  ).toString('base64');

  const res = await fetch(config.ebay.oauthUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: APP_SCOPE,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`eBay app token failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.expires_in) {
    throw new Error('eBay app token response missing fields.');
  }
  cachedToken = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + json.expires_in * 1000 - EXPIRY_BUFFER_MS,
  };
  return json.access_token;
}

export async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > Date.now()) {
    return cachedToken.accessToken;
  }
  if (inFlight) return inFlight;
  inFlight = fetchAppToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
