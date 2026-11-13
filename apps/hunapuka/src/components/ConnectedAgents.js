import React, { useEffect, useState } from 'react';
import { fetchConnectedAgents, disconnectAgent } from '../poppyApi';

// AI agents the owner has let read their inventory through the Personal Agent
// Protocol sign-in. Disconnecting revokes the agent's tokens straight away.
const ConnectedAgents = ({ onError }) => {
  const [agents, setAgents] = useState(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchConnectedAgents()
      .then(list => { if (!cancelled) setAgents(list); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const disconnect = async (agent) => {
    setSaving(true);
    try {
      await disconnectAgent(agent.id);
      setAgents(list => list.filter(a => a.id !== agent.id));
    } catch (err) {
      onError(`Failed to disconnect ${agent.name}: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sharing-card mt-3">
      <h3 className="h6 mb-1">Connected AI agents</h3>
      <p className="text-muted small mb-3">
        Personal AI agents you have allowed to read your inventory. They see item
        names, descriptions and structure, never photos, and cannot change anything.
      </p>

      {failed ? (
        <div className="text-muted small fst-italic">Could not load connected agents.</div>
      ) : agents === null ? (
        <div className="text-muted small">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="text-muted small fst-italic">No agents are connected.</div>
      ) : (
        <ul className="list-group list-group-flush share-list">
          {agents.map(agent => (
            <li key={agent.id} className="list-group-item d-flex align-items-center gap-2 px-0">
              <i className="fas fa-robot text-muted"></i>
              <span className="flex-grow-1 text-break">
                {agent.name}
                <span className="text-muted small d-block">
                  {agent.domain} · connected {new Date(agent.connected_at).toLocaleDateString()}
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
};

export default ConnectedAgents;
