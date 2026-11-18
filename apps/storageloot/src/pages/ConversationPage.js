import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  subscribeConversation, subscribeMessages, sendReply, markRead, respondToOffer,
  isUnread, formatCents, MARKETPLACES, TEXT_MAX,
} from '../messagesApi';

const OFFER_STATUS = {
  pending: { label: 'Waiting for the seller', cls: 'bg-secondary' },
  accepted: { label: 'Accepted', cls: 'bg-success' },
  declined: { label: 'Declined', cls: 'bg-danger' },
};

function MessageBody({ message, isSeller, conversation, onRespond, responding }) {
  if (message.kind === 'offer') {
    const status = OFFER_STATUS[message.offerStatus] || OFFER_STATUS.pending;
    return (
      <>
        <div>
          <strong>Offer: {formatCents(message.offerAmount, message.currency)}</strong>{' '}
          <span className={`badge ${status.cls}`}>{status.label}</span>
        </div>
        {message.text && <div className="mt-1" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>}
        {isSeller && message.offerStatus === 'pending' && (
          <div className="d-flex gap-2 mt-2">
            <button className="btn btn-success btn-sm" disabled={responding} onClick={() => onRespond(message.id, true)}>
              Accept
            </button>
            <button className="btn btn-outline-danger btn-sm" disabled={responding} onClick={() => onRespond(message.id, false)}>
              Decline
            </button>
          </div>
        )}
      </>
    );
  }
  if (message.kind === 'listing_request') {
    return (
      <>
        <div><strong>Asked you to list this on {MARKETPLACES[message.platform] || message.platform}</strong></div>
        {message.text && <div className="mt-1" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>}
        {isSeller && (
          <div className="small mt-1">
            Tracked under <Link to={`/listing/${conversation.listingId}`}>Sell on more marketplaces</Link> on your listing.
          </div>
        )}
      </>
    );
  }
  return <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>;
}

export default function ConversationPage() {
  const { id } = useParams();
  // Google accounts and guests alike.
  const { me: user, login, loading: authLoading } = useAuth();
  const [conversation, setConversation] = useState(undefined);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [responding, setResponding] = useState(false);
  const bottom = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    const fail = (e) => setError(e.message);
    const stopConvo = subscribeConversation(id, setConversation, (e) => { setConversation(null); fail(e); });
    const stopMessages = subscribeMessages(id, setMessages, fail);
    return () => { stopConvo(); stopMessages(); };
  }, [id, user]);

  // Opening the conversation, or a new message arriving while it is open, marks it read.
  useEffect(() => {
    if (user && conversation && isUnread(conversation, user.uid)) {
      markRead(conversation, user).catch(() => {});
    }
  }, [conversation, user]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  if (authLoading) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>;
  }
  if (!user) {
    return (
      <div className="container py-5 text-center">
        <h2>Sign in to see this conversation</h2>
        <button className="btn btn-sl btn-lg" onClick={login}>Sign in with Google</button>
      </div>
    );
  }
  if (conversation === undefined) {
    return <div className="loading-spinner"><div className="spinner-border text-secondary" /></div>;
  }
  if (conversation === null) {
    return (
      <div className="container py-5 text-center">
        <h2>Conversation not found</h2>
        <Link to="/messages" className="btn btn-sl mt-3">Back to messages</Link>
      </div>
    );
  }

  const isSeller = user.uid === conversation.sellerId;
  const other = isSeller ? conversation.buyerDisplayName : conversation.sellerDisplayName;

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendReply(conversation, user, reply);
      setReply('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleRespond = async (messageId, accepted) => {
    setResponding(true);
    setError(null);
    try {
      await respondToOffer(conversation.id, messageId, accepted);
    } catch (err) {
      setError(err.message);
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 820 }}>
      <Link to="/messages" className="text-decoration-none text-muted mb-3 d-inline-block">&larr; All messages</Link>
      <div className="d-flex align-items-center gap-3 mb-3">
        {conversation.listingPhoto && (
          <img src={conversation.listingPhoto} alt="" width={56} height={56} style={{ objectFit: 'cover' }} className="rounded" />
        )}
        <div>
          <h4 className="fw-bold mb-0">
            <Link to={`/listing/${conversation.listingId}`} className="text-reset">{conversation.listingTitle}</Link>
          </h4>
          <div className="text-muted small">
            {isSeller ? `Buyer: ${other}` : `Seller: ${other}`}
            {isSeller && conversation.buyerGuest && (
              <span
                className="badge bg-secondary ms-2"
                title="Wrote without signing in. They see your replies in the browser, or through the agent, they wrote from."
              >
                Guest
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="d-flex flex-column gap-2 mb-3">
        {messages.map((m) => {
          const mine = m.senderId === user.uid;
          return (
            <div key={m.id} className={`d-flex ${mine ? 'justify-content-end' : ''}`}>
              <div className={`border rounded p-2 px-3 ${mine ? 'bg-light' : ''}`} style={{ maxWidth: '80%' }}>
                <div className="small text-muted mb-1">
                  {mine ? 'You' : (m.senderRole === 'seller' ? conversation.sellerDisplayName : conversation.buyerDisplayName)}
                  {m.via === 'agent' && <span className="badge bg-info text-dark ms-1" title="Sent by their AI agent">via agent</span>}
                  {m.createdAt?.toDate && <> · {m.createdAt.toDate().toLocaleString()}</>}
                </div>
                <MessageBody
                  message={m}
                  isSeller={isSeller}
                  conversation={conversation}
                  onRespond={handleRespond}
                  responding={responding}
                />
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <form onSubmit={handleReply} className="d-flex gap-2">
        <textarea
          className="form-control"
          rows={2}
          maxLength={TEXT_MAX}
          placeholder={`Reply to ${other}`}
          aria-label="Reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <button type="submit" className="btn btn-sl align-self-end" disabled={sending || !reply.trim()}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
