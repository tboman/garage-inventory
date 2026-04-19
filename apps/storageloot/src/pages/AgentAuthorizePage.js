import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { startEbayLogin } from '../ebayAuth';

const SCOPE_LABELS = {
  openid: 'Confirm your StorageLoot identity',
  profile: 'Read your StorageLoot display name and email',
  'market:read': 'Read marketplace listings on your behalf',
  'market:search': 'Search marketplaces on your behalf',
  'finance:read': 'Read your eBay finance summary (payouts, fees, transactions)',
  'identity:read':
    'Admin: list all StorageLoot identities and the MCP personas they\'ve authorized',
};

const EBAY_SCOPE_LABELS = {
  'https://api.ebay.com/oauth/api_scope/sell.account':
    'eBay account settings (read)',
  'https://api.ebay.com/oauth/api_scope/sell.finances':
    'eBay payouts, fees, and transactions (read)',
};

function validateParams(p) {
  if (p.responseType !== 'code') return 'Unsupported response_type (only `code`).';
  if (!p.clientId) return 'Missing client_id.';
  if (!p.redirectUri) return 'Missing redirect_uri.';
  try { new URL(p.redirectUri); } catch { return 'Invalid redirect_uri.'; }
  if (!p.codeChallenge) return 'Missing code_challenge (PKCE required).';
  if (p.codeChallengeMethod !== 'S256') return 'code_challenge_method must be S256.';
  return null;
}

function redirectWithParams(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  window.location.href = url.toString();
}

export default function AgentAuthorizePage() {
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, login } = useAuth();

  const params = {
    responseType: searchParams.get('response_type'),
    clientId: searchParams.get('client_id'),
    redirectUri: searchParams.get('redirect_uri'),
    scope: searchParams.get('scope'),
    state: searchParams.get('state'),
    codeChallenge: searchParams.get('code_challenge'),
    codeChallengeMethod: searchParams.get('code_challenge_method'),
    mcpHost: searchParams.get('mcp_host'),
  };
  const paramError = validateParams(params);

  const [agent, setAgent] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading || !user || paramError) return;
    let cancelled = false;
    (async () => {
      try {
        const fn = httpsCallable(functions, 'getRegisteredAgent');
        const res = await fn({
          client_id: params.clientId,
          mcp_host: params.mcpHost,
        });
        if (!cancelled) setAgent(res.data);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load agent info.');
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, paramError, params.clientId]);

  async function handleAllow() {
    setSubmitting(true);
    try {
      const fn = httpsCallable(functions, 'mintAuthorizationCode');
      const res = await fn({
        client_id: params.clientId,
        redirect_uri: params.redirectUri,
        scope: params.scope || agent?.scope || '',
        code_challenge: params.codeChallenge,
        code_challenge_method: params.codeChallengeMethod,
        mcp_host: params.mcpHost,
      });
      redirectWithParams(params.redirectUri, { code: res.data.code, state: params.state });
    } catch (err) {
      setLoadError(err.message || 'Failed to issue authorization code.');
      setSubmitting(false);
    }
  }

  function handleDeny() {
    redirectWithParams(params.redirectUri, { error: 'access_denied', state: params.state });
  }

  function handleRelinkEbay(missingScopes) {
    const returnTo = `/authorize?${searchParams.toString()}`;
    startEbayLogin(missingScopes, returnTo);
  }

  if (paramError) {
    return (
      <div className="container py-5" style={{ maxWidth: 520 }}>
        <h2>Invalid authorization request</h2>
        <p className="text-danger">{paramError}</p>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="container py-5 text-center">
        <div className="spinner-border text-secondary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-5 text-center" style={{ maxWidth: 520 }}>
        <h2>Sign in to authorize</h2>
        <p className="text-muted">
          An AI agent is asking for access to your StorageLoot account. Sign in to review the request.
        </p>
        <button className="btn btn-sl mt-3" onClick={login}>Sign in with Google</button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container py-5" style={{ maxWidth: 520 }}>
        <h2>Can't authorize this agent</h2>
        <p className="text-danger">{loadError}</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="container py-5 text-center">
        <div className="spinner-border text-secondary" />
      </div>
    );
  }

  if (!agent.redirect_uris.includes(params.redirectUri)) {
    return (
      <div className="container py-5" style={{ maxWidth: 520 }}>
        <h2>Redirect URI not registered</h2>
        <p className="text-danger">
          <code>{params.redirectUri}</code> is not registered for this agent. Refusing to proceed.
        </p>
      </div>
    );
  }

  const effectiveScope = params.scope || agent.scope || '';
  const scopes = effectiveScope.split(/\s+/).filter(Boolean);
  const redirectHost = (() => { try { return new URL(params.redirectUri).host; } catch { return params.redirectUri; } })();
  const displayName = agent.client_name || params.clientId;

  const requiredEbayScopes = Array.isArray(agent.required_ebay_scopes)
    ? agent.required_ebay_scopes
    : [];
  const currentEbayScopes = Array.isArray(agent.current_ebay_scopes)
    ? agent.current_ebay_scopes
    : [];
  const missingEbayScopes = requiredEbayScopes.filter(
    (s) => !currentEbayScopes.includes(s),
  );
  const needsEbayRelink = missingEbayScopes.length > 0;

  return (
    <div className="container py-5" style={{ maxWidth: 520 }}>
      <div className="card shadow-sm">
        <div className="card-body">
          <h1 className="h4 mb-3">Authorize {displayName}</h1>
          <p className="text-muted mb-4">
            <strong>{displayName}</strong> is requesting access to your StorageLoot account.
          </p>
          <p className="mb-1"><strong>Permissions requested:</strong></p>
          <ul className="mb-4">
            {scopes.map((s) => (
              <li key={s}>{SCOPE_LABELS[s] || s}</li>
            ))}
          </ul>

          {needsEbayRelink && (
            <div className="alert alert-warning">
              <p className="mb-2">
                <strong>Additional eBay access needed.</strong> This agent needs your
                eBay account linked with extra scopes before it can act on your behalf.
              </p>
              <p className="mb-1 small">Missing eBay permissions:</p>
              <ul className="mb-3 small">
                {missingEbayScopes.map((s) => (
                  <li key={s}>{EBAY_SCOPE_LABELS[s] || s}</li>
                ))}
              </ul>
              <button
                className="btn btn-sl btn-sm"
                onClick={() => handleRelinkEbay(missingEbayScopes)}
              >
                {agent.ebay_linked
                  ? 'Re-link eBay with finance access'
                  : 'Link eBay with finance access'}
              </button>
            </div>
          )}

          <p className="text-muted small mb-4">
            Signed in as {user.email}. After allowing, you'll be redirected to <code>{redirectHost}</code>.
          </p>
          <div className="d-flex gap-2">
            <button
              className="btn btn-sl flex-fill"
              onClick={handleAllow}
              disabled={submitting || needsEbayRelink}
              title={needsEbayRelink ? 'Re-link eBay first' : undefined}
            >
              {submitting ? 'Authorizing…' : 'Allow'}
            </button>
            <button className="btn btn-outline-secondary flex-fill" onClick={handleDeny} disabled={submitting}>
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
