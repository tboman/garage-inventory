import { getDb, FieldValue } from './firestore.js';
import { generateClientId, generateClientSecret } from './util/ids.js';
import { hashSecret } from './util/secretHash.js';

export interface ClientRecord {
  client_id: string;
  client_secret_hash: string | null;
  redirect_uris: string[];
  client_name: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  scope: string;
}

export interface NewClientInput {
  redirect_uris: string[];
  client_name: string;
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  scope: string;
}

export interface CreatedClient extends ClientRecord {
  client_secret: string | null;
  client_id_issued_at: number;
}

export async function createClient(
  input: NewClientInput,
): Promise<CreatedClient> {
  const isConfidential = input.token_endpoint_auth_method !== 'none';
  const client_id = generateClientId();
  const client_secret = isConfidential ? generateClientSecret() : null;
  const client_secret_hash = client_secret ? hashSecret(client_secret) : null;
  const client_id_issued_at = Math.floor(Date.now() / 1000);

  const record: ClientRecord = {
    client_id,
    client_secret_hash,
    redirect_uris: input.redirect_uris,
    client_name: input.client_name,
    token_endpoint_auth_method: input.token_endpoint_auth_method,
    grant_types: input.grant_types,
    response_types: input.response_types,
    scope: input.scope,
  };

  await getDb()
    .collection('mcp_clients')
    .doc(client_id)
    .set({ ...record, created_at: FieldValue.serverTimestamp() });

  return { ...record, client_secret, client_id_issued_at };
}
