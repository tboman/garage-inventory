import { ref, uploadBytes, getDownloadURL, listAll, getMetadata, deleteObject } from 'firebase/storage';
import { collection, addDoc, query, where, getDocs, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { storage, auth, db } from '../firebase';
import type { UploadedFile } from '../components/PhotoUploader';

/**
 * Uploads a file to Firebase Storage under photos/{uid}/{localId}.
 * Stores the original filename in custom metadata so it can be recovered on reload.
 */
export async function uploadToStorage(
  file: File,
  localId: string
): Promise<{ storagePath: string; url: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to upload');

  const storagePath = `photos/${user.uid}/${localId}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: { originalName: file.name },
  });
  const url = await getDownloadURL(storageRef);

  // Publish to Firestore so the landing page can display it
  await addDoc(collection(db, 'listings'), {
    url,
    storagePath,
    name: file.name,
    userId: user.uid,
    uploadedAt: serverTimestamp(),
  });

  return { storagePath, url };
}

/**
 * Lists all photos previously uploaded by the current user and returns them
 * as UploadedFile objects ready to populate the gallery.
 */
export async function loadUserFiles(uid: string): Promise<UploadedFile[]> {
  const listRef = ref(storage, `photos/${uid}`);
  const result = await listAll(listRef);

  const files = await Promise.all(
    result.items.map(async (item) => {
      const [url, meta] = await Promise.all([
        getDownloadURL(item),
        getMetadata(item),
      ]);
      return {
        id: item.name,
        name: meta.customMetadata?.originalName ?? item.name,
        url,
        storagePath: item.fullPath,
        uploadState: 'done' as const,
      };
    })
  );

  return files;
}

/** Deletes a file from Firebase Storage and its listing from Firestore. */
export async function deleteFromStorage(storagePath: string): Promise<void> {
  await deleteObject(ref(storage, storagePath));

  // Remove the listing doc
  const snap = await getDocs(
    query(collection(db, 'listings'), where('storagePath', '==', storagePath))
  );
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
