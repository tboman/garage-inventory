import { useState, useCallback } from 'react';
import { useListings } from '../hooks/useListings';
import ListingGrid from '../components/ListingGrid';
import SearchBar from '../components/SearchBar';
import CategoryFilter from '../components/CategoryFilter';

export default function HomePage() {
  const [category, setCategory] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState(null);
  const { listings, loading, error } = useListings({ category: category === 'all' ? null : category, searchKeyword });

  const handleSearch = useCallback((keyword) => {
    setSearchKeyword(keyword);
  }, []);

  return (
    <div className="container py-4">
      <div className="text-center mb-4">
        <h1 className="fw-bold">StorageLoot</h1>
        <p className="text-muted">Buy and sell storage finds</p>
      </div>

      <div className="mb-3">
        <SearchBar onSearch={handleSearch} />
      </div>

      <div className="mb-4">
        <CategoryFilter selected={category} onChange={setCategory} />
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="loading-spinner">
          <div className="spinner-border text-secondary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : (
        <ListingGrid listings={listings} />
      )}
    </div>
  );
}
