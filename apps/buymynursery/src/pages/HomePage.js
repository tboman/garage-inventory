import { useState } from 'react';
import SearchBar from '../components/SearchBar';
import ListingGrid from '../components/ListingGrid';
import { useListings } from '../hooks/useListings';

const categories = [
  { value: 'all', label: 'All Baby Items', icon: '✨' },
  { value: 'furniture', label: 'Nursery Furniture', icon: '🛏️' },
  { value: 'gear', label: 'Strollers & Gear', icon: '🛒' },
  { value: 'clothing', label: 'Baby Clothes (0-5y)', icon: '👕' },
  { value: 'toys', label: 'Toys & Books', icon: '🧸' },
  { value: 'feeding', label: 'Feeding & Nursing', icon: '🍼' },
  { value: 'safety', label: 'Safety & Health', icon: '🛡️' },
];

export default function HomePage() {
  const [category, setCategory] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const { listings, loading } = useListings({ category, searchKeyword });

  return (
    <div className="container py-5">
      <div className="text-center mb-5">
        <h1 className="display-3 fw-bold mb-2" style={{color: '#5da9e9'}}>Buy My Nursery</h1>
        <p className="lead text-muted max-width-600 mx-auto">
          The curated community marketplace for baby nursery furniture, 
          clothing, and gear for little ones ages 0 to 5.
        </p>
      </div>

      <div className="row justify-content-center mb-4">
        <div className="col-lg-8">
          <SearchBar onSearch={setSearchKeyword} initialValue={searchKeyword} />
        </div>
      </div>

      <div className="d-flex gap-2 overflow-auto pb-4 mb-4 no-scrollbar">
        {categories.map((c) => (
          <button
            key={c.value}
            className={`btn category-pill rounded-pill px-4 text-nowrap d-flex align-items-center ${
              category === c.value ? 'active' : ''
            }`}
            onClick={() => setCategory(c.value)}
          >
            <span className="me-2 fs-5">{c.icon}</span> {c.label}
          </button>
        ))}
      </div>

      <div className="d-flex justify-content-between align-items-end mb-4">
        <h2 className="h4 fw-bold mb-0">
          {searchKeyword ? `Results for "${searchKeyword}"` : category === 'all' ? 'Latest Nursery Finds' : `${categories.find(c => c.value === category).label}`}
        </h2>
        <span className="text-muted small">{listings.length} items found</span>
      </div>

      <ListingGrid listings={listings} loading={loading} />
    </div>
  );
}
