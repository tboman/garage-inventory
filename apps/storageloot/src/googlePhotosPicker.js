import { getGoogleAccessToken, clearGoogleToken } from './googleToken';

const BASE = 'https://photospicker.googleapis.com/v1';

function parseDurationSeconds(s, fallback) {
  if (!s) return fallback;
  const m = String(s).match(/([\d.]+)\s*s/);
  return m ? Number(m[1]) : fallback;
}

async function authedFetch(url, options = {}, retried = false) {
  const token = await getGoogleAccessToken();
  if (!token) throw new Error('Not signed in with Google.');
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if ((res.status === 401 || res.status === 403) && !retried) {
    clearGoogleToken();
    return authedFetch(url, options, true);
  }
  return res;
}

async function createSession() {
  const res = await authedFetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start Google Photos picker: ${res.status} ${text}`);
  }
  return res.json();
}

async function getSession(sessionId) {
  const res = await authedFetch(`${BASE}/sessions/${sessionId}`);
  if (!res.ok) throw new Error(`Picker session lookup failed: ${res.status}`);
  return res.json();
}

async function deleteSession(sessionId) {
  try {
    await authedFetch(`${BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  } catch {
    // Best-effort
  }
}

async function listMediaItems(sessionId) {
  const items = [];
  let pageToken = '';
  for (;;) {
    const url = `${BASE}/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await authedFetch(url);
    if (!res.ok) throw new Error(`Failed to list picked items: ${res.status}`);
    const data = await res.json();
    if (data.mediaItems) items.push(...data.mediaItems);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

async function downloadMediaItem(item) {
  const baseUrl = item?.mediaFile?.baseUrl;
  if (!baseUrl) throw new Error('Picked item is missing a downloadable URL.');
  const res = await authedFetch(`${baseUrl}=d`);
  if (!res.ok) throw new Error(`Failed to download picked photo: ${res.status}`);
  const blob = await res.blob();
  const filename = item.mediaFile.filename || `google_photo_${item.id}.jpg`;
  const mime = item.mediaFile.mimeType || blob.type || 'image/jpeg';
  return new File([blob], filename, { type: mime });
}

export async function pickGooglePhotos({ onSession, signal } = {}) {
  const session = await createSession();
  onSession?.(session);

  const popup = window.open(session.pickerUri, '_blank');
  if (!popup) {
    await deleteSession(session.id);
    throw new Error('Popup blocked. Please allow popups for this site and try again.');
  }

  const pollMs = Math.max(1000, parseDurationSeconds(session.pollingConfig?.pollInterval, 5) * 1000);
  const timeoutMs = Math.max(60000, parseDurationSeconds(session.pollingConfig?.timeoutIn, 600) * 1000);
  const start = Date.now();

  let current = session;
  while (!current.mediaItemsSet) {
    if (signal?.aborted) {
      await deleteSession(session.id);
      throw new Error('Cancelled.');
    }
    if (Date.now() - start > timeoutMs) {
      await deleteSession(session.id);
      throw new Error('Picker timed out.');
    }
    await new Promise(r => setTimeout(r, pollMs));
    try {
      current = await getSession(session.id);
    } catch (e) {
      // transient errors: continue polling
    }
  }

  const items = await listMediaItems(session.id);
  const files = [];
  for (const item of items) {
    if (item?.type && item.type !== 'PHOTO') continue;
    files.push(await downloadMediaItem(item));
  }
  await deleteSession(session.id);
  return files;
}
