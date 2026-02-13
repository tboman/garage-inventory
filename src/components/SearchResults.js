import React from 'react';

const SearchResults = ({ results, allItems }) => {
  const getBreadcrumb = (item) => {
    const trail = [];
    let id = item.locationId;
    while (id !== null) {
      // eslint-disable-next-line no-loop-func
      const parent = allItems.find(i => i.id === id);
      if (!parent) break;
      trail.unshift(parent.name);
      id = parent.locationId;
    }
    return trail;
  };

  if (results.length === 0) {
    return (
      <div className="text-center text-muted py-5">
        <i className="fas fa-search fa-2x mb-3 d-block"></i>
        <p>No results found</p>
      </div>
    );
  }

  return (
    <ul className="list-group search-results">
      {results.map(item => {
        const breadcrumb = getBreadcrumb(item);
        const firstPhoto = (item.photos || [])[0];
        return (
          <li key={item.id} className="list-group-item search-result-item">
            <div className="d-flex align-items-center">
              {firstPhoto && (
                <img
                  src={firstPhoto}
                  alt={item.name}
                  className="rounded me-3"
                  style={{ width: 48, height: 48, objectFit: 'cover' }}
                />
              )}
              <div>
                <strong>{item.name}</strong>
                {breadcrumb.length > 0 && (
                  <div className="text-muted small">
                    {breadcrumb.join(' > ')} > {item.name}
                  </div>
                )}
                {item.description && (
                  <div className="text-muted small">{item.description}</div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default SearchResults;
