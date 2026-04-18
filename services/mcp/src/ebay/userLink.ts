import { getDb } from '../firestore.js';

export interface EbayLink {
  userId: string;
  username: string;
}

export async function getEbayLink(uid: string): Promise<EbayLink | null> {
  const snap = await getDb()
    .collection('users')
    .doc(uid)
    .collection('integrations')
    .doc('ebay')
    .get();
  if (!snap.exists) return null;
  const data = snap.data() as { userId?: string; username?: string };
  if (!data.userId || !data.username) return null;
  return { userId: data.userId, username: data.username };
}
