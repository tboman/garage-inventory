import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import './EbayListings.css';

interface EbayListing {
  itemId: string;
  title: string;
  price: string | null;
  image: string | null;
  itemWebUrl: string;
  condition: string | null;
}

export default function EbayListings() {
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchListings() {
      const user = auth.currentUser;
      if (!user) return;

      try {
        const token = await user.getIdToken();
        const resp = await fetch('/ebayMyListings', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          throw new Error(data?.error || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        if (!cancelled) {
          setListings(data.listings);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load listings');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchListings();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p className="dashboard__loading">Loading your eBay listings…</p>;
  }

  if (error) {
    return <p className="ebay-listings__error">Could not load eBay listings: {error}</p>;
  }

  if (listings.length === 0) {
    return (
      <div className="ebay-listings__empty">
        <p>You don't have any active eBay listings yet.</p>
        <a
          className="ebay-listings__create-link"
          href="https://www.ebay.com/sl/prelist/suggest"
          target="_blank"
          rel="noopener noreferrer"
        >
          Create a listing on eBay
        </a>
      </div>
    );
  }

  return (
    <div className="ebay-listings">
      <div className="ebay-listings__grid">
        {listings.map((listing) => (
          <a
            key={listing.itemId}
            className="ebay-listings__card"
            href={listing.itemWebUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {listing.image ? (
              <img
                className="ebay-listings__img"
                src={listing.image}
                alt={listing.title}
                loading="lazy"
              />
            ) : (
              <div className="ebay-listings__img ebay-listings__img--placeholder">
                ?
              </div>
            )}
            <div className="ebay-listings__body">
              <span className="ebay-listings__title">{listing.title}</span>
              <div className="ebay-listings__meta">
                {listing.price && (
                  <span className="ebay-listings__price">{listing.price}</span>
                )}
                {listing.condition && (
                  <span className="ebay-listings__condition">{listing.condition}</span>
                )}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
