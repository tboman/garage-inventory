/**
 * Dev helper: print all StorageLoot users who have linked an eBay account.
 * Run with ADC (after `gcloud auth application-default login`).
 */
import { getDb } from '../src/firestore.js';

async function main() {
  const db = getDb();
  const snap = await db.collectionGroup('integrations').get();
  const linked = snap.docs.filter((d) => d.id === 'ebay');
  if (linked.length === 0) {
    console.log('No users with linked eBay accounts.');
    return;
  }
  console.log(`Found ${linked.length} linked user(s):`);
  for (const doc of linked) {
    const uid = doc.ref.parent.parent?.id;
    const data = doc.data() as { userId?: string; username?: string };
    console.log(`  uid=${uid}  username=${data.username}  userId=${data.userId}`);
  }
}

main().catch((err) => {
  console.error('LOOKUP FAILED:', err);
  process.exit(1);
});
