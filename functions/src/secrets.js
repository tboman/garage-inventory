const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

let client;
const cache = new Map();

function getClient() {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

async function getSecret(name, version = "latest") {
  const cacheKey = `${name}@${version}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("Cannot resolve GCP project ID from environment.");
  }

  const [res] = await getClient().accessSecretVersion({
    name: `projects/${projectId}/secrets/${name}/versions/${version}`,
  });
  const value = res.payload.data.toString("utf8");
  cache.set(cacheKey, value);
  return value;
}

exports.getSecret = getSecret;
