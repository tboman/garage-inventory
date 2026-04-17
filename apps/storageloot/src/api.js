import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { db, storage } from './firebase';

const listingsRef = collection(db, 'listings');
const groupsRef = collection(db, 'groups');

function generateKeywords(title) {
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
    sourceItemId: data.sourceItemId || null,
    groupId: data.groupId || null,
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
  const snap = await getDoc(doc(db, 'listings', id));
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
  await updateDoc(doc(db, 'listings', id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteListing(id) {
  // Delete photos from storage
  try {
    const listRef = ref(storage, `listings/${id}`);
    const res = await listAll(listRef);
    await Promise.all(res.items.map(item => deleteObject(item)));
  } catch (e) {
    // Photos may not exist, that's ok
  }
  await deleteDoc(doc(db, 'listings', id));
}

export async function uploadListingPhoto(listingId, file) {
  const filename = `${Date.now()}_${file.name}`;
  const storageRef = ref(storage, `listings/${listingId}/${filename}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function createGroup(data, user) {
  const group = {
    ownerId: user.uid,
    ownerDisplayName: user.displayName || 'Anonymous',
    name: data.name,
    type: data.type,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const docRef = await addDoc(groupsRef, group);
  return docRef.id;
}

export async function getGroup(id) {
  const snap = await getDoc(doc(db, 'groups', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getGroups({ pageSize = 20, lastDoc } = {}) {
  const constraints = [orderBy('createdAt', 'desc'), limit(pageSize)];
  if (lastDoc) constraints.push(startAfter(lastDoc));
  const q = query(groupsRef, ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getMyGroups(userId) {
  const q = query(groupsRef, where('ownerId', '==', userId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getListingsByGroup(groupId) {
  const q = query(listingsRef, where('groupId', '==', groupId), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateGroup(id, data) {
  await updateDoc(doc(db, 'groups', id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteGroup(id) {
  await deleteDoc(doc(db, 'groups', id));
}
