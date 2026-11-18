// StorageLoot guests sign in to Firebase with custom tokens (see
// src/poppy/storageloot.js). They may write to sellers and nothing else, so
// every callable that acts on a person's account turns them away. Nothing
// else in this project signs in with a custom token.

const { HttpsError } = require("firebase-functions/v2/https");

const isGuest = (auth) =>
  Boolean(auth && auth.token && auth.token.firebase && auth.token.firebase.sign_in_provider === "custom");

// Throws for a guest; call after the usual signed-in check.
function refuseGuests(auth) {
  if (isGuest(auth)) {
    throw new HttpsError("permission-denied", "Sign in with Google to do this. Guests can only write to sellers.");
  }
}

module.exports = { isGuest, refuseGuests };
