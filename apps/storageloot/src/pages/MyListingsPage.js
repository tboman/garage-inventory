import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getMyListings, updateListing, deleteListing } from '../api';
import StatusBadge from '../components/StatusBadge';

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

export default function MyListingsPage() {
  const { user, login, loading: authLoading } = useAuth();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getMyListings(user.uid).then(l => {
      setListings(l);
      setLoading(false);
    });
  }, [user]);

  if (authLoading) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>;
  }

  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to manage listings</h2>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  const filtered = filter === 'all' ? listings : listings.filter(l => l.status === filter);

  const handleMarkSold = async (id) => {
    await updateListing(id, { status: 'sold' });
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'sold' } : l));
  };

  const handleReactivate = async (id) => {
    await updateListing(id, { status: 'active' });
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'active' } : l));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this listing? This cannot be undone.')) return;
    await deleteListing(id);
    setListings(prev => prev.filter(l => l.id !== id));
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="fw-bold mb-0">My Listings</h2>
        <Link to="/create" className="btn btn-sl">+ New Listing</Link>
      </div>

      <div className="btn-group mb-3">
        {['all', 'active', 'sold', 'expired', 'draft'].map(s => (
          <button
            key={s}
            className={`btn btn-sm ${filter === s ? 'btn-dark' : 'btn-outline-secondary'}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <p>No listings found.</p>
          <Link to="/create" className="btn btn-sl">Create your first listing</Link>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Title</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(listing => (
                <tr key={listing.id}>
                  <td style={{ width: 60 }}>
                    {listing.photos?.[0] ? (
                      <img src={listing.photos[0]} alt="" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 50, height: 50, background: '#dee2e6', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#adb5bd' }}>?</div>
                    )}
                  </td>
                  <td>
                    <Link to={`/listing/${listing.id}`} className="text-decoration-none fw-semibold">
                      {listing.title}
                    </Link>
                  </td>
                  <td className="fw-bold">{formatPrice(listing.price)}</td>
                  <td><StatusBadge status={listing.status} /></td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      <Link className="btn btn-outline-secondary" to={`/listing/${listing.id}/edit`}>Edit</Link>
                      {listing.status === 'active' && (
                        <button className="btn btn-outline-success" onClick={() => handleMarkSold(listing.id)}>Mark Sold</button>
                      )}
                      {(listing.status === 'sold' || listing.status === 'expired') && (
                        <button className="btn btn-outline-primary" onClick={() => handleReactivate(listing.id)}>Reactivate</button>
                      )}
                      <button className="btn btn-outline-danger" onClick={() => handleDelete(listing.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
