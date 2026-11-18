// Personal Agent Protocol ("Poppy") settings for hunapuka.com.
// Spec: https://personalagentprotocol.org/docs/spec (version 1.0).

// Built from configuration, never from the Host header: the Session JWT's
// `htu` and every issuer comparison are character-for-character checks.
const ORIGIN = "https://hunapuka.com";
const DOMAIN = "hunapuka.com";
// The site is its own OAuth issuer. Google is how the User signs in on the
// consent page; it cannot be the issuer, because an issuer must list
// https://hunapuka.com in its own metadata and accept agent-published
// client IDs (spec 3.2, 4.1).
const ISSUER = ORIGIN;
const PROTOCOL_VERSION = "1.0";
// Earlier versions that are still served, so agents can move to the current
// one at their own pace (spec 3.4). Each maps to the path of that version's
// own document, which poppy.json links to in `supported_versions`. An agent
// that only speaks 0.4 must not use a 1.0 document, and 0.4 was the 1.0
// release candidate: nothing this site offers differs between the two.
// Delete the entry to stop serving 0.4. The path sits under /api/ because
// Hosting already routes that to the function.
const OLDER_VERSIONS = { "0.4": "/api/poppy/0.4.json" };

const SCOPES = {
  "inventory:read": {
    description:
      "See the items in your inventory: their names, descriptions, and which " +
      "container each one is in. Read only. It does not include photos and " +
      "cannot add, change, move, or delete anything.",
    hints: { changes: "none", personal_data: true },
  },
  // Deleting is deliberately not part of this scope: it cannot be undone, and
  // keeping it out lets this scope be honestly described as reversible.
  "inventory:write": {
    description:
      "Add new items to your inventory, rename them or edit their descriptions, " +
      "and move them between containers. It cannot delete items or touch photos, " +
      "and it does not by itself let the agent look through your inventory.",
    hints: { changes: "reversible", personal_data: true },
  },
  "inventory:delete": {
    description:
      "Permanently delete items from your inventory, one at a time. This cannot " +
      "be undone. A container has to be emptied before it can be deleted. Any " +
      "photos of a deleted item stay in your Google Drive. It does not by itself " +
      "let the agent look through or change your inventory.",
    hints: { changes: "irreversible", personal_data: true },
  },
  // The protocol's own scope for signing the agent's browser in to the website
  // (spec section 6). The pages it opens, under /browse, are read-only and
  // apply inventory:read themselves, so this scope allows nothing by itself.
  "poppy:browser-sign-in": {
    description:
      "Open the read-only web pages of your inventory at hunapuka.com/browse, " +
      "signed in as you. They show only what the other access you allow here " +
      "covers, and nothing can be changed from them.",
    hints: { changes: "none", personal_data: true },
  },
};
const BROWSER_SCOPE = "poppy:browser-sign-in";

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

// Whether an agent that fails to prove who it is gets turned away. The checks
// always run and their outcome is always logged; this decides what a failure
// does. While false, an agent that publishes no usable client metadata, sends
// no valid client assertion, or sends no valid Poppy-Session header is still
// served, as an "unverified" agent. What still protects the account then:
// the person signs in with Google and approves on the consent page, which
// warns that the agent is unverified and names where access will be sent;
// PKCE ties the code to whoever started the sign-in; and every API call needs
// an access token. What is lost: proof of which agent is asking, and the
// guarantee that a stolen token is useless without the agent's keys.
// Set to true once the agents in use identify themselves per spec 4.1 and 5.2.
// With APPROVED_CLIENTS_ONLY on (below), only approved agents get this far,
// and they must already prove themselves to start a sign-in. What this flag
// still decides is whether a bad client assertion at the token endpoint or a
// bad Poppy-Session header at the API turns an approved agent away.
const ENFORCE_AGENT_IDENTITY = false;

// Personal Agents this site has approved, by client_id (spec 4.1: a Company
// decides which agents it accepts). Nobody else can start a sign-in under an
// approved client_id, even while ENFORCE_AGENT_IDENTITY is false: the agent's
// published metadata must check out at the consent page, and a Device Sign-In
// needs a client assertion signed with its keys. Without that, a request
// naming an approved agent is refused instead of being served as "unverified".
const APPROVED_CLIENTS = ["https://muse.ai/poppy/agent.json"];
// Whether the list is also the only way in. It is: an agent that is not on it
// is refused everywhere, at the consent page, the device endpoint, the token
// endpoint, and the API, however well it identifies itself. Set to false to
// let other agents connect again, under the rules of ENFORCE_AGENT_IDENTITY.
const APPROVED_CLIENTS_ONLY = true;

const CODE_TTL_MS = 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
// Sliding: each refresh pushes the expiry out again, so an unused grant lapses.
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Device Sign-In (spec 4.3, RFC 8628): the agent shows the person a link and a
// short code, and polls the token endpoint while they approve on this site.
// A request lives 10 minutes and can be approved and collected once.
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
// How often the agent may poll. A poll that arrives sooner gets `slow_down`.
const DEVICE_POLL_INTERVAL_S = 5;
// A poll up to this much early is let through, so network jitter on an agent
// that polls exactly on the interval does not earn it a `slow_down`.
const DEVICE_POLL_LEEWAY_MS = 1000;
// Once approved, the agent gets at least this long to collect its tokens, so
// approving in the request's last seconds still works.
const DEVICE_COLLECT_GRACE_MS = 60 * 1000;
// Letters only, with no vowels (so no words) and none that look alike, as
// RFC 8628 6.1 suggests. 8 of them give 20^8, about 2.6e10, combinations.
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;
// Wrong codes one signed-in account may enter before it has to wait.
const DEVICE_MISS_LIMIT = 10;
const DEVICE_MISS_WINDOW_MS = 15 * 60 * 1000;

// Web browsing (spec section 6). The agent's browser loads a page holding a
// one-time code, the agent authorizes that code with its Session header and
// access token, and the browser then trades it for a cookie.
// Five minutes, so an agent has time to read the page, authorize the code,
// and have its browser continue.
const BROWSER_CODE_TTL_MS = 5 * 60 * 1000;
// How long that cookie signs the browser in, the same as an access token.
// The agent joins again when it lapses.
const WEB_SESSION_TTL_MS = 60 * 60 * 1000;
// Firebase Hosting passes exactly one cookie through to a function, and only
// under this name, so it carries both the join secret and the web session.
const WEB_COOKIE = "__session";

// How far a Session JWT's `iat` may be from our clock, either way.
const SESSION_WINDOW_S = 90;
const ASSERTION_SKEW_S = 60;
// A client assertion's `exp` may be at most 5 minutes after its `iat`. One
// that lasts 5 minutes or less must not be turned away for its length
// (spec 4.1).
const ASSERTION_MAX_LIFETIME_S = 5 * 60;

const PATHS = {
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  revoke: "/oauth/revoke",
  // The endpoint the agent calls to start Device Sign-In, and the page the
  // person opens to approve it. The page's path is short because people may
  // type it by hand.
  device: "/oauth/device",
  devicePage: "/device",
  browserSession: "/poppy/browser-session",
  browse: "/browse",
  openapi: "/api/openapi.json",
  api: "/api/v1",
};

// storageloot.shop: public browsing only. An agent joins its browser to its
// Session anonymously, with a verified Poppy-Session header and no access
// token, and is shown read-only pages of the marketplace's active listings.
// No sign-in, scopes, or API there; the site is its own Company (issuer) for
// Session JWTs, so a Session meant for hunapuka.com is refused there and the
// other way round. APPROVED_CLIENTS above applies to it too.
const STORAGELOOT = {
  ORIGIN: "https://storageloot.shop",
  DOMAIN: "storageloot.shop",
  NAME: "StorageLoot",
  // Where listing photos are served from: Firebase Storage, both URL forms.
  IMAGE_HOSTS: ["https://firebasestorage.googleapis.com", "https://storage.googleapis.com"],
};

module.exports = {
  STORAGELOOT,
  ORIGIN,
  DOMAIN,
  ISSUER,
  PROTOCOL_VERSION,
  OLDER_VERSIONS,
  SCOPES,
  BROWSER_SCOPE,
  BROWSER_CODE_TTL_MS,
  WEB_SESSION_TTL_MS,
  WEB_COOKIE,
  ENFORCE_AGENT_IDENTITY,
  APPROVED_CLIENTS,
  APPROVED_CLIENTS_ONLY,
  NAME_MAX,
  DESCRIPTION_MAX,
  CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  DEVICE_GRANT,
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_S,
  DEVICE_POLL_LEEWAY_MS,
  DEVICE_COLLECT_GRACE_MS,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  DEVICE_MISS_LIMIT,
  DEVICE_MISS_WINDOW_MS,
  SESSION_WINDOW_S,
  ASSERTION_SKEW_S,
  ASSERTION_MAX_LIFETIME_S,
  PATHS,
};
