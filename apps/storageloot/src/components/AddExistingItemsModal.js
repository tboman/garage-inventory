import { useEffect, useState } from 'react';
import { getMyListings, updateListing } from '../api';

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

export default function AddExistingItemsModal({ userId, groupId, onClose, onAdded }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMyListings(userId)
      .then(all => {
        if (!active) return;
        setListings(all.filter(l => !l.groupId));
      })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        Array.from(selected).map(id => updateListing(id, { groupId }))
      );
      onAdded?.();
      onClose();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="sl-modal-overlay" onClick={onClose}>
      <div className="sl-modal" onClick={e => e.stopPropagation()}>
        <div className="sl-modal-header">
          <h5 className="mb-0 fw-bold">Add existing items to this group</h5>
          <button className="btn-close" onClick={onClose} aria-label="Close"></button>
        </div>
        <div className="sl-modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          {loading ? (
            <div className="loading-spinner">
              <div className="spinner-border text-secondary" role="status" />
            </div>
          ) : listings.length === 0 ? (
            <p className="text-muted mb-0 text-center py-3">You have no unassigned listings.</p>
          ) : (
            <div className="sl-modal-list">
              {listings.map(l => (
                <label key={l.id} className="sl-modal-row">
                  <input
                    type="checkbox"
                    className="form-check-input me-3"
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                  {l.photos?.[0] ? (
                    <img src={l.photos[0]} alt="" className="sl-modal-thumb" />
                  ) : (
                    <div className="sl-modal-thumb sl-modal-thumb-empty">?</div>
                  )}
                  <div className="flex-grow-1">
                    <div className="fw-semibold">{l.title}</div>
                    <div className="text-muted small">{formatPrice(l.price)} · {l.status}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="sl-modal-footer">
          <button className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-sl"
            onClick={handleAdd}
            disabled={saving || selected.size === 0}
          >
            {saving ? 'Adding...' : `Add ${selected.size || ''} item${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
