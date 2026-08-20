import React, { useState } from 'react';
import DriveImage from './DriveImage';

const DEFAULT_RATIO = 4 / 3;

/**
 * Fills the same frame a container's backdrop occupies, so moving between a
 * container and a leaf photo keeps one consistent picture size. Steps through
 * every photo in the current location, not just the item you opened.
 */
const PhotoViewer = ({ entries, index, onStep, onClose, onOpenContainer }) => {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);

  const entry = entries[index];
  if (!entry) return null;

  const { src, item } = entry;
  const many = entries.length > 1;

  return (
    <div className="photo-viewer-wrap">
      <div className="container-canvas photo-viewer" style={{ aspectRatio: String(ratio) }}>
        {src ? (
          <DriveImage
            src={src}
            alt={item.name}
            className="photo-viewer-img"
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.target;
              if (w && h) setRatio(w / h);
            }}
          />
        ) : (
          <div className="photo-viewer-empty">
            <i className="fas fa-box fa-2x"></i>
            <span className="small">No photo</span>
          </div>
        )}

        <button
          className="btn btn-light btn-sm photo-viewer-close"
          onClick={onClose}
          title="Close (Esc)"
        >
          <i className="fas fa-times"></i>
        </button>

        {many && (
          <>
            <button
              className="photo-viewer-nav photo-viewer-prev"
              onClick={() => onStep(-1)}
              title="Previous (left arrow)"
              aria-label="Previous photo"
            >
              <i className="fas fa-chevron-left"></i>
            </button>
            <button
              className="photo-viewer-nav photo-viewer-next"
              onClick={() => onStep(1)}
              title="Next (right arrow)"
              aria-label="Next photo"
            >
              <i className="fas fa-chevron-right"></i>
            </button>
          </>
        )}
      </div>

      <div className="photo-viewer-caption">
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <strong>{item.name}</strong>
          {item.description && <div className="text-muted small">{item.description}</div>}
        </div>
        {item.childCount > 0 && (
          <button
            className="btn btn-outline-secondary btn-sm flex-shrink-0"
            onClick={() => onOpenContainer(item)}
          >
            Open<i className="fas fa-arrow-right ms-1"></i>
          </button>
        )}
        {many && (
          <span className="text-muted small flex-shrink-0">{index + 1} / {entries.length}</span>
        )}
      </div>
    </div>
  );
};

export default PhotoViewer;
