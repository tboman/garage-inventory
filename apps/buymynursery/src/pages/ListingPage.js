import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getListing, deleteListing } from '../api';

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

const categoryLabels = {
  furniture: 'Nursery Furniture',
  gear: 'Strollers & Gear',
  clothing: 'Baby Clothes (0-5y)',
  toys: 'Toys & Books',
  feeding: 'Feeding & Nursing',
  safety: 'Safety & Health',
  other: 'Other',
};

const platformIcons = {
  ebay: '🛒',
  craigslist: '📋',
  facebook: '👥',
  offerup: '🤝',
  other: '🔗',
};

export default function ListingPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState(0);

  useEffect(() => {
    const fetchListing = async () => {
      try {
        const data = await getListing(id);
        if (!data) throw new Error('Listing not found');
        setListing(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchListing();
  }, [id]);

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this listing?')) return;
    try {
      await deleteListing(id);
      navigate('/my-listings');
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) {
    return <div className="container py-5 text-center"><span className="spinner-border text-primary"></span></div>;
  }

  if (error || !listing) {
    return (
      <div className="container py-5 text-center">
        <h2>Oops!</h2>
        <p className="text-muted">{error || 'This item seems to have crawled away.'}</p>
        <Link to="/" className="btn btn-nursery">Back to Browse</Link>
      </div>
    );
  }

  const isOwner = user && user.uid === listing.sellerId;

  return (
    <div className="container py-4">
      <nav aria-label="breadcrumb" className="mb-4">
        <ol className="breadcrumb">
          <li className="breadcrumb-item"><Link to="/" className="text-primary text-decoration-none fw-bold">Browse</Link></li>
          <li className="breadcrumb-item active">{categoryLabels[listing.category] || listing.category}</li>
        </ol>
      </nav>

      <div className="row g-4">
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm overflow-hidden mb-3 rounded-4">
            {listing.photos && listing.photos.length > 0 ? (
              <>
                <img
                  src={listing.photos[selectedPhoto]}
                  alt={listing.title}
                  className="img-fluid w-100"
                  style={{ maxHeight: '600px', objectFit: 'contain', backgroundColor: '#fdfdfd' }}
                />
                {listing.photos.length > 1 && (
                  <div className="card-footer bg-white border-0 p-2 overflow-auto d-flex gap-2">
                    {listing.photos.map((p, i) => (
                      <img
                        key={i}
                        src={p}
                        alt=""
                        className={`img-thumbnail flex-shrink-0 border-2 ${selectedPhoto === i ? 'border-primary' : 'border-light'}`}
                        style={{ height: '70px', width: '70px', objectFit: 'cover', cursor: 'pointer', borderRadius: '8px' }}
                        onClick={() => setSelectedPhoto(i)}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="photo-placeholder py-5" style={{ height: '400px' }}>🧸</div>
            )}
          </div>
        </div>

        <div className="col-lg-5">
          <div className="p-4 bg-white shadow-sm rounded-4 border border-light">
            <div className="d-flex justify-content-between align-items-start mb-2">
              <h1 className="h2 fw-bold mb-0" style={{color: '#333'}}>{listing.title}</h1>
              {isOwner && (
                <div className="dropdown">
                  <button className="btn btn-light btn-sm rounded-circle" data-bs-toggle="dropdown" style={{width: '32px', height: '32px'}}>•••</button>
                  <ul className="dropdown-menu dropdown-menu-end shadow border-0">
                    <li><Link className="dropdown-item" to={`/listing/${id}/edit`}>Edit Listing</Link></li>
                    <li><button className="dropdown-item text-danger" onClick={handleDelete}>Delete Listing</button></li>
                  </ul>
                </div>
              )}
            </div>

            <div className="display-5 fw-bold text-primary mb-3">
              ${(listing.price / 100).toFixed(2)}
            </div>

            <div className="d-flex gap-2 mb-4 flex-wrap">
              <span className="badge bg-light text-primary border border-primary-subtle px-3 py-2 rounded-pill">
                Condition: {conditionLabels[listing.condition]}
              </span>
              <span className="badge bg-light text-secondary border border-secondary-subtle px-3 py-2 rounded-pill">
                {categoryLabels[listing.category] || listing.category}
              </span>
            </div>

            <div className="mb-4">
              <h5 className="fw-bold border-bottom pb-2">Description</h5>
              <p className="text-muted white-space-pre-wrap small" style={{lineHeight: '1.6'}}>{listing.description || 'No description provided.'}</p>
            </div>

            {listing.externalLinks && listing.externalLinks.length > 0 && (
              <div className="mb-4">
                <h5 className="fw-bold border-bottom pb-2">Shop This Item</h5>
                <div className="d-grid gap-2 mt-3">
                  {listing.externalLinks.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline-primary d-flex align-items-center justify-content-between px-4 py-2 rounded-3"
                    >
                      <span className="text-uppercase fw-bold small">{link.platform}</span>
                      <span>{platformIcons[link.platform] || '🔗'} View on {link.platform}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="p-3 bg-light rounded-3 d-flex align-items-center gap-3 mt-4 border border-light">
              <div className="text-muted small">Seller: <strong>{listing.sellerDisplayName}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
