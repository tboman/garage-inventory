import { getGoogleAccessToken } from './googleToken';

const FOLDER_NAME = 'HunaPuka';
const FOLDER_ID_KEY = 'hunapuka_folder_id';

async function driveFetch(url, options = {}) {
  const token = await getGoogleAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text}`);
  }
  return res;
}

export async function getOrCreateAppFolder() {
  const cached = sessionStorage.getItem(FOLDER_ID_KEY);
  if (cached) return cached;

  // Search for existing folder
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );
  const { files } = await searchRes.json();

  if (files.length > 0) {
    sessionStorage.setItem(FOLDER_ID_KEY, files[0].id);
    return files[0].id;
  }

  // Create folder
  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const folder = await createRes.json();
  sessionStorage.setItem(FOLDER_ID_KEY, folder.id);
  return folder.id;
}

export async function uploadFileToDrive(file) {
  const folderId = await getOrCreateAppFolder();
  const token = await getGoogleAccessToken();

  const metadata = {
    name: `${Date.now()}-${file.name}`,
    parents: [folderId],
  };

  // Multipart upload
  const boundary = 'hunapuka_boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${file.type}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n`;

  const fileData = await file.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(fileData).reduce((data, byte) => data + String.fromCharCode(byte), '')
  );

  const fullBody = body + base64 + `\r\n--${boundary}--`;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: fullBody,
    }
  );

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Drive upload ${uploadRes.status}: ${text}`);
  }

  const { id: fileId } = await uploadRes.json();

  const viewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
  return { fileId, viewUrl };
}

export async function deleteFileFromDrive(fileId) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
  });
}

export function extractFileIdFromUrl(url) {
  // Match uc URL: https://drive.google.com/uc?export=view&id=FILE_ID
  const ucMatch = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
  if (ucMatch) return ucMatch[1];
  // Match lh3 URL: https://lh3.googleusercontent.com/d/FILE_ID...
  const lh3Match = url.match(/lh3\.googleusercontent\.com\/d\/([^=/?]+)/);
  if (lh3Match) return lh3Match[1];
  // Match thumbnail URL: https://drive.google.com/thumbnail?id=FILE_ID&sz=...
  const thumbMatch = url.match(/drive\.google\.com\/thumbnail\?id=([^&]+)/);
  return thumbMatch ? thumbMatch[1] : null;
}
