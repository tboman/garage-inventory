import { getDb } from '../firestore.js';

// Agent identities are minted from real owner uids. For data that lives only
// on the owner (e.g. StorageLoot listings, eBay link), map the calling uid to
// agent_owners/{uid}.owner_uid when present.
export async function resolveOwnerUid(uid: string): Promise<string> {
  const snap = await getDb().collection('agent_owners').doc(uid).get();
  if (!snap.exists) return uid;
  const ownerUid = (snap.data() as { owner_uid?: unknown })?.owner_uid;
  return typeof ownerUid === 'string' && ownerUid ? ownerUid : uid;
}
