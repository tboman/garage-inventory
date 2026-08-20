import React, { useMemo, useState } from 'react';
import ContainerCanvas from './ContainerCanvas';
import DriveImage from './DriveImage';

/**
 * Read-only graphical browser. One container fills the screen as its own photo
 * canvas; pins with a child count descend, leaves open a detail panel. Nothing
 * in here writes to Firestore.
 */
const BrowseMode = ({ items, at, onNavigate, onExit }) => {
  const [query, setQuery] = useState('');
  const [highlightId, setHighlightId] = useState(null);
  const [detail, setDetail] = useState(null);

  const childCounts = useMemo(() => {
    const counts = new Map();
    for (const item of items) {
      if (item.locationId == null) continue;
      counts.set(item.locationId, (counts.get(item.locationId) || 0) + 1);
    }
    return counts;
  }, [items]);

  // An `at` pointing at a deleted item falls back to the top level.
  const container = at != null ? items.find(i => i.id === at) || null : null;
  const containerId = container ? container.id : null;

  const trail = useMemo(() => {
    const out = [];
    let id = containerId;
    while (id != null) {
      // eslint-disable-next-line no-loop-func
      const item = items.find(i => i.id === id);
      if (!item) break;
      out.unshift(item);
      id = item.locationId;
    }
    return out;
  }, [containerId, items]);

  const children = useMemo(
    () => items
      .filter(i => i.locationId === containerId)
      .sort((a, b) => a.order - b.order)
      .map(i => ({ ...i, childCount: childCounts.get(i.id) || 0 })),
    [items, containerId, childCounts]
  );

  const placed = children.filter(i => i.x != null && i.y != null);
  const unplaced = children.filter(i => i.x == null || i.y == null);
  const backdrop = container && container.photos && container.photos.length > 0
    ? container.photos[0]
    : null;

  const go = (id, highlight = null) => {
    setHighlightId(highlight);
    setDetail(null);
    onNavigate(id);
  };

  const openItem = (item) => {
    if ((childCounts.get(item.id) || 0) > 0) {
      go(item.id);
    } else {
      setDetail(item);
    }
  };

  const pathOf = (item) => {
    const names = [];
    let id = item.locationId;
    while (id != null) {
      // eslint-disable-next-line no-loop-func
      const parent = items.find(i => i.id === id);
      if (!parent) break;
      names.unshift(parent.name);
      id = parent.locationId;
    }
    return names;
  };

  const q = query.trim().toLowerCase();
  const results = q
    ? items.filter(item =>
        item.name.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)))
    : [];

  return (
    <div className="browse-mode">
      <div className="browse-bar">
        <nav className="browse-crumbs">
          <button className="btn btn-link btn-sm p-0" onClick={() => go(null)} title="Top level">
            <i className="fas fa-home"></i>
          </button>
          {trail.map((item, idx) => (
            <span key={item.id}>
              <span className="browse-crumb-sep">/</span>
              {idx === trail.length - 1 ? (
                <span className="browse-crumb-current">{item.name}</span>
              ) : (
                <button className="btn btn-link btn-sm p-0" onClick={() => go(item.id)}>
                  {item.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <input
          type="search"
          className="form-control form-control-sm browse-search"
          placeholder="Find anything..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {q ? (
        <ul className="list-group browse-results">
          {results.length === 0 && (
            <li className="list-group-item text-muted text-center py-4">No match for that</li>
          )}
          {results.map(item => {
            const path = pathOf(item);
            return (
              <li key={item.id} className="list-group-item browse-result">
                <button
                  className="browse-result-btn"
                  onClick={() => {
                    setQuery('');
                    go(item.locationId, item.id);
                  }}
                >
                  <span className="browse-result-thumb">
                    {item.photos && item.photos.length > 0
                      ? <DriveImage src={item.photos[0]} alt={item.name} />
                      : <i className="fas fa-box"></i>}
                  </span>
                  <span className="browse-result-text">
                    <strong>{item.name}</strong>
                    <span className="text-muted small d-block">
                      {path.length > 0 ? path.join(' / ') : 'Top level'}
                    </span>
                  </span>
                  <i className="fas fa-arrow-right text-muted"></i>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          {container && container.description && (
            <p className="text-muted small mb-2">{container.description}</p>
          )}

          <ContainerCanvas
            backdrop={backdrop}
            pins={placed}
            highlightId={highlightId}
            onPinClick={openItem}
            hint={
              children.length === 0
                ? 'Nothing in here yet'
                : 'Nothing placed here yet - arrange it in Manage mode'
            }
          />

          {unplaced.length > 0 && (
            <div className="browse-unplaced">
              <div className="browse-unplaced-title">
                Not placed on the {backdrop ? 'photo' : 'canvas'} ({unplaced.length})
              </div>
              <div className="browse-unplaced-items">
                {unplaced.map(item => (
                  <button
                    key={item.id}
                    className={`tray-tile${highlightId === item.id ? ' tray-tile-highlight' : ''}`}
                    onClick={() => openItem(item)}
                    title={item.name}
                  >
                    <span className="tray-tile-thumb">
                      {item.photos && item.photos.length > 0
                        ? <DriveImage src={item.photos[0]} alt={item.name} />
                        : <i className="fas fa-box"></i>}
                      {item.childCount > 0 && <span className="canvas-pin-count">{item.childCount}</span>}
                    </span>
                    <span className="tray-tile-label">{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {detail && (
        <div className="photo-lightbox" onClick={() => setDetail(null)}>
          <div className="browse-detail" onClick={e => e.stopPropagation()}>
            <button className="btn btn-light btn-sm browse-detail-close" onClick={() => setDetail(null)}>
              <i className="fas fa-times"></i>
            </button>
            <h5 className="mb-1">{detail.name}</h5>
            <div className="text-muted small mb-3">
              {pathOf(detail).join(' / ') || 'Top level'}
            </div>
            {detail.description && <p className="mb-3">{detail.description}</p>}
            <div className="d-flex flex-wrap gap-2">
              {(detail.photos || []).map((photo, idx) => (
                <DriveImage
                  key={idx}
                  src={photo}
                  alt={`${detail.name} ${idx + 1}`}
                  className="rounded"
                  style={{ width: 120, height: 120, objectFit: 'cover' }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <button className="btn btn-outline-secondary btn-sm mt-3" onClick={onExit}>
        <i className="fas fa-pen me-1"></i>Switch to Manage
      </button>
    </div>
  );
};

export default BrowseMode;
