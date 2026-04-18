import { getDb } from '../src/firestore.js';
import { config } from '../src/config.js';
import { getSecret } from '../src/secrets.js';

const UID = process.argv[2] ?? 'CCRuOvYHYLeek4k9UGbeSJVZf3F2';

async function main() {
  const db = getDb();
  const snap = await db.doc(`users/${UID}/integration_tokens/ebay`).get();
  const data = snap.data() as { refreshToken?: string } | undefined;
  if (!data?.refreshToken) throw new Error('No refresh token stored.');

  const clientId = config.ebay.clientId;
  if (!clientId) throw new Error('EBAY_CLIENT_ID required.');
  const clientSecret = config.ebay.clientSecretInline
    ?? (await getSecret(config.ebay.clientSecretName, config.gcpProject!));
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokRes = await fetch(config.ebay.oauthUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.refreshToken,
    }),
  });
  console.log('refresh status:', tokRes.status);
  const tokJson = (await tokRes.json()) as { access_token?: string; error_description?: string };
  if (!tokJson.access_token) {
    console.error('refresh failed:', tokJson);
    process.exit(1);
  }

  const idRes = await fetch(
    'https://apiz.ebay.com/commerce/identity/v1/user/',
    { headers: { Authorization: `Bearer ${tokJson.access_token}` } },
  );
  console.log('identity status:', idRes.status);
  console.log(await idRes.text());
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
