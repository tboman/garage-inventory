const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

exports.cleanupExpired = onSchedule("every 24 hours", async () => {
  const db = admin.firestore();
  const now = new Date();

  const snapshot = await db
    .collection("listings")
    .where("status", "==", "active")
    .where("expiresAt", "<", now)
    .get();

  if (snapshot.empty) {
    console.log("No expired listings found.");
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, {
      status: "expired",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  console.log(`Marked ${snapshot.size} listing(s) as expired.`);
});
