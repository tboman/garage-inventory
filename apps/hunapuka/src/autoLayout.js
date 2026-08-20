// Children without explicit coordinates still need somewhere to sit, so a
// container opens ready to rearrange rather than empty. These positions are
// derived on every render and never written to Firestore: x/y === null keeps
// meaning "automatic", so auto items reflow as siblings come and go, and only a
// deliberate drag commits a real coordinate.

// Fraction of the canvas an auto slot must keep clear of a hand-placed pin.
const MIN_SEPARATION = 0.1;

function gridPositions(count) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: (c + 0.5) / cols, y: (r + 0.5) / rows });
    }
  }
  return out;
}

function collidesWithExplicit(point, explicit) {
  return explicit.some(e =>
    Math.abs(e.x - point.x) < MIN_SEPARATION && Math.abs(e.y - point.y) < MIN_SEPARATION);
}

/**
 * Gives every child an x/y so the whole set can be rendered on the canvas.
 * Returns items in the order given, each tagged with `isAuto` so callers can
 * tell a derived position from one the user chose.
 */
export function resolvePlacements(children) {
  const explicit = children.filter(c => c.x != null && c.y != null);
  const autos = children.filter(c => c.x == null || c.y == null);

  if (autos.length === 0) {
    return children.map(c => ({ ...c, isAuto: false }));
  }

  // Size the grid for everyone, so dropping cells near hand-placed pins still
  // leaves enough room for the items that need a slot.
  const grid = gridPositions(autos.length + explicit.length);
  const free = grid.filter(p => !collidesWithExplicit(p, explicit));
  const slots = free.length >= autos.length ? free : grid;

  const assigned = new Map();
  autos.forEach((child, i) => {
    assigned.set(child.id, slots[i % slots.length]);
  });

  return children.map(c => {
    const slot = assigned.get(c.id);
    return slot
      ? { ...c, x: slot.x, y: slot.y, isAuto: true }
      : { ...c, isAuto: false };
  });
}
