import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, writeBatch } from 'firebase/firestore';
import { arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db } from './firebase';
import { uploadFileToDrive, deleteFileFromDrive, extractFileIdFromUrl } from './driveApi';

function getUid() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.uid;
}

function itemsCol() {
  return collection(db, 'users', getUid(), 'items');
}

function itemDoc(id) {
  return doc(db, 'users', getUid(), 'items', id);
}

// Who this inventory is shared with, by email. Firestore rules match these
// against request.auth.token.email; a Firebase uid would be unusable here
// because nobody can look up another person's uid.
function sharingDoc() {
  return doc(db, 'users', getUid(), 'sharing', 'config');
}

export async function fetchSharedEmails() {
  const snap = await getDoc(sharingDoc());
  if (!snap.exists()) return [];
  const emails = snap.data().emails;
  return Array.isArray(emails) ? emails : [];
}

// A viewer cannot search other people's share lists, so each share also writes
// a reverse-index entry the recipient can read under their own address. The two
// go in one batch: if they could drift, a share would exist that its recipient
// can never discover, or an entry pointing at access that was revoked.
const SHARE_INDEX_VERSION = 1;

function shareIndexDoc(email, ownerUid) {
  return doc(db, 'share_index', email, 'owners', ownerUid);
}

// Shares made before the reverse index existed have no entry, so their
// recipients would never discover them. Backfill those once, tracked by a
// version marker, since an owner cannot read the index to tell what is missing.
export async function ensureShareIndex() {
  const snap = await getDoc(sharingDoc());
  const data = snap.exists() ? snap.data() : {};
  const emails = Array.isArray(data.emails) ? data.emails : [];
  if (data.indexVersion === SHARE_INDEX_VERSION || emails.length === 0) return emails;

  const uid = getUid();
  const batch = writeBatch(db);
  for (const email of emails) {
    batch.set(shareIndexDoc(email, uid), ownerStamp());
  }
  batch.set(sharingDoc(), { indexVersion: SHARE_INDEX_VERSION }, { merge: true });
  await batch.commit();
  return emails;
}

function ownerStamp() {
  const user = auth.currentUser;
  return {
    ownerEmail: (user?.email || '').toLowerCase(),
    ownerName: user?.displayName || '',
    sharedAt: Date.now(),
  };
}

export async function addShare(email) {
  const uid = getUid();
  const current = await fetchSharedEmails();
  const next = current.includes(email) ? current : [...current, email];

  const batch = writeBatch(db);
  batch.set(sharingDoc(), { emails: next, indexVersion: SHARE_INDEX_VERSION }, { merge: true });
  batch.set(shareIndexDoc(email, uid), ownerStamp());
  await batch.commit();
  return next;
}

export async function removeShare(email) {
  const uid = getUid();
  const current = await fetchSharedEmails();
  const next = current.filter(e => e !== email);

  const batch = writeBatch(db);
  batch.set(sharingDoc(), { emails: next, indexVersion: SHARE_INDEX_VERSION }, { merge: true });
  batch.delete(shareIndexDoc(email, uid));
  await batch.commit();
  return next;
}

export async function fetchSharedWithMe() {
  const email = (auth.currentUser?.email || '').toLowerCase();
  if (!email) return [];
  const snapshot = await getDocs(collection(db, 'share_index', email, 'owners'));
  return snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// createdAt may be an epoch number (written by this client) or a Firestore
// Timestamp (if ever written server-side). Missing on items predating the field.
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return null;
}

function mapItemDoc(d) {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    locationId: data.locationId ?? null,
    order: data.order ?? 0,
    createdAt: toMillis(data.createdAt),
    // Fractions (0-1) of the parent container canvas; null means unplaced.
    x: typeof data.x === 'number' ? data.x : null,
    y: typeof data.y === 'number' ? data.y : null,
    photos: data.photos || [],
  };
}

// Reads someone else's inventory. Only works when they have shared with the
// signed-in account; the rules enforce that, and grant read only.
export async function fetchItemsFor(ownerUid) {
  const snapshot = await getDocs(collection(db, 'users', ownerUid, 'items'));
  return snapshot.docs.map(mapItemDoc);
}

export async function fetchItems() {
  return fetchItemsFor(getUid());
}

export async function createItem(newItem) {
  const { id: _ignored, ...rest } = newItem;
  const data = { ...rest, createdAt: Date.now() };
  const docRef = await addDoc(itemsCol(), data);
  return { id: docRef.id, ...data };
}

export async function updateItem(id, fields) {
  await updateDoc(itemDoc(id), fields);
}

export async function moveItem(id, locationId, order) {
  // Coordinates are relative to the old parent canvas, so reparenting voids them.
  await updateDoc(itemDoc(id), { locationId, order, x: null, y: null });
}

export async function placeItem(id, x, y) {
  await updateDoc(itemDoc(id), { x, y });
}

export async function unplaceItem(id) {
  await updateDoc(itemDoc(id), { x: null, y: null });
}

export async function deleteItem(id) {
  const snap = await getDoc(itemDoc(id));
  if (snap.exists()) {
    const photos = snap.data().photos || [];
    for (const url of photos) {
      const fileId = extractFileIdFromUrl(url);
      if (!fileId) continue; // Legacy Firebase Storage URL — skip
      try {
        await deleteFileFromDrive(fileId);
      } catch (e) {
        // File may already be deleted; continue
      }
    }
  }
  await deleteDoc(itemDoc(id));
}

export async function uploadPhoto(file) {
  const { viewUrl } = await uploadFileToDrive(file);
  return { path: viewUrl };
}

export async function addPhotoToItem(itemId, _currentPhotos, photoPath) {
  await updateDoc(itemDoc(itemId), { photos: arrayUnion(photoPath) });
}

export async function removePhotoFromItem(itemId, _currentPhotos, photoPath) {
  await updateDoc(itemDoc(itemId), { photos: arrayRemove(photoPath) });
  const fileId = extractFileIdFromUrl(photoPath);
  if (!fileId) return; // Legacy Firebase Storage URL — skip
  try {
    await deleteFileFromDrive(fileId);
  } catch (e) {
    // File may already be deleted
  }
}
