import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useEbayIntegration } from '../hooks/useEbayIntegration';
import { startEbayLogin } from '../ebayAuth';

function formatPrice(amount, currency) {
  if (amount == null) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  } catch {
    return `${amount} ${currency || ''}`.trim();
  }
}

export default function MyEbayListingsPage() {
  const { user, loading: authLoading, login } = useAuth();
  const { integration: ebay, loading: ebayLoading } = useEbayIntegration();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsRelink, setNeedsRelink] = useState(false);

  useEffect(() => {
    if (authLoading || ebayLoading) return;
    if (!user || !ebay) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNeedsRelink(false);

    (async () => {
      try {
        const fn = httpsCallable(functions, 'getActiveEbayListings');
        const res = await fn({ pageNumber: page, entriesPerPage: 50, sort: 'TimeLeft' });
        if (!cancelled) setData(res.data);
      } catch (e) {
        if (cancelled) return;
        const msg = e?.message || '';
        if (msg.includes('ebay-needs-relink') || msg.includes('ebay-not-linked')) {
          setNeedsRelink(true);
        } else {
          setError(msg || 'Failed to load listings.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, ebayLoading, user, ebay, page]);

  if (authLoading || ebayLoading) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>;
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to see your eBay listings</h2>
        <button className="btn btn-sl btn-lg mt-3" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  if (!ebay) {
    return (
      <div className="container py-5 text-center">
        <h2>Connect your eBay account</h2>
        <p className="text-muted">Link eBay to see your active listings here.</p>
        <button className="btn btn-sl btn-lg mt-3" onClick={() => startEbayLogin()}>Connect eBay</button>
      </div>
    );
  }

  if (needsRelink) {
    return (
      <div className="container py-5 text-center">
        <h2>Re-connect eBay to enable listings view</h2>
        <p className="text-muted">
          Your existing eBay link doesn't include permission to read your selling data.
          Re-connecting will grant the required scope.
        </p>
        <button className="btn btn-sl btn-lg mt-3" onClick={() => startEbayLogin()}>
          Re-connect eBay
        </button>
      </div>
    );
  }

  const totalPages = data?.pagination?.totalPages ?? 1;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 className="mb-0">My eBay Active Listings</h2>
        <span className="text-muted small">
          {data?.pagination
            ? `${data.pagination.totalEntries} total · page ${page} of ${totalPages}`
            : ''}
        </span>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>
      ) : !data?.items?.length ? (
        <p className="text-muted">No active listings.</p>
      ) : (
        <div className="list-group mb-3">
          {data.items.map((it) => (
            <a
              key={it.itemId}
              className="list-group-item list-group-item-action d-flex gap-3 align-items-center"
              href={it.viewItemUrl || `https://www.ebay.com/itm/${it.itemId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {it.galleryUrl ? (
                <img
                  src={it.galleryUrl}
                  alt=""
                  width={64}
                  height={64}
                  style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 64, height: 64, background: '#eee', borderRadius: 4, flexShrink: 0 }} />
              )}
              <div className="flex-grow-1 min-width-0">
                <div className="fw-semibold text-truncate">{it.title}</div>
                <div className="small text-muted">
                  {formatPrice(it.price, it.currency)}
                  {it.quantity != null && ` · qty ${it.quantity}`}
                  {it.quantitySold ? ` · sold ${it.quantitySold}` : ''}
                  {it.timeLeft && ` · ${it.timeLeft} left`}
                </div>
                <div className="small text-muted">ID: {it.itemId}</div>
              </div>
            </a>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="d-flex justify-content-between">
          <button
            className="btn btn-outline-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            ← Previous
          </button>
          <button
            className="btn btn-outline-secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
