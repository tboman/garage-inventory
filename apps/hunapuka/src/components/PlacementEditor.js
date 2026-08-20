import React, { useMemo, useRef, useState } from 'react';
import ContainerCanvas from './ContainerCanvas';
import DriveImage from './DriveImage';

const DRAG_THRESHOLD_PX = 3;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Manage-mode surface for arranging one container's children onto its photo.
 * Drag from the tray onto the canvas to place; drag a pin off the canvas to
 * send it back to the tray.
 */
const PlacementEditor = ({ container, allItems, onPlace, onUnplace, onClose }) => {
  const canvasRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const containerId = container ? container.id : null;

  const childCounts = useMemo(() => {
    const counts = new Map();
    for (const item of allItems) {
      if (item.locationId == null) continue;
      counts.set(item.locationId, (counts.get(item.locationId) || 0) + 1);
    }
    return counts;
  }, [allItems]);

  const children = useMemo(
    () => allItems
      .filter(i => i.locationId === containerId)
      .sort((a, b) => a.order - b.order)
      .map(i => ({ ...i, childCount: childCounts.get(i.id) || 0 })),
    [allItems, containerId, childCounts]
  );

  const placed = children.filter(i => i.x != null && i.y != null);
  const unplaced = children.filter(i => i.x == null || i.y == null);
  const backdrop = container && container.photos && container.photos.length > 0
    ? container.photos[0]
    : null;

  const beginDrag = (e, item) => {
    e.preventDefault();
    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDrag({
      item,
      pointerId: e.pointerId,
      origin: { x: e.clientX, y: e.clientY },
      point: { x: e.clientX, y: e.clientY },
      moved: false,
    });
  };

  const continueDrag = (e) => {
    setDrag(d => {
      if (!d || d.pointerId !== e.pointerId) return d;
      const moved = d.moved
        || Math.abs(e.clientX - d.origin.x) > DRAG_THRESHOLD_PX
        || Math.abs(e.clientY - d.origin.y) > DRAG_THRESHOLD_PX;
      return { ...d, point: { x: e.clientX, y: e.clientY }, moved };
    });
  };

  const endDrag = (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const { item, moved } = drag;
    setDrag(null);
    // A tap that never moved is not a placement gesture; leave the item alone.
    if (!moved) return;

    const rect = canvasRef.current && canvasRef.current.getBoundingClientRect();
    if (!rect) return;

    const inside = e.clientX >= rect.left && e.clientX <= rect.right
      && e.clientY >= rect.top && e.clientY <= rect.bottom;

    if (inside) {
      onPlace(item.id, clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height));
    } else if (item.x != null) {
      onUnplace(item.id);
    }
  };

  const dragHandlers = {
    onPointerMove: continueDrag,
    onPointerUp: endDrag,
    onPointerCancel: () => setDrag(null),
  };

  return (
    <div className="placement-editor">
      <div className="d-flex align-items-center gap-2 mb-2">
        <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>
          <i className="fas fa-arrow-left me-1"></i>Back to list
        </button>
        <strong className="ms-1">{container ? container.name : 'Top level'}</strong>
        <span className="text-muted small ms-auto">{placed.length} of {children.length} placed</span>
      </div>

      {!backdrop && container && (
        <div className="alert alert-light border py-2 px-3 small mb-2">
          <i className="fas fa-camera me-2 text-muted"></i>
          Add a photo to <strong>{container.name}</strong> and it becomes the backdrop here.
        </div>
      )}

      <ContainerCanvas
        backdrop={backdrop}
        pins={placed}
        canvasRef={canvasRef}
        draggingId={drag ? drag.item.id : null}
        onPinPointerDown={beginDrag}
        onPinPointerMove={continueDrag}
        onPinPointerUp={endDrag}
        hint="Drag items up here from below"
      />

      <div className="placement-tray mt-3">
        <div className="placement-tray-title">
          {unplaced.length === 0
            ? 'Everything here is placed. Drag a pin off the canvas to bring it back.'
            : `Not placed yet (${unplaced.length}) — drag onto the canvas above`}
        </div>
        {unplaced.length > 0 && (
          <div className="placement-tray-items">
            {unplaced.map(item => (
              <button
                key={item.id}
                type="button"
                className={`tray-tile${drag && drag.item.id === item.id ? ' tray-tile-dragging' : ''}`}
                title={item.name}
                onPointerDown={(e) => beginDrag(e, item)}
                {...dragHandlers}
              >
                <span className="tray-tile-thumb">
                  {item.photos && item.photos.length > 0 ? (
                    <DriveImage src={item.photos[0]} alt={item.name} />
                  ) : (
                    <i className="fas fa-box"></i>
                  )}
                  {item.childCount > 0 && <span className="canvas-pin-count">{item.childCount}</span>}
                </span>
                <span className="tray-tile-label">{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {drag && drag.moved && (
        <div
          className="drag-ghost"
          style={{ left: drag.point.x, top: drag.point.y }}
        >
          {drag.item.photos && drag.item.photos.length > 0 ? (
            <DriveImage src={drag.item.photos[0]} alt="" />
          ) : (
            <i className="fas fa-box"></i>
          )}
        </div>
      )}
    </div>
  );
};

export default PlacementEditor;
