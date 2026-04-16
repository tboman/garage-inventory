import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

const conditionLabels = {
  new: 'New',
  like_new: 'Like New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export default function ListingCard({ listing }) {
  const photo = listing.photos?.[0];

  return (
    <Link to={`/listing/${listing.id}`} className="text-decoration-none">
      <div className="card listing-card h-100">
        {photo ? (
          <img src={photo} alt={listing.title} className="card-img-top" />
        ) : (
          <div className="photo-placeholder">&#128247;</div>
        )}
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-start mb-1">
            <span className="listing-price">{formatPrice(listing.price)}</span>
            {listing.status !== 'active' && <StatusBadge status={listing.status} />}
          </div>
          <div className="listing-title text-dark">{listing.title}</div>
          <div className="d-flex gap-1 mt-1">
            <span className="badge bg-light text-dark border">{conditionLabels[listing.condition] || listing.condition}</span>
            <span className="badge bg-light text-dark border">{listing.category}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
