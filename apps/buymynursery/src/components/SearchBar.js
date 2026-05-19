import { useState } from 'react';

export default function SearchBar({ onSearch, initialValue = '' }) {
  const [query, setQuery] = useState(initialValue);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(query.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4">
      <div className="input-group input-group-lg shadow-sm">
        <input
          type="text"
          className="form-control border-0"
          placeholder="Search for plants, seeds, tools..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-nursery px-4" type="submit">
          Search
        </button>
      </div>
    </form>
  );
}
