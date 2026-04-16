import { useState, useEffect } from 'react';

export default function SearchBar({ onSearch }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(value.trim() || null);
    }, 300);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  return (
    <div className="search-bar">
      <div className="input-group">
        <span className="input-group-text bg-white">&#128269;</span>
        <input
          type="text"
          className="form-control"
          placeholder="Search listings..."
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        {value && (
          <button className="btn btn-outline-secondary" onClick={() => setValue('')}>
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
