import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { describeAgentRequest, decideAgentRequest } from '../poppyApi';
import { AgentShell, AgentIntro, AgentPermissions, agentName, signInToDecide } from '../components/AgentConsent';

// The consent page a personal AI agent opens at /oauth/authorize (Personal
// Agent Protocol, Direct Sign-In). The person signs in with Google here, on
// our own page, and decides what the agent may do with their messages. The
// server re-checks the whole request when the decision is posted, so nothing
// shown here is trusted on the way back.
const AgentConsentPage = () => {
  const { user, loading: authLoading, logout: logOut } = useAuth();
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
    const failure = await signInToDecide();
    if (failure) setError(failure);
    setBusy(false);
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

  if (error) {
    return (
      <AgentShell>
        <h1 className="h4 mb-3">This agent cannot be connected</h1>
        <div className="alert alert-danger">{error}</div>
        <p className="text-muted small">Nothing was shared. You can close this page.</p>
      </AgentShell>
    );
  }
  if (!info || authLoading) {
    return <AgentShell><div className="text-muted">Checking the request...</div></AgentShell>;
  }

  const { client, scopes, access_days: accessDays } = info;
  return (
    <AgentShell>
      <AgentIntro client={client} />
      {!user ? (
        <>
          <p className="text-muted small">Sign in to choose what {agentName(client)} can see.</p>
          <div className="d-flex gap-2">
            <button className="btn btn-dark" onClick={signIn} disabled={busy}>
              Sign in with Google
            </button>
            <button className="btn btn-outline-secondary" onClick={() => decide(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <AgentPermissions
          client={client}
          scopes={scopes}
          accessDays={accessDays}
          user={user}
          busy={busy}
          chosen={chosen}
          onChosen={setChosen}
          onLogOut={logOut}
          onAllow={() => decide(true)}
          onCancel={() => decide(false)}
        />
      )}
    </AgentShell>
  );
};

export default AgentConsentPage;
