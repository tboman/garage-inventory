import React, { useRef, useState } from 'react';
import DriveImage from './DriveImage';

const DEFAULT_RATIO = 4 / 3;
// A sideways drag has to travel this far before it counts as a swipe.
const SWIPE_MIN_PX = 50;

/**
 * Fills the same frame a container's backdrop occupies, so moving between a
 * container and a leaf photo keeps one consistent picture size. Steps through
 * every photo in the current location, not just the item you opened — by the
 * arrow buttons, the arrow keys, or a sideways swipe or drag on the photo.
 */
const PhotoViewer = ({ entries, index, onStep, onClose, onOpenContainer }) => {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  // How far the photo is being dragged sideways, so it follows the finger.
  const [dragX, setDragX] = useState(0);
  const drag = useRef(null);

  const entry = entries[index];
  if (!entry) return null;

  const { src, item } = entry;
  const many = entries.length > 1;

  const onPointerDown = (e) => {
    if (!many || !e.isPrimary || e.button > 0) return;
    // The close and arrow buttons keep their own clicks.
    if (e.target.closest('button')) return;
    drag.current = { id: e.pointerId, x: e.clientX };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setDragX(e.clientX - drag.current.x);
  };

  const endDrag = (e, commit) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    drag.current = null;
    setDragX(0);
    // Swiping left pulls the next photo in, like turning a page.
    if (commit && Math.abs(dx) >= SWIPE_MIN_PX) onStep(dx < 0 ? 1 : -1);
  };

  return (
    <div className="photo-viewer-wrap">
      <div
        className={`container-canvas photo-viewer${many ? ' photo-viewer-swipeable' : ''}`}
        style={{ aspectRatio: String(ratio) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
      >
        <div
          className={`photo-viewer-slide${dragX ? ' photo-viewer-slide-dragging' : ''}`}
          style={{ transform: `translateX(${dragX}px)` }}
        >
          {src ? (
            <DriveImage
              src={src}
              alt={item.name}
              className="photo-viewer-img"
              draggable={false}
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
        </div>

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
