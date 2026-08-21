import React, { useEffect, useMemo, useState } from 'react';
import ContainerCanvas from './ContainerCanvas';
import DriveImage from './DriveImage';
import PhotoViewer from './PhotoViewer';
import { resolvePlacements } from '../autoLayout';

/**
 * Read-only graphical browser. One container fills the screen as its own photo
 * canvas; pins with a child count descend, leaves open a full-frame photo
 * viewer that steps through every photo in the location. Nothing
 * in here writes to Firestore.
 */
const BrowseMode = ({ items, at, onNavigate, onExit, canShowPhotos }) => {
  const [query, setQuery] = useState('');
  const [highlightId, setHighlightId] = useState(null);
  // Index into `strip`, or null when the canvas is showing.
  const [viewIndex, setViewIndex] = useState(null);

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

  const pins = useMemo(() => {
    const children = items
      .filter(i => i.locationId === containerId)
      .sort((a, b) => a.order - b.order)
      .map(i => ({ ...i, childCount: childCounts.get(i.id) || 0 }));
    return resolvePlacements(children);
  }, [items, containerId, childCounts]);

  // Photos are unreachable on a shared inventory (drive.file only covers files
  // this account made through this app) and with Drive disconnected. Rather than
  // a canvas of grey placeholders, fall back to a plain list.
  const anyPhotosHere = pins.some(p => (p.photos || []).length > 0);
  const useList = !canShowPhotos || !anyPhotosHere;

  const backdrop = container && container.photos && container.photos.length > 0
    ? container.photos[0]
    : null;

  // Every photo in this location, in sibling order. Items with no photo still
  // get an entry so arrowing left and right reaches everything that is here.
  const strip = useMemo(() => {
    const out = [];
    for (const item of pins) {
      const photos = item.photos || [];
      if (photos.length === 0) out.push({ src: null, item });
      else for (const src of photos) out.push({ src, item });
    }
    return out;
  }, [pins]);

  const go = (id, highlight = null) => {
    setHighlightId(highlight);
    setViewIndex(null);
    onNavigate(id);
  };

  const openItem = (item) => {
    if ((childCounts.get(item.id) || 0) > 0) {
      go(item.id);
      return;
    }
    const idx = strip.findIndex(e => e.item.id === item.id);
    if (idx >= 0) setViewIndex(idx);
  };

  const step = (delta) => {
    setViewIndex(i => (i == null || strip.length === 0)
      ? i
      : (i + delta + strip.length) % strip.length);
  };

  useEffect(() => {
    const onKey = (e) => {
      // Let the search field keep its own arrow and escape handling.
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;

      if (e.key === 'Escape') {
        if (viewIndex != null) setViewIndex(null);
        else if (container) onNavigate(container.locationId);
        return;
      }
      if (viewIndex == null || strip.length === 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setViewIndex(i => (i - 1 + strip.length) % strip.length);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setViewIndex(i => (i + 1) % strip.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewIndex, container, strip.length, onNavigate]);

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
        <nav className="crumbs">
          <button className="btn btn-link btn-sm p-0" onClick={() => go(null)} title="Top level">
            <i className="fas fa-home"></i>
          </button>
          {trail.map((item, idx) => (
            <span key={item.id}>
              <span className="crumb-sep">/</span>
              {idx === trail.length - 1 && viewIndex == null ? (
                <span className="crumb-current">{item.name}</span>
              ) : (
                <button className="btn btn-link btn-sm p-0" onClick={() => go(item.id)}>
                  {item.name}
                </button>
              )}
            </span>
          ))}
          {viewIndex != null && strip[viewIndex] && (
            <span>
              <span className="crumb-sep">/</span>
              <span className="crumb-current">{strip[viewIndex].item.name}</span>
            </span>
          )}
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
                  {canShowPhotos && (
                    <span className="browse-result-thumb">
                      {item.photos && item.photos.length > 0
                        ? <DriveImage src={item.photos[0]} alt={item.name} />
                        : <i className="fas fa-box"></i>}
                    </span>
                  )}
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

          {viewIndex != null && !useList ? (
            <PhotoViewer
              entries={strip}
              index={viewIndex}
              onStep={step}
              onClose={() => setViewIndex(null)}
              onOpenContainer={(item) => go(item.id)}
            />
          ) : useList ? (
            pins.length === 0 ? (
              <div className="empty-state">Nothing in here yet</div>
            ) : (
              <ul className="list-group browse-list">
                {pins.map(item => {
                  const isContainer = item.childCount > 0;
                  const photoCount = (item.photos || []).length;
                  const Row = isContainer ? 'button' : 'div';
                  return (
                    <li
                      key={item.id}
                      className={`list-group-item browse-list-item${highlightId === item.id ? ' browse-list-item-highlight' : ''}`}
                    >
                      <Row
                        className="browse-list-row"
                        {...(isContainer ? { type: 'button', onClick: () => go(item.id) } : {})}
                      >
                        <span className="browse-list-text">
                          <strong>{item.name}</strong>
                          {item.description && (
                            <span className="text-muted small d-block">{item.description}</span>
                          )}
                        </span>
                        {photoCount > 0 && (
                          <span
                            className="text-muted small flex-shrink-0"
                            title={`${photoCount} photo${photoCount > 1 ? 's' : ''}`}
                          >
                            <i className="fas fa-camera"></i> {photoCount}
                          </span>
                        )}
                        {isContainer && (
                          <>
                            <span className="badge bg-secondary rounded-pill flex-shrink-0">
                              {item.childCount}
                            </span>
                            <i className="fas fa-chevron-right text-muted flex-shrink-0"></i>
                          </>
                        )}
                      </Row>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <ContainerCanvas
              backdrop={backdrop}
              pins={pins}
              highlightId={highlightId}
              onPinClick={openItem}
              hint="Nothing in here yet"
            />
          )}
        </>
      )}

      <button className="btn btn-outline-secondary btn-sm mt-3" onClick={onExit}>
        <i className="fas fa-pen me-1"></i>Switch to Manage
      </button>
    </div>
  );
};

export default BrowseMode;
