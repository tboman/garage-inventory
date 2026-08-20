import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

const TOKEN_KEY = 'google_access_token';
const EXPIRY_KEY = 'google_token_expiry';

// Every DriveImage asks for a token independently, so a view holding many
// photos would otherwise fire one signInWithPopup per image at the same instant.
// Firebase services a single popup and rejects the rest with
// "INTERNAL ASSERTION FAILED: Pending promise was never set", and the browser
// blocks the extra windows. Concurrent callers share this one in-flight promise.
let pendingSignIn = null;

// Components watch the token so a reconnect can retry every image at once.
const listeners = new Set();

export function subscribeGoogleToken(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach(fn => fn());
}

export function storeGoogleToken(credential) {
  if (!credential || !credential.accessToken) return;
  const token = credential.accessToken;
  // Google OAuth tokens are valid for ~1 hour; store expiry with 5-min buffer
  const expiry = Date.now() + 55 * 60 * 1000;
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EXPIRY_KEY, String(expiry));
  notify();
}

export function clearGoogleToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
  sessionStorage.removeItem('hunapuka_folder_id');
  notify();
}

export function getCachedGoogleToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
  return token && Date.now() < expiry ? token : null;
}

export function hasValidGoogleToken() {
  return getCachedGoogleToken() !== null;
}

/**
 * Opens a Google sign-in popup when there is no usable cached token. Only call
 * this from something the user actually clicked — a popup with no user gesture
 * behind it gets blocked. Rendering never calls this; the reconnect banner does.
 */
export async function getGoogleAccessToken() {
  const cached = getCachedGoogleToken();
  if (cached) return cached;

  if (!pendingSignIn) {
    pendingSignIn = signInWithPopup(auth, googleProvider)
      .then(result => {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        storeGoogleToken(credential);
        if (!credential || !credential.accessToken) {
          throw new Error('Google sign-in returned no Drive access token');
        }
        return credential.accessToken;
      })
      .finally(() => {
        pendingSignIn = null;
      });
  }

  return pendingSignIn;
}
