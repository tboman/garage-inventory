import { useState, useCallback } from 'react';
import { useListings } from '../hooks/useListings';
import { useGroups } from '../hooks/useGroups';
import ListingGrid from '../components/ListingGrid';
import GroupGrid from '../components/GroupGrid';
import SearchBar from '../components/SearchBar';
import CategoryFilter from '../components/CategoryFilter';

export default function HomePage() {
  const [category, setCategory] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState(null);

  const isFiltering = !!searchKeyword || category !== 'all';

  const { listings, loading: listingsLoading, error: listingsError } = useListings({
    category: category === 'all' ? null : category,
    searchKeyword,
  });
  const { groups, loading: groupsLoading, error: groupsError } = useGroups({ pageSize: 20 });

  const handleSearch = useCallback((keyword) => {
    setSearchKeyword(keyword);
  }, []);

  const loading = isFiltering ? listingsLoading : groupsLoading;
  const error = isFiltering ? listingsError : groupsError;

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
      ) : isFiltering ? (
        <ListingGrid listings={listings} />
      ) : (
        <GroupGrid groups={groups} />
      )}
    </div>
  );
}
