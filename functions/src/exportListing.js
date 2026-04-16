const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const BUCKET_NAME = "hunapuka-34ce6.firebasestorage.app";

function extractFileIdFromUrl(url) {
  // Match uc URL: https://drive.google.com/uc?export=view&id=FILE_ID
  const ucMatch = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
  if (ucMatch) return ucMatch[1];
  // Match lh3 URL: https://lh3.googleusercontent.com/d/FILE_ID...
  const lh3Match = url.match(/lh3\.googleusercontent\.com\/d\/([^=/?]+)/);
  if (lh3Match) return lh3Match[1];
  // Match thumbnail URL: https://drive.google.com/thumbnail?id=FILE_ID&sz=...
  const thumbMatch = url.match(/drive\.google\.com\/thumbnail\?id=([^&]+)/);
  if (thumbMatch) return thumbMatch[1];
  // Fallback: ?id= or /d/ patterns
  let match = url.match(/[?&]id=([^&]+)/);
  if (match) return match[1];
  match = url.match(/\/d\/([^/?]+)/);
  if (match) return match[1];
  return null;
}

exports.exportListing = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to create a listing.");
  }

  const {
    title,
    description,
    price,
    currency = "USD",
    condition,
    category,
    externalLinks = [],
    drivePhotoUrls = [],
    accessToken,
    sourceItemId = null,
  } = request.data;

  if (!title || price == null) {
    throw new HttpsError("invalid-argument", "Title and price are required.");
  }

  if (!accessToken && drivePhotoUrls.length > 0) {
    throw new HttpsError("invalid-argument", "accessToken is required to download Drive photos.");
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket(BUCKET_NAME);

  // Create the listing doc first to get the ID
  const listingRef = db.collection("listings").doc();
  const listingId = listingRef.id;

  // Download photos from Drive and upload to Cloud Storage
  const photoUrls = [];
  for (let i = 0; i < drivePhotoUrls.length; i++) {
    const driveUrl = drivePhotoUrls[i];
    const fileId = extractFileIdFromUrl(driveUrl);
    if (!fileId) {
      console.warn(`Could not extract file ID from URL: ${driveUrl}`);
      continue;
    }

    try {
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const response = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        console.warn(`Failed to download Drive file ${fileId}: ${response.status}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const filePath = `listings/${listingId}/${i}.jpg`;
      const file = bucket.file(filePath);

      await file.save(buffer, {
        metadata: { contentType: "image/jpeg" },
      });

      await file.makePublic();

      const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filePath}`;
      photoUrls.push(publicUrl);
    } catch (err) {
      console.error(`Error processing photo ${i} (fileId: ${fileId}):`, err);
    }
  }

  // Create the Firestore listing document
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  await listingRef.set({
    sellerId: request.auth.uid,
    sellerDisplayName: request.auth.token.name || "Anonymous",
    title,
    description: description || "",
    price,
    currency,
    condition: condition || "",
    category: category || "",
    photos: photoUrls,
    externalLinks,
    status: "active",
    sourceItemId,
    titleLower: title.toLowerCase(),
    keywords: title.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  });

  return { listingId, success: true };
});
