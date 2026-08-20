import React, { useMemo, useRef, useState } from 'react';
import ContainerCanvas from './ContainerCanvas';
import DriveImage from './DriveImage';
import { resolvePlacements } from '../autoLayout';

const DRAG_THRESHOLD_PX = 3;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Manage-mode surface for arranging one container's children on its photo.
 * Everything inside starts on the canvas at a derived position, so this opens
 * ready to rearrange. Dragging commits a real coordinate; dragging off the
 * canvas resets an item to its automatic slot. Tapping a container without
 * dragging descends into it, so the whole tree is walkable from here.
 */
const PlacementEditor = ({ container, allItems, onPlace, onUnplace, onNavigate, onClose }) => {
  const canvasRef = useRef(null);
  // The gesture lives in a ref as well as state: pointerdown and pointerup can
  // land in the same tick (a fast tap, or a synthetic click), and a handler
  // reading only state would still see the pre-drag closure and drop the tap.
  const dragRef = useRef(null);
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

  const trail = useMemo(() => {
    const out = [];
    let id = containerId;
    while (id != null) {
      // eslint-disable-next-line no-loop-func
      const item = allItems.find(i => i.id === id);
      if (!item) break;
      out.unshift(item);
      id = item.locationId;
    }
    return out;
  }, [containerId, allItems]);

  const pins = useMemo(() => {
    const children = allItems
      .filter(i => i.locationId === containerId)
      .sort((a, b) => a.order - b.order)
      .map(i => ({ ...i, childCount: childCounts.get(i.id) || 0 }));
    return resolvePlacements(children);
  }, [allItems, containerId, childCounts]);

  const arrangedCount = pins.filter(p => !p.isAuto).length;
  const backdrop = container && container.photos && container.photos.length > 0
    ? container.photos[0]
    : null;

  const beginDrag = (e, item) => {
    e.preventDefault();
    try {
      // Throws NotFoundError if the pointer is already gone by the time this
      // runs; capture is an optimisation, so never let it kill the gesture.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no capture; pointer events still reach the document */
    }
    const next = {
      item,
      pointerId: e.pointerId,
      origin: { x: e.clientX, y: e.clientY },
      point: { x: e.clientX, y: e.clientY },
      moved: false,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const continueDrag = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const moved = d.moved
      || Math.abs(e.clientX - d.origin.x) > DRAG_THRESHOLD_PX
      || Math.abs(e.clientY - d.origin.y) > DRAG_THRESHOLD_PX;
    const next = { ...d, point: { x: e.clientX, y: e.clientY }, moved };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const { item, moved } = d;
    dragRef.current = null;
    setDrag(null);

    // A press that never moved is a tap, not a placement: descend into it.
    if (!moved) {
      if (item.childCount > 0) onNavigate(item.id);
      return;
    }

    const rect = canvasRef.current && canvasRef.current.getBoundingClientRect();
    if (!rect) return;

    const inside = e.clientX >= rect.left && e.clientX <= rect.right
      && e.clientY >= rect.top && e.clientY <= rect.bottom;

    if (inside) {
      onPlace(item.id, clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height));
    } else if (!item.isAuto) {
      // Dragged off the canvas: hand the item back to automatic positioning.
      onUnplace(item.id);
    }
  };

  const cancelDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const titleFor = (item) => (
    item.childCount > 0 ? `${item.name} - tap to open, drag to move` : item.name
  );

  return (
    <div className="placement-editor">
      <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
        <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>
          <i className="fas fa-list me-1"></i>Back to list
        </button>
        <nav className="crumbs">
          <button className="btn btn-link btn-sm p-0" onClick={() => onNavigate(null)} title="Top level">
            <i className="fas fa-home"></i>
          </button>
          {trail.map((item, idx) => (
            <span key={item.id}>
              <span className="crumb-sep">/</span>
              {idx === trail.length - 1 ? (
                <span className="crumb-current">{item.name}</span>
              ) : (
                <button className="btn btn-link btn-sm p-0" onClick={() => onNavigate(item.id)}>
                  {item.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <span className="text-muted small ms-auto">
          {arrangedCount} of {pins.length} arranged
        </span>
      </div>

      {!backdrop && container && (
        <div className="alert alert-light border py-2 px-3 small mb-2">
          <i className="fas fa-camera me-2 text-muted"></i>
          Add a photo to <strong>{container.name}</strong> and it becomes the backdrop here.
        </div>
      )}

      <ContainerCanvas
        backdrop={backdrop}
        pins={pins}
        canvasRef={canvasRef}
        draggingId={drag ? drag.item.id : null}
        onPinPointerDown={beginDrag}
        onPinPointerMove={continueDrag}
        onPinPointerUp={endDrag}
        onPinPointerCancel={cancelDrag}
        titleFor={titleFor}
        hint="Nothing in here yet"
      />

      <p className="text-muted small mt-2 mb-0">
        Everything inside starts on the canvas; drag to arrange it. Dashed items
        are sitting in automatic slots. Drag one off the canvas to send it back
        to automatic, or tap anything with a count badge to open it.
      </p>

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
