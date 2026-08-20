import React, { useState } from 'react';
import DriveImage from './DriveImage';

// Until the backdrop loads we do not know its shape; 4:3 is a neutral guess.
const DEFAULT_RATIO = 4 / 3;

/**
 * Presentational canvas for one container: an optional photo backdrop with its
 * children pinned onto it at fractional coordinates. Shared by the placement
 * editor and the read-only browser so the two can never drift apart — all
 * interaction is injected by the caller.
 */
const ContainerCanvas = ({
  backdrop,
  pins,
  canvasRef,
  highlightId,
  draggingId,
  onPinClick,
  onPinPointerDown,
  onPinPointerMove,
  onPinPointerUp,
  onPinPointerCancel,
  titleFor,
  hint,
}) => {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);

  return (
    <div
      ref={canvasRef}
      className={`container-canvas${backdrop ? '' : ' container-canvas-bare'}`}
      style={{ aspectRatio: String(ratio) }}
    >
      {backdrop && (
        <DriveImage
          src={backdrop}
          alt=""
          className="container-canvas-backdrop"
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.target;
            // Matching the canvas to the photo keeps object-fit from letterboxing,
            // which would otherwise shift every pin away from the pixel it marks.
            if (w && h) setRatio(w / h);
          }}
        />
      )}

      {hint && pins.length === 0 && <div className="container-canvas-hint">{hint}</div>}

      {pins.map(item => (
        <button
          key={item.id}
          type="button"
          className={
            'canvas-pin' +
            (highlightId === item.id ? ' canvas-pin-highlight' : '') +
            (draggingId === item.id ? ' canvas-pin-dragging' : '') +
            (onPinPointerDown ? ' canvas-pin-draggable' : '') +
            (item.isAuto ? ' canvas-pin-auto' : '')
          }
          style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
          title={titleFor ? titleFor(item) : item.name}
          onClick={onPinClick ? () => onPinClick(item) : undefined}
          onPointerDown={onPinPointerDown ? (e) => onPinPointerDown(e, item) : undefined}
          onPointerMove={onPinPointerMove}
          onPointerUp={onPinPointerUp}
          onPointerCancel={onPinPointerCancel}
        >
          <span className="canvas-pin-thumb">
            {item.photos && item.photos.length > 0 ? (
              <DriveImage src={item.photos[0]} alt={item.name} />
            ) : (
              <i className="fas fa-box"></i>
            )}
            {item.childCount > 0 && <span className="canvas-pin-count">{item.childCount}</span>}
          </span>
          <span className="canvas-pin-label">{item.name}</span>
        </button>
      ))}
    </div>
  );
};

export default ContainerCanvas;
