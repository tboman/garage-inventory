import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { clearGoogleToken } from '../googleToken';
import { isGuestUid, hasGuestMark, guestSignIn, guestSignOut } from '../guestApi';

const AuthContext = createContext(null);

// `user` is the person signed in with Google, and everything about selling
// uses it. `guest` is a browser guest (see guestApi.js), who can only write to
// sellers and read their replies. `me` is whichever of the two is signed in,
// for the message pages.
export function AuthProvider({ children }) {
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let first = true;
    return onAuthStateChanged(auth, async (u) => {
      setCurrent(u);
      if (!u) clearGoogleToken();
      if (!first) return;
      first = false;
      // Guests are not kept by Firebase between page loads; their cookie is.
      if (!u && hasGuestMark()) {
        try {
          await guestSignIn({ create: false });
        } catch {
          // Stay signed out; the person can still send as a new guest.
        }
      }
      setLoading(false);
    });
  }, []);

  const login = useCallback(async () => {
    await setPersistence(auth, browserLocalPersistence);
    return signInWithPopup(auth, googleProvider);
  }, []);

  // Signs the browser's guest in, making one if needed, and resolves to it.
  const startGuest = useCallback(async () => {
    if (auth.currentUser) return auth.currentUser;
    return guestSignIn({ create: true });
  }, []);

  const logout = useCallback(async () => {
    clearGoogleToken();
    if (isGuestUid(auth.currentUser?.uid)) await guestSignOut();
    await signOut(auth);
  }, []);

  const guest = current && isGuestUid(current.uid) ? current : null;
  const user = guest ? null : current;

  return (
    <AuthContext.Provider value={{ user, guest, me: current, loading, login, logout, startGuest }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
