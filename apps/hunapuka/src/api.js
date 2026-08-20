import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
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

export async function saveSharedEmails(emails) {
  await setDoc(sharingDoc(), { emails }, { merge: true });
}

// createdAt may be an epoch number (written by this client) or a Firestore
// Timestamp (if ever written server-side). Missing on items predating the field.
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return null;
}

export async function fetchItems() {
  const snapshot = await getDocs(itemsCol());
  return snapshot.docs.map(d => {
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
  });
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
