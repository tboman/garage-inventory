import { useRef, useState } from 'react';

// A sideways drag has to travel this far before it counts as a swipe.
const SWIPE_MIN_PX = 50;
// Below this the pointer is treated as a tap, not a drag.
const TAP_SLOP_PX = 10;

/**
 * Sideways swipe (touch) or drag (mouse) to step through a list. Spread
 * `handlers` on the element that should respond; `dragX` is the live offset so
 * the content can follow the finger. `moved.current` stays true through the
 * click that follows a drag, so a backdrop can tell a swipe from a tap.
 */
export default function useSwipe(onStep, enabled = true) {
  const [dragX, setDragX] = useState(0);
  const drag = useRef(null);
  const moved = useRef(false);

  const onPointerDown = (e) => {
    moved.current = false;
    if (!enabled || !e.isPrimary || e.button > 0) return;
    // Buttons inside the swipe area keep their own clicks.
    if (e.target.closest('button')) return;
    drag.current = { id: e.pointerId, x: e.clientX };
  };

  const onPointerMove = (e) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > TAP_SLOP_PX) moved.current = true;
    setDragX(dx);
  };

  const end = (e, commit) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dx = e.clientX - drag.current.x;
    drag.current = null;
    setDragX(0);
    // Swiping left pulls the next one in, like turning a page.
    if (commit && Math.abs(dx) >= SWIPE_MIN_PX) onStep(dx < 0 ? 1 : -1);
  };

  return {
    dragX,
    moved,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => end(e, true),
      onPointerCancel: (e) => end(e, false),
      // A mouse that leaves mid-drag would never deliver its pointerup here.
      onPointerLeave: (e) => { if (e.pointerType === 'mouse') end(e, true); },
    },
  };
}
