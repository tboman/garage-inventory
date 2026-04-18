import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

let client: SecretManagerServiceClient | null = null;
const cache = new Map<string, string>();

function getClient(): SecretManagerServiceClient {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

export async function getSecret(
  name: string,
  project: string,
  version = 'latest',
): Promise<string> {
  const cacheKey = `${project}/${name}@${version}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [res] = await getClient().accessSecretVersion({
    name: `projects/${project}/secrets/${name}/versions/${version}`,
  });
  const data = res.payload?.data;
  if (!data) throw new Error(`Secret ${name} has no payload.`);
  const value =
    typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
  cache.set(cacheKey, value);
  return value;
}
