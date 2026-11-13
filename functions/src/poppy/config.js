// Personal Agent Protocol ("Poppy") settings for hunapuka.com.
// Spec: https://personalagentprotocol.org/docs/spec (version 0.4).

// Built from configuration, never from the Host header: the Session JWT's
// `htu` and every issuer comparison are character-for-character checks.
const ORIGIN = "https://hunapuka.com";
const DOMAIN = "hunapuka.com";
// The site is its own OAuth issuer. Google is how the User signs in on the
// consent page; it cannot be the issuer, because an issuer must list
// https://hunapuka.com in its own metadata and accept agent-published
// client IDs (spec 3.2, 4.1).
const ISSUER = ORIGIN;
const PROTOCOL_VERSION = "0.4";

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
};

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
const ENFORCE_AGENT_IDENTITY = false;

const CODE_TTL_MS = 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
// Sliding: each refresh pushes the expiry out again, so an unused grant lapses.
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// How far a Session JWT's `iat` may be from our clock, either way.
const SESSION_WINDOW_S = 90;
const ASSERTION_SKEW_S = 60;
// "Short-lived" is not given a number in the spec; an hour is a generous cap.
const ASSERTION_MAX_LIFETIME_S = 60 * 60;

const PATHS = {
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  revoke: "/oauth/revoke",
  openapi: "/api/openapi.json",
  api: "/api/v1",
};

module.exports = {
  ORIGIN,
  DOMAIN,
  ISSUER,
  PROTOCOL_VERSION,
  SCOPES,
  ENFORCE_AGENT_IDENTITY,
  NAME_MAX,
  DESCRIPTION_MAX,
  CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  SESSION_WINDOW_S,
  ASSERTION_SKEW_S,
  ASSERTION_MAX_LIFETIME_S,
  PATHS,
};
