const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const BUCKET_NAME = "hunapuka-34ce6.firebasestorage.app";

exports.deleteListingPhotos = onDocumentDeleted("listings/{listingId}", async (event) => {
  const listingId = event.params.listingId;
  const bucket = admin.storage().bucket(BUCKET_NAME);
  const prefix = `listings/${listingId}/`;

  try {
    const [files] = await bucket.getFiles({ prefix });

    if (files.length === 0) {
      console.log(`No photos found for listing ${listingId}.`);
      return;
    }

    await Promise.all(files.map((file) => file.delete()));
    console.log(`Deleted ${files.length} photo(s) for listing ${listingId}.`);
  } catch (err) {
    console.error(`Error deleting photos for listing ${listingId}:`, err);
  }
});
