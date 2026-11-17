import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { describeDeviceRequest, decideDeviceRequest } from '../poppyApi';
import { AgentShell, AgentIntro, AgentPermissions, agentName, signInToDecide } from './AgentConsent';

// The page at /device (Personal Agent Protocol, Device Sign-In). An agent that
// cannot take a browser redirect shows the person this address and a short
// code. They sign in here, on any device, enter the code, and decide what the
// agent may do. Arriving with the code already in the link fills it in and
// looks it up, but never approves: that always takes the Allow button.
const AgentDevicePage = () => {
  const { user, authLoading, logOut } = useAuth();
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get('user_code') || ''
  );
  const [info, setInfo] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState([]);
  // 'approved' or 'declined' once the person has answered.
  const [answer, setAnswer] = useState(null);
  const lookedUpFromLink = useRef(false);

  const lookUp = async (value) => {
    setBusy(true);
    setNotFound(false);
    setProblem(null);
    try {
      const result = await describeDeviceRequest(value);
      if (result.found) {
        setInfo(result);
        setChosen(result.scopes.map(s => s.name));
      } else {
        setNotFound(true);
      }
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };

  // A code that came in the link is looked up once, as soon as the person is
  // signed in, so they go straight to the question.
  useEffect(() => {
    if (!user || lookedUpFromLink.current) return;
    lookedUpFromLink.current = true;
    if (code.trim()) lookUp(code);
    // Only the sign-in triggers this; later edits to the code wait for Continue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const signIn = async () => {
    setBusy(true);
    setProblem(await signInToDecide());
    setBusy(false);
  };

  const decide = async (approve) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await decideDeviceRequest(info.user_code, approve, chosen);
      if (result.found) {
        setAnswer(result.approved ? 'approved' : 'declined');
      } else {
        // It expired, or was answered elsewhere, while this page was open.
        setInfo(null);
        setNotFound(true);
      }
    } catch (err) {
      setProblem(err.message);
    }
    setBusy(false);
  };

  if (authLoading) {
    return <AgentShell><div className="text-muted">Loading...</div></AgentShell>;
  }

  if (answer) {
    return (
      <AgentShell>
        {answer === 'approved' ? (
          <>
            <h1 className="h4 mb-3">Connected</h1>
            <p>
              Go back to {agentName(info.client)}. It will pick this up by itself within a
              few seconds.
            </p>
            <p className="text-muted small">
              You can close this page. To disconnect the agent later, open Sharing in HunaPuka.
            </p>
          </>
        ) : (
          <>
            <h1 className="h4 mb-3">Cancelled</h1>
            <p className="text-muted small">Nothing was shared. You can close this page.</p>
          </>
        )}
      </AgentShell>
    );
  }

  const trouble = problem && <div className="alert alert-danger py-2 small">{problem}</div>;

  if (!user) {
    return (
      <AgentShell>
        <h1 className="h4 mb-3">Connect an AI agent to your HunaPuka inventory</h1>
        <div className="alert alert-warning py-2 small">
          Only continue if you asked an AI agent to connect to HunaPuka just now, and it
          gave you this address and a code. If someone else sent you here, close this page.
        </div>
        {trouble}
        <p className="text-muted small">Sign in to enter the code and choose what the agent can do.</p>
        <button className="btn btn-dark" onClick={signIn} disabled={busy}>
          <i className="fab fa-google me-2"></i>Sign in with Google
        </button>
      </AgentShell>
    );
  }

  if (!info) {
    return (
      <AgentShell>
        <h1 className="h4 mb-3">Connect an AI agent to your HunaPuka inventory</h1>
        <p>Enter the code your agent is showing you.</p>
        <form onSubmit={e => { e.preventDefault(); lookUp(code); }}>
          <input
            className="form-control form-control-lg mb-2"
            style={{ letterSpacing: '0.15em', textTransform: 'uppercase' }}
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            aria-label="Code from your agent"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={16}
            disabled={busy}
            autoFocus
          />
          {notFound && (
            <div className="alert alert-danger py-2 small">
              That code is not waiting for approval. Check it against what your agent
              shows. Codes stop working after 10 minutes, so you may need to ask your
              agent for a new one.
            </div>
          )}
          {trouble}
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
            Continue
          </button>
        </form>
        <p className="text-muted small mt-3 mb-0">
          Signed in as <span className="text-break">{user.email}</span>.{' '}
          <button className="btn btn-link btn-sm p-0 align-baseline" onClick={logOut} disabled={busy}>
            Use a different account
          </button>
        </p>
      </AgentShell>
    );
  }

  return (
    <AgentShell>
      <AgentIntro client={info.client} userCode={info.user_code} />
      {trouble}
      <AgentPermissions
        client={info.client}
        scopes={info.scopes}
        accessDays={info.access_days}
        user={user}
        busy={busy}
        chosen={chosen}
        onChosen={setChosen}
        onLogOut={logOut}
        onAllow={() => decide(true)}
        onCancel={() => decide(false)}
      />
    </AgentShell>
  );
};

export default AgentDevicePage;
