import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db, storage } from './firebase';

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
      try {
        const fileRef = ref(storage, url);
        await deleteObject(fileRef);
      } catch (e) {
        // Photo may already be deleted; continue
      }
    }
  }
  await deleteDoc(itemDoc(id));
}

export async function uploadPhoto(file) {
  const uid = getUid();
  const filePath = `users/${uid}/photos/${Date.now()}-${file.name}`;
  const fileRef = ref(storage, filePath);
  await uploadBytes(fileRef, file);
  const downloadURL = await getDownloadURL(fileRef);
  return { path: downloadURL };
}

export async function addPhotoToItem(itemId, _currentPhotos, photoPath) {
  await updateDoc(itemDoc(itemId), { photos: arrayUnion(photoPath) });
}

export async function removePhotoFromItem(itemId, _currentPhotos, photoPath) {
  await updateDoc(itemDoc(itemId), { photos: arrayRemove(photoPath) });
  try {
    const fileRef = ref(storage, photoPath);
    await deleteObject(fileRef);
  } catch (e) {
    // Photo may already be deleted
  }
}
