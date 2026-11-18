// Verifies the two kinds of JWT a Personal Agent signs: the client assertion at
// the token endpoint (spec 4.1) and the Session JWT on API requests (spec 5.2,
// 5.3). Neither one grants account access; only an access token does.

const { createHash } = require("node:crypto");
const jose = require("jose");
const {
  ISSUER,
  ORIGIN,
  SESSION_WINDOW_S,
  ASSERTION_SKEW_S,
  ASSERTION_MAX_LIFETIME_S,
} = require("./config");

const ROOT_ALGS = ["ES256", "PS384"];

class JwtError extends Error {}

function sha256url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function decode(token) {
  if (typeof token !== "string" || token.length > 16 * 1024) throw new JwtError("Malformed JWT.");
  try {
    return { header: jose.decodeProtectedHeader(token), claims: jose.decodeJwt(token) };
  } catch {
    throw new JwtError("Malformed JWT.");
  }
}

async function verifyWith(token, jwk, alg, options) {
  try {
    const key = await jose.importJWK(jwk, alg);
    const { payload } = await jose.jwtVerify(token, key, { algorithms: [alg], ...options });
    return payload;
  } catch (err) {
    throw new JwtError(`JWT rejected: ${err.code || err.message}`);
  }
}

// The issuer a JWT claims, without checking anything. Only for log lines and
// for naming an unverified agent; never a basis for trust.
function peekIssuer(token) {
  try {
    const iss = jose.decodeJwt(token).iss;
    return typeof iss === "string" ? iss : undefined;
  } catch {
    return undefined;
  }
}

// A replay record kept in this process only. Enough for tests and local runs;
// production passes a shared one (store.js createUsedIdStore), because a
// function runs on several instances and a replay could land on any of them.
function memoryUsedIds() {
  const seen = new Map();
  return {
    // Resolves true the first time `key` is used before `expiresAtMs`, and
    // false for every later use while it is still live.
    async claim(key, expiresAtMs, nowMs) {
      if (seen.size > 5000) {
        for (const [k, exp] of seen) if (exp < nowMs) seen.delete(k);
      }
      if (seen.has(key) && seen.get(key) >= nowMs) return false;
      seen.set(key, expiresAtMs);
      return true;
    },
  };
}

// `issuer` and `origin` are the Company's, hunapuka.com unless a site passes
// its own: an agent's JWTs are bound to one Company and are refused by others.
// `usedIds` records each jti once, so a captured JWT cannot be replayed.
function createJwtVerifier({ clients, now = Date.now, issuer = ISSUER, origin = ORIGIN, usedIds = memoryUsedIds() }) {
  // Keys name the Company too, so two sites can share one record.
  const useJti = (key, expiresAtS) => usedIds.claim(`${issuer}|${key}`, expiresAtS * 1000, now());

  // Returns the verified client. `clientIdParam` is the optional client_id
  // form field, which must agree with the assertion when present.
  async function verifyClientAssertion(assertion, clientIdParam) {
    const { header, claims } = decode(assertion);
    if (!ROOT_ALGS.includes(header.alg)) throw new JwtError("Unsupported alg.");
    const clientId = claims.iss;
    if (typeof clientId !== "string" || claims.sub !== clientId) {
      throw new JwtError("iss and sub must both be the client_id.");
    }
    if (clientIdParam !== undefined && clientIdParam !== clientId) {
      throw new JwtError("client_id does not match the assertion.");
    }
    const client = await clients.getClient(clientId);
    const jwk = await clients.getKey(client, header.kid, header.alg);
    const payload = await verifyWith(assertion, jwk, header.alg, {
      issuer: clientId,
      subject: clientId,
      clockTolerance: ASSERTION_SKEW_S,
      currentDate: new Date(now()),
    });
    // Exactly the issuer, as one string. An endpoint URL or an array could
    // name another Company that would also accept the assertion (spec 4.1).
    if (payload.aud !== issuer) throw new JwtError("aud must be the issuer.");
    const nowS = Math.floor(now() / 1000);
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
      throw new JwtError("exp and iat are required.");
    }
    if (payload.exp - payload.iat > ASSERTION_MAX_LIFETIME_S) {
      throw new JwtError("Assertion lasts more than 5 minutes.");
    }
    // Without this, a far-future `iat` would let a 5-minute assertion stay
    // usable for as long as its signer liked.
    if (payload.iat - nowS > ASSERTION_SKEW_S) throw new JwtError("Assertion iat is in the future.");
    if (typeof payload.jti !== "string" || !payload.jti) throw new JwtError("jti is required.");
    if (!(await useJti(`a:${clientId}:${payload.jti}`, payload.exp + ASSERTION_SKEW_S))) {
      throw new JwtError("Assertion was already used.");
    }
    return client;
  }

  // Verifies the Poppy-Session header for one request, in the order the spec
  // gives. `accessToken` is the raw bearer token, or null when signed out.
  async function verifySession(token, { method, path, accessToken }) {
    const { header, claims } = decode(token);
    if (header.typ !== "poppy-session+jwt") throw new JwtError("Wrong typ.");
    if (header.alg !== "ES256") throw new JwtError("Session JWTs must use ES256.");
    if (typeof header.poppy_dlg !== "string") throw new JwtError("Missing delegation.");
    const clientId = claims.iss;
    if (typeof clientId !== "string") throw new JwtError("Missing iss.");
    const client = await clients.getClient(clientId);

    // 1-2. The delegation: signed by a key the agent publishes, naming the
    // delegated key that signed this Session JWT.
    const dlg = decode(header.poppy_dlg);
    if (dlg.header.typ !== "poppy-delegation+jwt") throw new JwtError("Wrong delegation typ.");
    if (!ROOT_ALGS.includes(dlg.header.alg)) throw new JwtError("Unsupported delegation alg.");
    const rootJwk = await clients.getKey(client, dlg.header.kid, dlg.header.alg);
    const delegation = await verifyWith(header.poppy_dlg, rootJwk, dlg.header.alg, {
      issuer: clientId,
      typ: "poppy-delegation+jwt",
      clockTolerance: ASSERTION_SKEW_S,
      currentDate: new Date(now()),
    });
    if (typeof delegation.exp !== "number" || typeof delegation.iat !== "number") {
      throw new JwtError("Delegation needs iat and exp.");
    }
    if (delegation.exp - delegation.iat > 24 * 60 * 60) {
      throw new JwtError("Delegation lasts more than 24 hours.");
    }
    const delegated = delegation.cnf && delegation.cnf.jwk;
    if (
      !delegated ||
      typeof delegated !== "object" ||
      delegated.kty !== "EC" ||
      delegated.crv !== "P-256" ||
      delegated.d !== undefined
    ) {
      throw new JwtError("Delegation has no usable public key.");
    }

    // 3. The Session JWT itself, signed with the delegated key.
    let thumbprint;
    try {
      thumbprint = await jose.calculateJwkThumbprint(delegated, "sha256");
    } catch {
      throw new JwtError("Delegated key is malformed.");
    }
    if (header.kid !== thumbprint) throw new JwtError("kid is not the delegated key's thumbprint.");
    // No `exp` on a Session JWT; freshness comes from `iat`, checked below.
    const session = await verifyWith(token, delegated, "ES256", {
      issuer: clientId,
      typ: "poppy-session+jwt",
      clockTolerance: SESSION_WINDOW_S,
      currentDate: new Date(now()),
    });

    // 4. Bound to this Company, this request, and this moment.
    if (session.aud !== issuer) throw new JwtError("aud must be the Company's identifier.");
    if (session.htm !== method) throw new JwtError("htm does not match the request.");
    let htu;
    try {
      htu = new URL(session.htu);
    } catch {
      throw new JwtError("htu is not a URL.");
    }
    if (htu.origin !== origin || htu.pathname !== path) {
      throw new JwtError("htu does not match the request.");
    }
    const nowS = Math.floor(now() / 1000);
    if (typeof session.iat !== "number" || Math.abs(nowS - session.iat) > SESSION_WINDOW_S) {
      throw new JwtError("iat is outside the acceptance window.");
    }
    for (const name of ["sid", "sub", "jti"]) {
      // Opaque to us: nothing is stored under them, so only their presence matters.
      if (typeof session[name] !== "string" || !session[name] || session[name].length > 256) {
        throw new JwtError(`${name} is missing or malformed.`);
      }
    }
    if (session.agent_id !== undefined && typeof session.agent_id !== "string") {
      throw new JwtError("agent_id is malformed.");
    }

    // 5. Tied to the access token when there is one, and to none otherwise.
    if (accessToken) {
      if (session.ath !== sha256url(accessToken)) throw new JwtError("ath does not match.");
    } else if (session.ath !== undefined) {
      throw new JwtError("ath without an access token.");
    }
    if (!(await useJti(`s:${clientId}:${session.jti}`, session.iat + 2 * SESSION_WINDOW_S))) {
      throw new JwtError("Session JWT was already used.");
    }
    return { clientId, sid: session.sid, userId: session.sub };
  }

  return { verifyClientAssertion, verifySession };
}

module.exports = { JwtError, createJwtVerifier, memoryUsedIds, sha256url, peekIssuer };
