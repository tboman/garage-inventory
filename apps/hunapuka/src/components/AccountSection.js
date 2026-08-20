import React, { useEffect, useState } from 'react';
import { fetchSharedEmails, saveSharedEmails } from '../api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Rules read this whole list on every access check, so keep it small.
const MAX_SHARES = 50;

const AccountSection = ({ user, onError }) => {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSharedEmails()
      .then(list => { if (!cancelled) setEmails(list); })
      .catch(err => onError(`Failed to load sharing list: ${err.message}`))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onError]);

  const persist = async (next, snapshot) => {
    setSaving(true);
    try {
      await saveSharedEmails(next);
    } catch (err) {
      setEmails(snapshot);
      onError(`Failed to save sharing list: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const addEmail = (e) => {
    e.preventDefault();
    setNotice(null);

    const value = input.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setNotice('That does not look like an email address.');
      return;
    }
    if (value === (user.email || '').toLowerCase()) {
      setNotice('That is your own account — you already have access.');
      return;
    }
    if (emails.includes(value)) {
      setNotice('That address is already on the list.');
      return;
    }
    if (emails.length >= MAX_SHARES) {
      setNotice(`You can share with at most ${MAX_SHARES} people.`);
      return;
    }

    const snapshot = emails;
    const next = [...emails, value];
    setEmails(next);
    setInput('');
    persist(next, snapshot);
  };

  const removeEmail = (value) => {
    const snapshot = emails;
    const next = emails.filter(e => e !== value);
    setEmails(next);
    persist(next, snapshot);
  };

  return (
    <div className="account-section">
      <h2 className="h5 mb-3">Account</h2>

      <div className="account-card mb-3">
        <div className="text-muted small">Signed in as</div>
        <div className="fw-semibold">{user.email}</div>
        <div className="text-muted small mt-1">
          This is the address other people add to share their inventory with you.
        </div>
      </div>

      <div className="account-card">
        <h3 className="h6 mb-1">Share my inventory</h3>
        <p className="text-muted small mb-3">
          Anyone listed here can view your whole inventory, read only. They cannot
          add, edit, move, or delete anything. Remove an address to revoke access.
        </p>

        <form onSubmit={addEmail} className="d-flex gap-2 mb-2 flex-wrap">
          <input
            type="email"
            className="form-control form-control-sm flex-grow-1"
            style={{ minWidth: 200 }}
            placeholder="their-google-account@example.com"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm flex-shrink-0"
            disabled={loading || saving || !input.trim()}
          >
            <i className="fas fa-plus me-1"></i>Share
          </button>
        </form>

        {notice && <div className="alert alert-warning py-2 px-3 small">{notice}</div>}

        {loading ? (
          <div className="text-muted small">Loading...</div>
        ) : emails.length === 0 ? (
          <div className="text-muted small fst-italic">
            Not shared with anyone yet.
          </div>
        ) : (
          <ul className="list-group list-group-flush share-list">
            {emails.map(email => (
              <li key={email} className="list-group-item d-flex align-items-center gap-2 px-0">
                <i className="fas fa-user text-muted"></i>
                <span className="flex-grow-1 text-break">{email}</span>
                <button
                  className="btn btn-outline-danger btn-sm flex-shrink-0"
                  onClick={() => removeEmail(email)}
                  disabled={saving}
                  title={`Stop sharing with ${email}`}
                >
                  <i className="fas fa-times"></i>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted small mt-3 mb-0">
          <i className="fas fa-circle-info me-1"></i>
          Item names, descriptions and structure are shared. Photos live in your
          own Google Drive and stay private to you.
        </p>
      </div>
    </div>
  );
};

export default AccountSection;
