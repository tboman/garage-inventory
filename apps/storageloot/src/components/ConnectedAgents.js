import { useEffect, useState } from 'react';
import { fetchConnectedAgents, disconnectAgent } from '../poppyApi';

const ABILITIES = {
  'messages:read': 'Reads your messages',
  'messages:send': 'Sends messages as you',
};

// Personal AI agents the person has connected to their StorageLoot account
// through Personal Agent Protocol sign-in. Disconnecting revokes their tokens
// straight away.
export default function ConnectedAgents({ user }) {
  const [agents, setAgents] = useState(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    fetchConnectedAgents()
      .then((list) => { if (!cancelled) setAgents(list); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [user]);

  const disconnect = async (agent) => {
    setSaving(true);
    setError(null);
    try {
      await disconnectAgent(agent.id);
      setAgents((list) => list.filter((a) => a.id !== agent.id));
    } catch (err) {
      setError(`Failed to disconnect ${agent.name}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded p-3">
      <h6 className="fw-semibold mb-1">Connected AI agents</h6>
      <p className="text-muted small mb-2">
        Personal AI agents you have allowed to read your messages or write to sellers for you.
        They can never accept or decline an offer.
      </p>
      {error && <div className="alert alert-danger py-1 px-2 small">{error}</div>}
      {failed ? (
        <div className="text-muted small fst-italic">Could not load connected agents.</div>
      ) : agents === null ? (
        <div className="text-muted small">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="text-muted small fst-italic">No agents are connected.</div>
      ) : (
        <ul className="list-group list-group-flush">
          {agents.map((agent) => (
            <li key={agent.id} className="list-group-item d-flex align-items-center gap-2 px-0">
              <span className="flex-grow-1 text-break">
                {agent.name}
                {(agent.scopes || []).map((s) => (
                  <span key={s} className="badge bg-secondary ms-1">{ABILITIES[s] || s}</span>
                ))}
                {agent.verified === false && (
                  <span className="badge ms-1 bg-dark" title="This agent did not prove who it is">Unverified</span>
                )}
                <span className="text-muted small d-block">
                  {agent.domain ? `${agent.domain} · ` : ''}connected {new Date(agent.connected_at).toLocaleDateString()}
                </span>
              </span>
              <button
                className="btn btn-outline-danger btn-sm flex-shrink-0"
                onClick={() => disconnect(agent)}
                disabled={saving}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
