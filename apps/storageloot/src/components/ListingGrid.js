import ListingCard from './ListingCard';

export default function ListingGrid({ listings }) {
  if (!listings.length) {
    return (
      <div className="text-center py-5 text-muted">
        <p className="fs-5">No listings found.</p>
      </div>
    );
  }

  return (
    <div className="listing-grid">
      {listings.map(listing => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
