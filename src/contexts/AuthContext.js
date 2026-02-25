import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { storeGoogleToken, clearGoogleToken } from '../googleToken';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential) storeGoogleToken(credential);
    return result;
  };

  const logOut = () => {
    clearGoogleToken();
    return signOut(auth);
  };

  const value = { user, authLoading, signInWithGoogle, logOut };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
