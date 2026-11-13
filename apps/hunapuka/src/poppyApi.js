// Calls to the Personal Agent Protocol ("Poppy") endpoints that Firebase
// Hosting routes to the `poppy` Cloud Function on this same origin. These are
// the browser-facing ones: the consent page and the connected-agents list.
import { auth } from './firebase';

async function post(path, body, { signedIn = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (signedIn) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  const resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data) {
    throw new Error((data && data.error_description) || `Request failed (${resp.status})`);
  }
  return data;
}

// Resolves to { client, scopes, access_days } when the request can be shown,
// { redirect } when it must be sent back to the agent with an error, or
// { error } when it cannot be trusted enough to send anywhere.
export function describeAgentRequest(request) {
  return post('/oauth/request', request);
}

// Approving sends the signed-in user's ID token and the scope names they
// ticked; declining needs no account.
export function decideAgentRequest(request, approve, scopes = []) {
  return post('/oauth/decision', { request, approve, scopes }, { signedIn: approve });
}

export async function fetchConnectedAgents() {
  const resp = await fetch('/oauth/connections', {
    headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data) throw new Error(`Request failed (${resp.status})`);
  return data.connections;
}

export function disconnectAgent(id) {
  return post('/oauth/connections/revoke', { id }, { signedIn: true });
}
