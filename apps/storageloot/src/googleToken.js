import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

const TOKEN_KEY = 'google_access_token';
const EXPIRY_KEY = 'google_token_expiry';

export function storeGoogleToken(credential) {
  if (!credential?.accessToken) return;
  const expiry = Date.now() + 55 * 60 * 1000;
  sessionStorage.setItem(TOKEN_KEY, credential.accessToken);
  sessionStorage.setItem(EXPIRY_KEY, String(expiry));
}

export function clearGoogleToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
}

export async function getGoogleAccessToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);

  if (token && Date.now() < expiry) {
    return token;
  }

  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  storeGoogleToken(credential);
  return credential?.accessToken || null;
}
