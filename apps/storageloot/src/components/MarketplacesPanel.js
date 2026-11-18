import { useState, useEffect } from 'react';
import {
  getMarketplaces, saveMarketplace, MARKETPLACES, MARKETPLACE_STATUSES,
} from '../messagesApi';

// Seller tools: where this item is (or will be) listed beyond StorageLoot.
// Placeholders for now; assisted listing on each marketplace comes later.
export default function MarketplacesPanel({ listingId }) {
  const [records, setRecords] = useState({});
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getMarketplaces(listingId)
      .then((r) => { setRecords(r); setLoading(false); })
      .catch((e) => { setMsg({ type: 'danger', text: e.message }); setLoading(false); });
  }, [listingId]);

  const draftFor = (p) => drafts[p] || {
    status: records[p]?.status || '',
    url: records[p]?.url || '',
  };
  const setDraft = (p, patch) => setDrafts((d) => ({ ...d, [p]: { ...draftFor(p), ...patch } }));

  const handleSave = async (p) => {
    const d = draftFor(p);
    if (!d.status) return setMsg({ type: 'danger', text: `Choose a status for ${MARKETPLACES[p]}.` });
    if (d.url && !/^https:\/\/\S+$/.test(d.url.trim())) {
      return setMsg({ type: 'danger', text: 'The link must start with https://' });
    }
    setSaving(p);
    setMsg(null);
    try {
      await saveMarketplace(listingId, p, { ...records[p], ...d }, !!records[p]);
      setRecords((r) => ({ ...r, [p]: { ...r[p], ...d } }));
      setDrafts((all) => { const { [p]: _, ...rest } = all; return rest; });
      setMsg({ type: 'success', text: `${MARKETPLACES[p]} saved.` });
    } catch (e) {
      setMsg({ type: 'danger', text: e.message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="border rounded p-3 mb-3">
      <h6 className="fw-semibold mb-1">Sell on more marketplaces</h6>
      <p className="small text-muted mb-2">
        StorageLoot integrates with eBay, Nextdoor, Facebook Marketplace and Craigslist.
        Assisted listing is coming soon. For now, track where this item is listed.
      </p>
      {loading ? (
        <div className="small text-muted">Loading...</div>
      ) : (
        Object.entries(MARKETPLACES).map(([p, label]) => {
          const record = records[p];
          const d = draftFor(p);
          const changed = !!drafts[p];
          return (
            <div key={p} className="border-top pt-2 mt-2">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-semibold small">{label}</span>
                {record?.requestCount > 0 && (
                  <span className="badge bg-warning text-dark">
                    {record.requestCount} buyer request{record.requestCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="d-flex gap-2 flex-wrap">
                <select
                  className="form-select form-select-sm"
                  style={{ maxWidth: 190 }}
                  aria-label={`${label} status`}
                  value={d.status}
                  onChange={(e) => setDraft(p, { status: e.target.value })}
                >
                  <option value="">Not listed</option>
                  {Object.entries(MARKETPLACE_STATUSES).map(([s, text]) => (
                    <option key={s} value={s}>{text}</option>
                  ))}
                </select>
                <input
                  type="url"
                  className="form-control form-control-sm flex-grow-1"
                  style={{ minWidth: 160 }}
                  placeholder="Link to the listing (https://...)"
                  aria-label={`${label} link`}
                  value={d.url}
                  onChange={(e) => setDraft(p, { url: e.target.value })}
                />
                <button
                  className="btn btn-sl btn-sm"
                  onClick={() => handleSave(p)}
                  disabled={!changed || saving === p}
                >
                  {saving === p ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          );
        })
      )}
      {msg && <div className={`alert alert-${msg.type} py-1 px-2 mt-2 mb-0 small`}>{msg.text}</div>}
    </div>
  );
}
