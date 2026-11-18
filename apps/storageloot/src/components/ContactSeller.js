import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getMyConversation, sendToSeller, REQUEST_PLATFORMS, MARKETPLACES, TEXT_MAX,
} from '../messagesApi';

const MODES = {
  inquiry: { label: 'Ask a question', placeholder: 'Is it still available? Can I pick it up this weekend?' },
  offer: { label: 'Make an offer', placeholder: 'Optional note to go with your offer' },
  listing_request: { label: 'Ask to list on eBay or Craigslist', placeholder: 'Optional note, e.g. why you would rather buy there' },
};

// Parses "45" or "45.50" into whole cents; null if it is not a positive amount.
function toCents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(parseFloat(value) * 100);
  return cents > 0 ? cents : null;
}

// The buyer's way to reach the seller from a listing page. `user` is whoever
// is signed in, a Google account or a guest. Nobody signed in can still send:
// the first message makes them a guest (startGuest), kept by a cookie.
export default function ContactSeller({ listing, user, login, startGuest }) {
  const [mode, setMode] = useState('inquiry');
  const [text, setText] = useState('');
  const [offer, setOffer] = useState('');
  const [platform, setPlatform] = useState(REQUEST_PLATFORMS[0]);
  const [guestName, setGuestName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    if (!user) return;
    getMyConversation(listing.id, user.uid).then(setExisting).catch(() => setExisting(null));
  }, [listing.id, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const draft = { kind: mode, text };
    if (mode === 'inquiry' && !text.trim()) return setError('Write your question first.');
    if (mode === 'offer') {
      const cents = toCents(offer);
      if (!cents) return setError('Enter an offer amount, like 40 or 39.50.');
      draft.offerAmount = cents;
      draft.currency = listing.currency || 'USD';
    }
    if (mode === 'listing_request') draft.platform = platform;
    setSending(true);
    try {
      const sender = user || (await startGuest());
      if (!sender) throw new Error('Could not start a guest session. Try again, or sign in with Google.');
      const id = await sendToSeller(listing, sender, draft, { guestName });
      setSentTo(id);
      setText('');
      setOffer('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const conversationLink = sentTo || existing?.id;

  return (
    <div className="border rounded p-3 mb-3">
      <h6 className="fw-semibold mb-2">Contact the seller</h6>

      {conversationLink && (
        <div className={`alert ${sentTo ? 'alert-success' : 'alert-light border'} py-2 px-3 small`}>
          {sentTo ? 'Sent. ' : 'You have already written to this seller. '}
          <Link to={`/messages/${conversationLink}`}>Open the conversation</Link>
        </div>
      )}

      <div className="btn-group btn-group-sm mb-2 flex-wrap" role="group" aria-label="What to send">
        {Object.entries(MODES).map(([key, m]) => (
          <button
            key={key}
            type="button"
            className={`btn ${mode === key ? 'btn-dark' : 'btn-outline-dark'}`}
            onClick={() => { setMode(key); setError(null); }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {mode === 'offer' && (
          <div className="input-group input-group-sm mb-2">
            <span className="input-group-text">$</span>
            <input
              type="text"
              inputMode="decimal"
              className="form-control"
              placeholder="Your offer"
              aria-label="Offer amount"
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
            />
          </div>
        )}
        {mode === 'listing_request' && (
          <select
            className="form-select form-select-sm mb-2"
            aria-label="Marketplace"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            {REQUEST_PLATFORMS.map((p) => (
              <option key={p} value={p}>{MARKETPLACES[p]}</option>
            ))}
          </select>
        )}
        {!user && (
          <input
            type="text"
            className="form-control form-control-sm mb-2"
            placeholder="Your name (optional)"
            aria-label="Your name"
            maxLength={100}
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
        )}
        <textarea
          className="form-control form-control-sm mb-2"
          rows={3}
          maxLength={TEXT_MAX}
          placeholder={MODES[mode].placeholder}
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <div className="alert alert-danger py-1 px-2 small">{error}</div>}
        <button type="submit" className="btn btn-sl btn-sm" disabled={sending}>
          {sending ? 'Sending...' : 'Send to seller'}
        </button>
      </form>
      {!user && (
        <p className="small text-muted mt-2 mb-0">
          No account needed: you will write as a guest, and the seller&apos;s replies appear under Messages
          in this browser. Or{' '}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={login}>
            sign in with Google
          </button>{' '}
          to keep them with your account.
        </p>
      )}
    </div>
  );
}
