import ListingCard from './ListingCard';

export default function ListingGrid({ listings, loading }) {
  if (loading) {
    return (
      <div className="row g-4 mt-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="col-sm-6 col-lg-3">
            <div className="card border-0 shadow-sm h-100 placeholder-glow">
              <div className="placeholder col-12" style={{ height: '200px' }}></div>
              <div className="card-body">
                <div className="placeholder col-4 mb-2"></div>
                <div className="placeholder col-10"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="text-center py-5">
        <div className="display-1 mb-3">🌱</div>
        <h3>No listings found</h3>
        <p className="text-muted">Be the first to post something in this category!</p>
      </div>
    );
  }

  return (
    <div className="row g-4 mt-2">
      {listings.map((l) => (
        <div key={l.id} className="col-sm-6 col-lg-3">
          <ListingCard listing={l} />
        </div>
      ))}
    </div>
  );
}
