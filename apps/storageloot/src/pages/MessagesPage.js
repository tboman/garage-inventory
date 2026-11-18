import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useConversations } from '../hooks/useConversations';
import { isUnread } from '../messagesApi';
import ConnectedAgents from '../components/ConnectedAgents';

function when(ts) {
  const d = ts?.toDate?.();
  if (!d) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString();
}

// The message board: every conversation about the person's listings
// (Selling) and about listings they wrote to (Buying).
export default function MessagesPage() {
  const { user, login, loading: authLoading } = useAuth();
  const { conversations, loading, error } = useConversations(user);
  const [tab, setTab] = useState('selling');

  if (authLoading) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>;
  }
  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to see your messages</h2>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  const selling = conversations.filter((c) => c.sellerId === user.uid);
  const buying = conversations.filter((c) => c.buyerId === user.uid);
  const shown = tab === 'selling' ? selling : buying;
  const unreadIn = (list) => list.filter((c) => isUnread(c, user.uid)).length;

  return (
    <div className="container py-4" style={{ maxWidth: 820 }}>
      <h2 className="fw-bold mb-3">Messages</h2>

      <ul className="nav nav-tabs mb-3">
        {[['selling', 'Selling', selling], ['buying', 'Buying', buying]].map(([key, label, list]) => (
          <li className="nav-item" key={key}>
            <button className={`nav-link ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}
              {unreadIn(list) > 0 && <span className="badge bg-danger ms-2">{unreadIn(list)}</span>}
            </button>
          </li>
        ))}
      </ul>

      {error && <div className="alert alert-danger">{error}</div>}
      {loading ? (
        <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>
      ) : shown.length === 0 ? (
        <p className="text-muted">
          {tab === 'selling'
            ? 'No messages about your listings yet. Questions, offers and listing requests from buyers show up here.'
            : 'You have not written to any sellers yet. Use "Contact the seller" on a listing.'}
        </p>
      ) : (
        <div className="list-group mb-4">
          {shown.map((c) => {
            const unread = isUnread(c, user.uid);
            const other = c.sellerId === user.uid ? c.buyerDisplayName : c.sellerDisplayName;
            return (
              <Link
                key={c.id}
                to={`/messages/${c.id}`}
                className={`list-group-item list-group-item-action d-flex gap-3 align-items-center ${unread ? 'fw-semibold' : ''}`}
              >
                {c.listingPhoto ? (
                  <img src={c.listingPhoto} alt="" width={48} height={48} style={{ objectFit: 'cover' }} className="rounded" />
                ) : (
                  <div className="photo-placeholder rounded" style={{ width: 48, height: 48 }}>&#128247;</div>
                )}
                <div className="flex-grow-1 text-truncate">
                  <div className="d-flex justify-content-between">
                    <span className="text-truncate">{c.listingTitle} · {other}</span>
                    <small className="text-muted ms-2">{when(c.lastMessageAt)}</small>
                  </div>
                  <div className={`small text-truncate ${unread ? '' : 'text-muted'}`}>
                    {c.lastSenderId === user.uid ? 'You: ' : ''}{c.lastMessageText}
                  </div>
                </div>
                {unread && <span className="badge bg-danger rounded-pill">New</span>}
              </Link>
            );
          })}
        </div>
      )}

      <ConnectedAgents user={user} />
    </div>
  );
}
