import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../hooks/useAuth';
import { functions } from '../firebase';
import { consumeEbayState } from '../ebayAuth';

export default function EbayAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState('Linking your eBay account…');
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (authLoading || ran.current) return;

    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');
    const ebayError = searchParams.get('error');

    if (ebayError) {
      ran.current = true;
      setError(searchParams.get('error_description') || ebayError);
      return;
    }

    if (!user) {
      setStatus('Please sign in to finish linking your eBay account.');
      return;
    }

    if (!code || !returnedState) {
      ran.current = true;
      setError('Missing authorization code or state.');
      return;
    }

    if (!consumeEbayState(returnedState)) {
      ran.current = true;
      setError('State mismatch — aborting to prevent CSRF.');
      return;
    }

    ran.current = true;
    (async () => {
      try {
        const fn = httpsCallable(functions, 'linkEbayAccount');
        const res = await fn({ code });
        setStatus(`Linked as @${res.data.username}. Redirecting…`);
        setTimeout(() => navigate('/', { replace: true }), 1200);
      } catch (e) {
        setError(e.message || 'Failed to link eBay account.');
      }
    })();
  }, [authLoading, user, searchParams, navigate]);

  return (
    <div className="container py-5 text-center">
      {error ? (
        <>
          <h2>eBay link failed</h2>
          <p className="text-danger">{error}</p>
          <button className="btn btn-sl" onClick={() => navigate('/', { replace: true })}>
            Back home
          </button>
        </>
      ) : (
        <>
          <div className="spinner-border text-secondary mb-3" />
          <p>{status}</p>
        </>
      )}
    </div>
  );
}
