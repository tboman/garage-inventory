import React, { useEffect, useMemo, useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { describeAgentRequest, decideAgentRequest } from '../poppyApi';

// The consent page a personal AI agent opens at /oauth/authorize (Personal
// Agent Protocol, Direct Sign-In). The person signs in with Google here, on
// our own page, and decides what the agent may do with their inventory. The
// server re-checks the whole request when the decision is posted, so nothing
// shown here is trusted on the way back.
const AgentAuthorizePage = () => {
  const { user, authLoading, logOut } = useAuth();
  const request = useMemo(
    () => Object.fromEntries(new URLSearchParams(window.location.search)),
    []
  );
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Scope names the person has ticked. Everything asked for starts ticked.
  const [chosen, setChosen] = useState([]);

  useEffect(() => {
    let cancelled = false;
    describeAgentRequest(request)
      .then(result => {
        if (cancelled) return;
        if (result.redirect) window.location.replace(result.redirect);
        else if (result.error) setError(result.error);
        else {
          setInfo(result);
          setChosen(result.scopes.map(s => s.name));
        }
      })
      .catch(() => {
        if (!cancelled) setError('This connection request could not be checked. Try again from your agent.');
      });
    return () => { cancelled = true; };
  }, [request]);

  const signIn = async () => {
    setBusy(true);
    try {
      // Identity only. The app's usual provider also asks for Google Drive
      // access for photos, which connecting an agent never needs.
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError(`Sign-in failed: ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approve) => {
    setBusy(true);
    try {
      const result = await decideAgentRequest(request, approve, chosen);
      if (result.redirect) {
        window.location.assign(result.redirect);
        return;
      }
      setError(result.error || 'Something went wrong.');
    } catch (err) {
      setError(`Could not finish: ${err.message}`);
    }
    setBusy(false);
  };

  const shell = (children) => (
    <div className="container py-5" style={{ maxWidth: 520 }}>
      <div className="text-muted small mb-3">
        <i className="fas fa-box-open me-1"></i>HunaPuka
      </div>
      {children}
    </div>
  );

  if (error) {
    return shell(
      <>
        <h1 className="h4 mb-3">This agent cannot be connected</h1>
        <div className="alert alert-danger">{error}</div>
        <p className="text-muted small">Nothing was shared. You can close this page.</p>
      </>
    );
  }
  if (!info || authLoading) {
    return shell(<div className="text-muted">Checking the request...</div>);
  }

  const { client, scopes, access_days: accessDays } = info;
  return shell(
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
        <h1 className="h4 mb-0">{client.name} wants to connect to your HunaPuka inventory</h1>
      </div>

      <p className="mb-1">
        This request comes from <strong className="text-break">{client.domain}</strong>.
      </p>
      <div className="alert alert-warning py-2 small">
        Only continue if you asked {client.name} to do this just now. If you did not, choose Cancel.
      </div>

      {!user ? (
        <>
          <p className="text-muted small">Sign in to choose what {client.name} can see.</p>
          <div className="d-flex gap-2">
            <button className="btn btn-dark" onClick={signIn} disabled={busy}>
              <i className="fab fa-google me-2"></i>Sign in with Google
            </button>
            <button className="btn btn-outline-secondary" onClick={() => decide(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="border rounded p-3 mb-3 bg-white">
            <div className="text-muted small">Account</div>
            <div className="fw-semibold text-break">{user.email}</div>
            <button className="btn btn-link btn-sm p-0" onClick={logOut} disabled={busy}>
              Use a different account
            </button>
          </div>

          <div className="border rounded p-3 mb-3 bg-white">
            <div className="text-muted small mb-2">
              {client.name} is asking to do the following. Untick anything you do not want to allow.
            </div>
            {scopes.map(scope => (
              <div className="form-check mb-2" key={scope.name}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`scope-${scope.name}`}
                  checked={chosen.includes(scope.name)}
                  disabled={busy}
                  onChange={e => setChosen(prev => (
                    e.target.checked ? [...prev, scope.name] : prev.filter(n => n !== scope.name)
                  ))}
                />
                <label className="form-check-label" htmlFor={`scope-${scope.name}`}>
                  {scope.hints.changes !== 'none' && (
                    <span className="badge bg-warning text-dark me-1">Makes changes</span>
                  )}
                  {scope.description}
                </label>
              </div>
            ))}
          </div>

          <p className="text-muted small">
            Access lasts until you disconnect {client.name} under Sharing, or ends by itself
            after {accessDays} days without use.
          </p>

          <div className="d-flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => decide(true)}
              disabled={busy || chosen.length === 0}
            >
              Allow
            </button>
            <button className="btn btn-outline-secondary" onClick={() => decide(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );
};

export default AgentAuthorizePage;
