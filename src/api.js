import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc } from 'firebase/firestore';
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

export async function fetchItems() {
  const snapshot = await getDocs(itemsCol());
  return snapshot.docs.map(d => ({
    id: d.id,
    ...d.data(),
    locationId: d.data().locationId ?? null,
    order: d.data().order ?? 0,
    photos: d.data().photos || [],
  }));
}

export async function createItem(newItem) {
  const { id: _ignored, ...data } = newItem;
  const docRef = await addDoc(itemsCol(), data);
  return { id: docRef.id, ...data };
}

export async function updateItem(id, fields) {
  await updateDoc(itemDoc(id), fields);
}

export async function moveItem(id, locationId, order) {
  await updateDoc(itemDoc(id), { locationId, order });
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
