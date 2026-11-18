// Buyer–seller conversations and marketplace placeholders. Every write here is
// checked by firestore.rules; the field limits below mirror those rules and
// functions/src/messages.js (which agents' messages go through).
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot,
  writeBatch, updateDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestUid } from './guestApi';

export const TEXT_MAX = 2000;
const PREVIEW_MAX = 140;

export const REQUEST_PLATFORMS = ['ebay', 'craigslist'];
export const MARKETPLACES = {
  ebay: 'eBay',
  nextdoor: 'Nextdoor',
  facebook: 'Facebook Marketplace',
  craigslist: 'Craigslist',
};
export const MARKETPLACE_STATUSES = {
  requested: 'Requested by a buyer',
  planned: 'Planned',
  in_progress: 'In progress',
  listed: 'Listed',
  ended: 'Ended',
};

export const conversationId = (listingId, buyerUid) => `${listingId}_${buyerUid}`;

export function formatCents(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function previewOf(message) {
  let line = message.text || '';
  if (message.kind === 'offer') {
    line = `Offer: ${formatCents(message.offerAmount, message.currency)}` + (message.text ? ` · ${message.text}` : '');
  } else if (message.kind === 'listing_request') {
    line = `Asked to list it on ${MARKETPLACES[message.platform]}` + (message.text ? ` · ${message.text}` : '');
  }
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line;
}

const conversationRef = (id) => doc(db, 'conversations', id);
const messagesRef = (id) => collection(db, 'conversations', id, 'messages');

// The buyer's conversation about a listing, or null if they have not written yet.
export async function getMyConversation(listingId, buyerUid) {
  const snap = await getDoc(conversationRef(conversationId(listingId, buyerUid)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Fields one message adds, by kind. `draft` is { kind, text, offerAmount, platform }.
function messageFields(user, role, draft) {
  const fields = {
    senderId: user.uid,
    senderRole: role,
    kind: draft.kind,
    text: (draft.text || '').trim().slice(0, TEXT_MAX),
    createdAt: serverTimestamp(),
  };
  if (draft.kind === 'offer') {
    fields.offerAmount = draft.offerAmount;
    fields.currency = draft.currency || 'USD';
    fields.offerStatus = 'pending';
  }
  if (draft.kind === 'listing_request') fields.platform = draft.platform;
  return fields;
}

// A buyer writes about a listing: starts the conversation with this message,
// or adds the message to the one they already have. Returns the conversation id.
// A guest is named `guestName` (or "Guest"), and the conversation is marked
// as a guest's, which the rules require.
export async function sendToSeller(listing, user, draft, { guestName } = {}) {
  const guest = isGuestUid(user.uid);
  const id = conversationId(listing.id, user.uid);
  const msg = messageFields(user, 'buyer', draft);
  const preview = previewOf(msg);
  const batch = writeBatch(db);
  const existing = await getDoc(conversationRef(id));
  if (existing.exists()) {
    batch.update(conversationRef(id), {
      lastMessageAt: serverTimestamp(),
      lastMessageText: preview,
      lastSenderId: user.uid,
    });
  } else {
    batch.set(conversationRef(id), {
      listingId: listing.id,
      listingTitle: (listing.title || '').slice(0, 120),
      listingPhoto: listing.photos?.[0] || null,
      sellerId: listing.sellerId,
      sellerDisplayName: (listing.sellerDisplayName || 'Seller').slice(0, 100),
      buyerId: user.uid,
      buyerDisplayName: (guest ? (guestName || '').trim() || 'Guest' : user.displayName || 'Buyer').slice(0, 100),
      ...(guest ? { buyerGuest: true } : {}),
      participants: [listing.sellerId, user.uid],
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: preview,
      lastSenderId: user.uid,
      sellerReadAt: null,
      buyerReadAt: serverTimestamp(),
    });
  }
  batch.set(doc(messagesRef(id)), msg);
  await batch.commit();
  return id;
}

// A reply from either side of an existing conversation.
export async function sendReply(conversation, user, text) {
  const role = user.uid === conversation.sellerId ? 'seller' : 'buyer';
  const msg = messageFields(user, role, { kind: 'reply', text });
  const readField = role === 'seller' ? 'sellerReadAt' : 'buyerReadAt';
  const batch = writeBatch(db);
  batch.set(doc(messagesRef(conversation.id)), msg);
  batch.update(conversationRef(conversation.id), {
    lastMessageAt: serverTimestamp(),
    lastMessageText: previewOf(msg),
    lastSenderId: user.uid,
    [readField]: serverTimestamp(),
  });
  await batch.commit();
}

export function markRead(conversation, user) {
  const field = user.uid === conversation.sellerId ? 'sellerReadAt' : 'buyerReadAt';
  return updateDoc(conversationRef(conversation.id), { [field]: serverTimestamp() });
}

export function respondToOffer(conversationIdValue, messageId, accepted) {
  return updateDoc(doc(db, 'conversations', conversationIdValue, 'messages', messageId), {
    offerStatus: accepted ? 'accepted' : 'declined',
    respondedAt: serverTimestamp(),
  });
}

const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

// Whether the other side has written since this person last looked.
export function isUnread(conversation, uid) {
  if (!conversation.lastSenderId || conversation.lastSenderId === uid) return false;
  const readAt = uid === conversation.sellerId ? conversation.sellerReadAt : conversation.buyerReadAt;
  return millis(conversation.lastMessageAt) > millis(readAt);
}

// Live list of every conversation this person is part of, newest first.
export function subscribeConversations(uid, onChange, onError) {
  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', uid),
    orderBy('lastMessageAt', 'desc'),
  );
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function subscribeConversation(id, onChange, onError) {
  return onSnapshot(
    conversationRef(id),
    (snap) => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  );
}

export function subscribeMessages(id, onChange, onError) {
  const q = query(messagesRef(id), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

// ---- Marketplace placeholders (seller only) ---------------------------------

export async function getMarketplaces(listingId) {
  const snap = await getDocs(collection(db, 'listings', listingId, 'marketplaces'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
}

// `fields` is { status, url, notes }. Request counts are kept by the server.
export async function saveMarketplace(listingId, platform, fields, exists) {
  const data = {
    status: fields.status,
    url: fields.url ? fields.url.trim() : null,
    notes: fields.notes ? fields.notes.trim().slice(0, 500) : null,
    updatedAt: serverTimestamp(),
  };
  const ref = doc(db, 'listings', listingId, 'marketplaces', platform);
  if (exists) await updateDoc(ref, data);
  else await setDoc(ref, data);
}
