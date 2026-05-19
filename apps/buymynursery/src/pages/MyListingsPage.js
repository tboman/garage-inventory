import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getMyListings } from '../api';
import ListingGrid from '../components/ListingGrid';

export default function MyListingsPage() {
  const { user, login } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchMyListings = async () => {
      try {
        const results = await getMyListings(user.uid);
        setListings(results);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchMyListings();
  }, [user]);

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2 className="fw-bold mb-4">Sign in to view your listings</h2>
        <button className="btn btn-nursery btn-lg" onClick={login}>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-bold mb-0">My Nursery Listings</h2>
        <span className="badge bg-success rounded-pill px-3">{listings.length} items</span>
      </div>

      <ListingGrid listings={listings} loading={loading} />
    </div>
  );
}
