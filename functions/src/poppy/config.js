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
};

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
  CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  SESSION_WINDOW_S,
  ASSERTION_SKEW_S,
  ASSERTION_MAX_LIFETIME_S,
  PATHS,
};
