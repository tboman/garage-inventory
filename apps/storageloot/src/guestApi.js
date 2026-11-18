// Guests: people who write to a seller without signing in with Google.
//
// The guest's credential is a cookie the server sets (__session, HttpOnly, so
// this code never sees it). POST /api/guest/session trades it for a Firebase
// custom token (functions/src/poppy/storageloot.js), and the guest is signed
// in to Firebase with in-memory persistence only, so the cookie stays the one
// thing that keeps them signed in. Firestore rules let guests take part in
// conversations and nothing else.
//
// The server cookie is invisible to scripts, so a second, readable cookie
// (sl_guest=1) marks a browser that has a guest; without it, page loads skip
// the call.
import { signInWithCustomToken, setPersistence, inMemoryPersistence } from 'firebase/auth';
import { auth } from './firebase';

const MARK = 'sl_guest';
const YEAR_S = 365 * 24 * 60 * 60;

// Browser guests' ids; agent guests (slg_) never sign in to the web app.
export const isGuestUid = (uid) => typeof uid === 'string' && uid.startsWith('sla_');

export const hasGuestMark = () => document.cookie.split(';').some((c) => c.trim() === `${MARK}=1`);

function setMark(on) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${MARK}=${on ? '1' : ''}; Path=/; Max-Age=${on ? YEAR_S : 0}; SameSite=Strict${secure}`;
}

const post = (path, body = {}) =>
  fetch(`/api/guest/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// Signs the browser's guest in. With create, makes one if there is none.
// Resolves to the Firebase user, or null when there is no guest to sign in.
export async function guestSignIn({ create }) {
  const res = await post('session', { create });
  if (res.status === 204) {
    setMark(false);
    return null;
  }
  if (res.status === 429) {
    throw new Error('Too many new guests from your network right now. Try again later, or sign in with Google.');
  }
  if (!res.ok) throw new Error('Could not start a guest session. Try again, or sign in with Google.');
  const { token } = await res.json();
  await setPersistence(auth, inMemoryPersistence);
  const { user } = await signInWithCustomToken(auth, token);
  setMark(true);
  return user;
}

// Ends the browser's guest for good: the server forgets its cookie session.
export async function guestSignOut() {
  setMark(false);
  try {
    await post('sign-out');
  } catch {
    // The mark is gone either way, so the guest will not be resumed.
  }
}
