import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from './useAuth';

export function useEbayIntegration() {
  const { user } = useAuth();
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIntegration(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = doc(db, 'users', user.uid, 'integrations', 'ebay');
    return onSnapshot(
      ref,
      (snap) => {
        setIntegration(snap.exists() ? snap.data() : null);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [user]);

  const unlink = async () => {
    const fn = httpsCallable(functions, 'unlinkEbayAccount');
    await fn({});
  };

  return { integration, loading, unlink };
}
