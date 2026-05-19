import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { db, storage } from './firebase';

const listingsRef = collection(db, 'nursery_listings');
const groupsRef = collection(db, 'nursery_groups');

export function generateKeywords(title) {
  return title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
}

export async function createListing(data, user) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const listing = {
    sellerId: user.uid,
    sellerDisplayName: user.displayName || 'Anonymous',
    title: data.title,
    description: data.description,
    price: data.price,
    currency: data.currency || 'USD',
    condition: data.condition,
    category: data.category,
    photos: data.photos || [],
    externalLinks: data.externalLinks || [],
    status: 'active',
    titleLower: data.title.toLowerCase(),
    keywords: generateKeywords(data.title),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  };

  const docRef = await addDoc(listingsRef, listing);
  return docRef.id;
}

export async function getListing(id) {
  const snap = await getDoc(doc(db, 'nursery_listings', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getListings({ status = 'active', category, searchKeyword, lastDoc, pageSize = 20 } = {}) {
  const constraints = [where('status', '==', status)];

  if (category && category !== 'all') {
    constraints.push(where('category', '==', category));
  }

  if (searchKeyword) {
    constraints.push(where('keywords', 'array-contains', searchKeyword.toLowerCase()));
  }

  constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(limit(pageSize));

  if (lastDoc) {
    constraints.push(startAfter(lastDoc));
  }

  const q = query(listingsRef, ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getMyListings(userId) {
  const q = query(listingsRef, where('sellerId', '==', userId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateListing(id, data) {
  await updateDoc(doc(db, 'nursery_listings', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteListing(id) {
  try {
    const listRef = ref(storage, `nursery_listings/${id}`);
    const res = await listAll(listRef);
    await Promise.all(res.items.map(item => deleteObject(item)));
  } catch (e) {}
  await deleteDoc(doc(db, 'nursery_listings', id));
}

export async function uploadListingPhoto(listingId, file) {
  const filename = `${Date.now()}_${file.name}`;
  const storageRef = ref(storage, `nursery_listings/${listingId}/${filename}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

function storagePathFromUrl(url) {
  const gcs = url.match(/^https:\/\/storage\.googleapis\.com\/[^/]+\/(.+?)(\?.*)?$/);
  if (gcs) return decodeURIComponent(gcs[1]);
  const fb = url.match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/);
  if (fb) return decodeURIComponent(fb[1]);
  return null;
}

export async function deleteListingPhotoFromStorage(photoUrl) {
  const path = storagePathFromUrl(photoUrl);
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (e) {}
}

export async function removeListingPhoto(listingId, photoUrl, remainingPhotos) {
  await updateDoc(doc(db, 'nursery_listings', listingId), {
    photos: remainingPhotos,
    updatedAt: serverTimestamp(),
  });
  const path = storagePathFromUrl(photoUrl);
  if (path) {
    try {
      await deleteObject(ref(storage, path));
    } catch (e) {}
  }
}
