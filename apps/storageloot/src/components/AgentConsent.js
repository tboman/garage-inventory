import React from 'react';
import { GoogleAuthProvider, signInWithPopup, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { auth } from '../firebase';

// The parts the two agent sign-in pages share: AgentAuthorizePage, which an
// agent redirects the person to, and AgentDevicePage, where the person types
// a code the agent showed them. Both ask the same question in the same words.

export const AgentShell = ({ children }) => (
  <div className="container py-5" style={{ maxWidth: 520 }}>
    <div className="text-muted small mb-3">
      StorageLoot
    </div>
    {children}
  </div>
);

// Signs in for identity only (basic Google profile). Resolves to a message to
// show when sign-in failed, or null.
export async function signInToDecide() {
  try {
    // A guest signs in in memory only (guestApi.js); a Google account is kept.
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, new GoogleAuthProvider());
    return null;
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      return null;
    }
    return `Sign-in failed: ${err.message}`;
  }
}

// How to refer to the agent mid-sentence. An agent that came through a code
// and did not prove who it is has no name and no address to stand in for one.
export const agentName = (client) => client.name || 'this agent';

// Who is asking, and whether to believe it. `userCode` is set on the code
// page, where the person should check it against what their agent shows.
export const AgentIntro = ({ client, userCode }) => (
  <>
    <div className="d-flex align-items-center gap-3 mb-3">
      {client.logo_uri && (
        <img
          src={client.logo_uri}
          alt=""
          width="48"
          height="48"
          referrerPolicy="no-referrer"
          style={{ borderRadius: 8, objectFit: 'contain' }}
        />
      )}
      <h1 className="h4 mb-0">
        {client.name || 'An agent'} wants to connect to your StorageLoot account
      </h1>
    </div>

    {client.verified === false ? (
      <div className="alert alert-danger py-2 small">
        <strong>This agent has not proved who it is.</strong> StorageLoot could not confirm
        which agent is asking. If you allow it, access goes to{' '}
        {client.domain ? (
          <>
            whoever controls <strong className="text-break">{client.domain}</strong>. Only
            continue if you recognise that address.
          </>
        ) : (
          <>
            whoever started this request, which may not be the person who gave you the
            code. Only continue if the code came from an agent you are using yourself.
          </>
        )}
      </div>
    ) : (
      <p className="mb-1">
        This request comes from <strong className="text-break">{client.domain}</strong>.
      </p>
    )}
    <div className="alert alert-warning py-2 small">
      {userCode ? (
        <>
          Only continue if you asked {agentName(client)} to do this just now, and it is
          showing you the code <strong className="text-nowrap">{userCode}</strong>. If
          not, choose Cancel.
        </>
      ) : (
        <>
          Only continue if you asked {agentName(client)} to do this just now. If you did
          not, choose Cancel.
        </>
      )}
    </div>
  </>
);

// The account, what the agent asks for, and the answer. Everything asked for
// starts ticked; the person can untick any of it.
export const AgentPermissions = ({
  client, scopes, accessDays, user, busy, chosen, onChosen, onLogOut, onAllow, onCancel,
}) => (
  <>
    <div className="border rounded p-3 mb-3 bg-white">
      <div className="text-muted small">Account</div>
      <div className="fw-semibold text-break">{user.email}</div>
      <button className="btn btn-link btn-sm p-0" onClick={onLogOut} disabled={busy}>
        Use a different account
      </button>
    </div>

    <div className="border rounded p-3 mb-3 bg-white">
      <div className="text-muted small mb-2">
        {client.name || 'This agent'} is asking to do the following. Untick anything you
        do not want to allow.
      </div>
      {scopes.map(scope => (
        <div className="form-check mb-2" key={scope.name}>
          <input
            className="form-check-input"
            type="checkbox"
            id={`scope-${scope.name}`}
            checked={chosen.includes(scope.name)}
            disabled={busy}
            onChange={e => onChosen(prev => (
              e.target.checked ? [...prev, scope.name] : prev.filter(n => n !== scope.name)
            ))}
          />
          <label className="form-check-label" htmlFor={`scope-${scope.name}`}>
            {scope.hints.changes === 'reversible' && (
              <span className="badge bg-warning text-dark me-1">Makes changes</span>
            )}
            {scope.hints.changes === 'irreversible' && (
              <span className="badge bg-danger me-1">Cannot be undone</span>
            )}
            {scope.description}
          </label>
        </div>
      ))}
    </div>

    <p className="text-muted small">
      Access lasts until you disconnect {agentName(client)} under Messages, or ends by
      itself after {accessDays} days without use.
    </p>

    <div className="d-flex gap-2">
      <button
        className="btn btn-primary"
        onClick={onAllow}
        disabled={busy || chosen.length === 0}
      >
        Allow
      </button>
      <button className="btn btn-outline-secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  </>
);
