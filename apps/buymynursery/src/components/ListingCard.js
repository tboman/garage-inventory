import { Link } from 'react-router-dom';

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

const categoryLabels = {
  furniture: 'Nursery Furniture',
  gear: 'Strollers & Gear',
  clothing: 'Baby Clothes',
  toys: 'Toys & Books',
  feeding: 'Feeding & Nursing',
  safety: 'Safety & Health',
  other: 'Other',
};

export default function ListingCard({ listing }) {
  const photo = listing.photos?.[0];

  return (
    <Link to={`/listing/${listing.id}`} className="text-decoration-none">
      <div className="card listing-card h-100 border-0 shadow-sm">
        {photo ? (
          <img src={photo} alt={listing.title} className="card-img-top" />
        ) : (
          <div className="photo-placeholder">🧸</div>
        )}
        <div className="card-body">
          <div className="mb-1">
            <span className="listing-price">{formatPrice(listing.price)}</span>
          </div>
          <div className="listing-title text-dark mb-2">{listing.title}</div>
          <div className="d-flex gap-1 mt-auto flex-wrap">
            <span className="badge bg-light text-primary border border-primary-subtle rounded-pill px-2">
              {conditionLabels[listing.condition] || listing.condition}
            </span>
            <span className="badge bg-light text-secondary border border-secondary-subtle rounded-pill px-2">
              {categoryLabels[listing.category] || listing.category}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
