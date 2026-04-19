import 'dotenv/config';

const ebayEnv = (process.env['EBAY_ENV'] || 'production').toLowerCase();
if (ebayEnv !== 'production' && ebayEnv !== 'sandbox') {
  throw new Error(`EBAY_ENV must be 'production' or 'sandbox' (got '${ebayEnv}').`);
}

const ebayBases =
  ebayEnv === 'sandbox'
    ? {
        oauth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
        api: 'https://api.sandbox.ebay.com',
      }
    : {
        oauth: 'https://api.ebay.com/identity/v1/oauth2/token',
        api: 'https://api.ebay.com',
      };

export const config = {
  port: Number(process.env.PORT) || 8080,
  gcpProject: process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
  jwtPrivateJwkInline: process.env.MCP_JWT_PRIVATE_JWK,
  jwtPrivateJwkSecretName:
    process.env.MCP_JWT_PRIVATE_JWK_SECRET || 'MCP_JWT_PRIVATE_JWK',
  ebay: {
    env: ebayEnv as 'production' | 'sandbox',
    clientId: process.env['EBAY_CLIENT_ID'] || null,
    clientSecretInline: process.env['EBAY_CLIENT_SECRET'],
    clientSecretName:
      process.env['EBAY_CLIENT_SECRET_NAME'] || 'EBAY_CLIENT_SECRET',
    oauthUrl: ebayBases.oauth,
    apiBase: ebayBases.api,
  },
};
