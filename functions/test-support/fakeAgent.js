// Test helpers shared by the Poppy test files: a fake Personal Agent that
// signs real JWTs, a fake request/response pair for calling a handler, and a
// fake browser that keeps the one cookie Hosting forwards. No network.
// Kept outside test/ so `node --test` does not run this file as a test.

const { createHash, randomBytes } = require("node:crypto");
const jose = require("jose");

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sha = (v) => createHash("sha256").update(v).digest("base64url");
const rid = () => b64(randomBytes(12));

// A Personal Agent with a published root key and a delegated Session key.
// `origin` is the Company its JWTs are addressed to by default.
async function makeAgent(host, { alg = "ES256", origin = "https://hunapuka.com" } = {}) {
  const root = await jose.generateKeyPair(alg, { extractable: true });
  const rootJwk = { ...(await jose.exportJWK(root.publicKey)), kid: `root-${host}`, use: "sig" };
  const session = await jose.generateKeyPair("ES256", { extractable: true });
  const sessionJwk = await jose.exportJWK(session.publicKey);
  const clientId = `https://${host}/agent.json`;
  const redirectUri = `https://${host}/oauth/callback`;
  const nowS = () => Math.floor(Date.now() / 1000);

  return {
    clientId,
    redirectUri,
    documents: {
      [clientId]: {
        client_id: clientId,
        client_name: "Muse",
        jwks_uri: `https://${host}/jwks.json`,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "private_key_jwt",
      },
      [`https://${host}/jwks.json`]: { keys: [rootJwk] },
    },
    assertion({ aud = origin, iat = nowS(), lifetime = 120 } = {}) {
      return new jose.SignJWT({ jti: rid() })
        .setProtectedHeader({ alg, kid: rootJwk.kid })
        .setIssuer(clientId)
        .setSubject(clientId)
        .setAudience(aud)
        .setIssuedAt(iat)
        .setExpirationTime(iat + lifetime)
        .sign(root.privateKey);
    },
    async sessionHeader({ method = "GET", path, accessToken, claims = {}, header = {}, to = origin }) {
      const delegation = await new jose.SignJWT({ cnf: { jwk: sessionJwk }, jti: rid() })
        .setProtectedHeader({ alg, typ: "poppy-delegation+jwt", kid: rootJwk.kid })
        .setIssuer(clientId)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(root.privateKey);
      const body = {
        iss: clientId,
        aud: to,
        sid: "sid_1",
        sub: "usr_1",
        htm: method,
        htu: `${to}${path}`,
        iat: nowS(),
        jti: rid(),
        ...(accessToken ? { ath: sha(accessToken) } : {}),
        ...claims,
      };
      return new jose.SignJWT(body)
        .setProtectedHeader({
          alg: "ES256",
          typ: "poppy-session+jwt",
          kid: await jose.calculateJwkThumbprint(sessionJwk),
          poppy_dlg: delegation,
          ...header,
        })
        .sign(session.privateKey);
    },
  };
}

// Calls a handler the way Firebase would, and collects what it answered.
function makeCaller(handler) {
  return async function call(method, path, { headers = {}, body, query = {} } = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const out = { status: 200, headers: {}, body: undefined };
    const res = {
      status(s) {
        out.status = s;
        return res;
      },
      set(h) {
        Object.assign(out.headers, h);
        return res;
      },
      json(b) {
        out.body = b;
      },
      send(b) {
        out.body = b;
      },
      end() {},
    };
    await handler({ method, path, query, body, get: (n) => lower[n.toLowerCase()] }, res);
    return out;
  };
}

const JOIN = "/poppy/browser-session";

// A browser that keeps the __session cookie between visits.
function makeBrowser(call) {
  const browser = {
    cookie: undefined,
    async visit(method, path, options = {}) {
      const r = await call(method, path, { ...options, headers: browser.cookie ? { cookie: browser.cookie } : {} });
      if (r.headers["Set-Cookie"]) browser.cookie = r.headers["Set-Cookie"].split(";")[0];
      return r;
    },
    // Step 1 of the join: load the page and read the code out of its form.
    async loadJoinPage() {
      const page = await browser.visit("GET", JOIN);
      return { page, code: /name="code" value="([^"]+)"/.exec(page.body)[1] };
    },
    submit: (code) => browser.visit("POST", JOIN, { body: { code } }),
  };
  return browser;
}

module.exports = { makeAgent, makeCaller, makeBrowser, JOIN, b64, sha, rid };
