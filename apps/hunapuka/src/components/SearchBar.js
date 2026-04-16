import React from 'react';

const SearchBar = ({ query, onChange }) => {
  return (
    <div className="search-bar mb-3">
      <div className="input-group">
        <span className="input-group-text">
          <i className="fas fa-search"></i>
        </span>
        <input
          type="text"
          className="form-control"
          placeholder="Search items..."
          value={query}
          onChange={e => onChange(e.target.value)}
        />
        {query && (
          <button
            className="btn btn-outline-secondary"
            onClick={() => onChange('')}
            type="button"
          >
            <i className="fas fa-times"></i>
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
