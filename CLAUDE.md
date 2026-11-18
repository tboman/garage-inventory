# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo with three independent Node projects, no workspace tooling — each has its own `package.json` and `node_modules`. Run commands from the package directory, not the root.

- `apps/hunapuka` — private inventory React app (CRA + React 19). Hosted at `hunapuka-34ce6` Firebase Hosting target.
- `apps/storageloot` — public marketplace React app (CRA + React 19 + React Router). Hosted at `storageloot-shop` Firebase Hosting target.
- `apps/buymywedding` — standalone Vite + React 19 + TS app with its **own** Firebase project (`buymywedding-21`), its own `firebase.json`, rules, and TypeScript Cloud Functions. Vendored into the monorepo but deploys independently — see "buymywedding (separate Firebase project)" below.
- `functions/` — Firebase Cloud Functions for `hunapuka-34ce6` (Node 22, plain CommonJS — **no build step**). Entry point is `functions/index.js`, which re-exports handlers from `functions/src/*.js`.
- `services/mcp` — TypeScript MCP server (Express + `@modelcontextprotocol/sdk`), deployed to Cloud Run via the provided `Dockerfile`.

Firebase project `hunapuka-34ce6` backs hunapuka, storageloot, buymynursery, the shared `functions/`, Firestore, Storage, and Auth. `apps/buymywedding` is the exception — it has its own Firebase project and config.

## Common commands

React apps (`apps/hunapuka`, `apps/storageloot`, `apps/buymynursery`):
```
npm start          # dev server
npm run build      # production build → build/
npm test           # react-scripts test (Jest, watch mode)
npm test -- --watchAll=false --testPathPattern=Foo  # run a single test
```

`apps/buymywedding` (Vite, not CRA):
```
npm run dev        # vite dev server
npm run build      # tsc -b && vite build → dist/
npm run lint       # eslint .
npm run preview    # vite preview
```

MCP service (`services/mcp`):
```
npm run dev        # tsx watch, hot reload
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm start          # node dist/index.js (production)
```

Deploys (from repo root):
```
firebase deploy --only hosting:hunapuka
firebase deploy --only hosting:storageloot
firebase deploy --only functions
firebase deploy --only firestore:rules,firestore:indexes,storage
```

The MCP server is **not** deployed by the Firebase CLI — build the Docker image and push to Cloud Run separately.

### buymywedding (separate Firebase project)

`apps/buymywedding` ships to its own Firebase project `buymywedding-21` (aliased as `buymywedding` in root `.firebaserc`). Its `firebase.json`, `firestore.rules`, `storage.rules`, and `functions/` are colocated inside the app dir. Deploys must be run from there so relative paths resolve correctly:

```
cd apps/buymywedding
firebase use buymywedding        # one-time: select the alias
npm run build                    # build vite app → dist/
firebase deploy                  # hosting + functions + rules to buymywedding-21
```

Do **not** add buymywedding's functions or rules to the root `firebase.json` — keeping its config self-contained is what allows it to target a different Firebase project from the same monorepo.

## Architecture

### Private-to-public pipeline
1. **Capture in Hunapuka.** Items are stored under `users/{uid}/items/{itemId}`; photos live in the user's own Google Drive (not Firebase Storage), accessed via a short-lived Google OAuth token stored client-side in `googleToken.js`.
2. **Promote to StorageLoot.** `ImportFromHunaPuka` triggers the `exportListing` Cloud Function, which copies Drive photos into Firebase Storage and writes a public doc to the top-level `listings` collection (`sellerId == uid`).
3. **Automate via MCP.** The MCP server exposes marketplace tools to AI agents, authenticating them against user Firebase UIDs and user-scoped eBay tokens.

Firestore rules (`firestore.rules`) are the contract between the layers: items and integrations are per-user and private; `listings` and `groups` are world-readable but write-gated to their `sellerId`/`ownerId`. StorageLoot `conversations` (and their `messages`) are readable only by their two `participants`, and `listings/{id}/marketplaces/{platform}` only by the listing's seller (see "StorageLoot messages" below). StorageLoot guests (custom-token sign-ins) may use conversations and nothing else. `mcp_clients`, `auth_sessions`, `mcp_refresh_tokens`, and `integration_tokens` are closed to all client access — only server-side admin SDK may read/write them.

### MCP server: personas + OIDC
`services/mcp` is multi-tenant by **hostname**. Each request's `Host` header is resolved by `personaMiddleware` (`src/util/persona.ts`) into one of the personas in `src/personas.ts`:

| Persona   | Host                         | Scopes                                       | Tools |
|-----------|------------------------------|----------------------------------------------|-------|
| `seller`  | `mcp.storageloot.shop`       | `market:read`, `market:search`               | ping, list eBay items, list StorageLoot items |
| `finance` | `mcp-finance.storageloot.shop` | `finance:read` + eBay `sell.account`, `sell.finances` | finance ping, finance transaction summary |
| `manager` | `mcp-admin.storageloot.shop`   | `identity:read`                              | list identities |

To add a tool: write a `register*` function under `src/tools/`, then include it in the right persona's `toolRegistrations` array. Each persona mints its own JWTs (distinct `issuer`) and advertises its own `requiredEbayScopes` in the OIDC authorize flow. The authorize endpoint redirects to `https://storageloot.shop/authorize` (the StorageLoot app) carrying `mcp_host` so the UI can route the user to the right consent screen.

OIDC flow (Authorization Code + PKCE, S256 only):
- `/authorize` — proxied to the StorageLoot app for user consent.
- `/register` — dynamic client registration, stored in `mcp_clients`.
- `/token` — exchanges code/refresh for access + refresh JWTs. Access tokens are short-lived; refresh tokens are stored hashed in `mcp_refresh_tokens`.
- `/.well-known/openid-configuration` and `/.well-known/jwks.json` — per-persona discovery + public keys.
- `/sse` + `/messages` — MCP transport, gated by `requireAuth`.

The **browser-side** half of the OIDC dance lives in `apps/storageloot` (`AgentAuthorizePage`); the bridging function `mintAuthorizationCode` in `functions/` is what actually writes the signed `auth_sessions` doc that `/token` later consumes.

### Secrets
Both `functions/src/secrets.js` and `services/mcp/src/secrets.ts` use the explicit `@google-cloud/secret-manager` client (not `firebase-functions` `defineSecret`) so the same code runs in Cloud Run and Cloud Functions. Secrets are cached in-process per `name@version`. Keep this pattern — do not introduce `defineSecret`.

Notable secrets: `EBAY_CLIENT_SECRET`, `MCP_JWT_PRIVATE_JWK`. The MCP server falls back to inline env vars (`EBAY_CLIENT_SECRET`, `MCP_JWT_PRIVATE_JWK`) for local dev; in production it reads from Secret Manager using the project resolved from `GCP_PROJECT`/`GOOGLE_CLOUD_PROJECT`.

### StorageLoot messages and marketplaces
- A buyer, signed in with Google or as a guest (below), can ask about a listing, make an offer, or ask the seller to list it on eBay or Craigslist, from the listing page (`ContactSeller`). Each becomes a message in `conversations/{listingId}_{buyerUid}`, one two-way thread per buyer per listing. The buyer creates the conversation and its first message in one batch. Sellers and buyers see their threads at `/messages` (Selling / Buying tabs, unread counts) and reply at `/messages/:id`. Only the seller can accept or decline an offer, once.
- Client code is `apps/storageloot/src/messagesApi.js`. Agents write the same documents through `poppyStorageloot` with the admin SDK, which bypasses the rules, so `functions/src/messages.js` (`validateMessage`) repeats the rules' field checks. Keep the two in step. Agent messages carry `via: "agent"` and `agentClientId`, which clients cannot set.
- Marketplace placeholders: `listings/{id}/marketplaces/{platform}` for `ebay`, `nextdoor`, `facebook`, `craigslist` track where the seller has listed an item (status, link). Assisted listing flows do not exist yet; the seller's "Sell on more marketplaces" panel says so. The `onListingRequest` function counts buyer requests on the placeholder (`requestCount`), which clients may not write.
- Guests write to sellers without signing in. Two kinds, both able to take part in conversations and nothing else:
  - **Browser guest** (`sla_` + random id). The first "Send to seller" from someone signed out calls `POST /api/guest/session` on `poppyStorageloot`. That creates `storageloot_accounts/{id}` and a session in `storageloot_guest_sessions` (by token hash, a year, renewed on each visit), and sets the token as part `a` of the `__session` cookie (`join.js` keeps `j`/`w`/`a` together). The response is a Firebase custom token (claim `sl_guest`), so the app keeps writing through Firestore under the rules. The app signs guests in with in-memory persistence, so the cookie is the only credential; a readable `sl_guest=1` marker cookie tells the app to resume on load (`apps/storageloot/src/guestApi.js`, `useAuth` exposes `user` (Google), `guest`, and `me`). `POST /api/guest/sign-out` ends it for good. Only the site's origin may call these (`STORAGELOOT.GUEST.ORIGINS`), and one IP may start `NEW_PER_IP_PER_HOUR` guests (`storageloot_guest_ip`).
  - **Agent guest** (`slg_` + a hash of the agent's client_id and the Session's `sub`). The message and conversation endpoints, called with a verified Session from an approved agent and no Authorization header, act for it; its first message to a seller creates the account. Its allowance is counted on the account.
  - Conversations a guest starts carry `buyerGuest: true` (the rules require it exactly for custom-token sign-ins), and sellers see a Guest badge.
  - Keeping guests out: the rules use `member()` (signed in and not `sign_in_provider == 'custom'`) everywhere outside conversations, `storage.rules` does the same for uploads, and the callables call `refuseGuests` (`functions/src/guest.js`). Nothing else in the project may use custom tokens, or this check breaks.
  - Minting custom tokens needs the functions' service account to hold Service Account Token Creator on itself.
- Rules tests: `npm run test:rules` in `functions/` (Firestore emulator, needs Java). To try the app locally against emulators: `firebase emulators:start --only auth,firestore,functions --project demo-storageloot` from the root, then `REACT_APP_USE_EMULATORS=true REACT_APP_FIREBASE_PROJECT_ID=demo-storageloot npm start` in `apps/storageloot`.

### eBay integration
- `services/mcp/src/ebay/` — app-token + user-token flows, Browse API, Trading API (XML via `fast-xml-parser`), and userLink lookups.
- `functions/src/ebayTokens.js` + `linkEbayAccount.js` + `unlinkEbayAccount.js` — user OAuth token storage under `users/{uid}/integration_tokens/ebay` (server-write only per rules).
- `EBAY_ENV=sandbox` switches both the OAuth and API base URLs in `services/mcp/src/config.ts`.

### CIMD (Client-Initiated Marketplace Delegation)
Clients whose IDs begin with the CIMD prefix (`src/cimd.ts` / `functions/src/cimd.js`) represent pre-registered agent identities. The `/token` endpoint resolves these via `fetchCimd` instead of looking them up in `mcp_clients`. Agent identities are seeded by `functions/scripts/seed-identity-pool.js` and `seed-owner-agents.js`.

### Poppy (Personal Agent Protocol) on hunapuka.com
`hunapuka.com` lets a person's AI agent sign in and read or update their inventory through the Personal Agent Protocol, version 1.0 (spec: https://personalagentprotocol.org/docs/spec, source: https://github.com/personal-agent-protocol/personal-agent-protocol).

- Version 0.4 is still served for agents that have not moved to 1.0: `poppy.json` links to a 0.4 document at `/api/poppy/0.4.json` in `supported_versions`, and the API accepts `Poppy-Version` 0.4 or any 1.x. To stop serving 0.4, delete its entry from `OLDER_VERSIONS` in `functions/src/poppy/config.js`.
- The `poppy` Cloud Function (`functions/src/poppy.js`, logic in `functions/src/poppy/`) serves `/.well-known/poppy.json`, the OAuth metadata, `/oauth/token`, `/oauth/revoke`, and the inventory API under `/api/v1`. Three independent scopes: `inventory:read` (list and search), `inventory:write` (add, edit, move), and `inventory:delete` (one item at a time, never a non-empty container). Hosting rewrites in `firebase.json` route those paths on the `hunapuka` target to it.
- `hunapuka.com` is its own OAuth issuer. Google is only how the person signs in on the consent page (`AgentAuthorizePage`, served by the app at `/oauth/authorize`). Google cannot be the issuer: the protocol requires the issuer's metadata to list `https://hunapuka.com` and to accept agent-published client IDs.
- Agents are identified by a client metadata URL and sign with their own keys; there is no client registration. These identity checks always run and are logged (`poppy agent identity check failed`), but `ENFORCE_AGENT_IDENTITY` in `functions/src/poppy/config.js` is currently `false`, so an agent that fails them is served as "unverified" (warned about on the consent page). Set it to `true` once real agents identify themselves properly. Codes, refresh grants, and access tokens are stored by hash in `poppy_codes`, `poppy_grants`, and `poppy_access_tokens` (closed to clients). The `jti` of every accepted client assertion and Session JWT is recorded in `poppy_used_jtis`, shared by both sites' functions and all their instances, so a replayed JWT is refused wherever it lands. `poppyCleanup` runs hourly and deletes expired records until none are left. Every API request with a verified `Poppy-Session` header logs `poppy agent identity check passed` with the agent's Session ID (`sid`), its ID for the person (`user`), the `grant_id`, and the `request`; the grant keeps the latest as `last_session_id` / `last_session_user` / `last_session_at`.
- Approved agents are listed by client_id in `APPROVED_CLIENTS` in `functions/src/poppy/config.js` (currently Muse, `https://muse.ai/poppy/agent.json`). A sign-in under an approved client_id always has to prove it comes from that agent, even while `ENFORCE_AGENT_IDENTITY` is `false`. `APPROVED_CLIENTS_ONLY` is `true`, so every agent that is not on the list is refused at the consent page, the device endpoint, the token endpoint, and the API. To let another agent in, add its client_id to the list and redeploy the `poppy` function; set the flag to `false` to open the site to any agent again.
- Two ways to sign in, both ending in the same tokens. Direct Sign-In redirects the person to `/oauth/authorize`. Device Sign-In (RFC 8628, spec 4.3) is for agents that cannot take a redirect: the agent posts to `/oauth/device`, shows the person `https://hunapuka.com/device` and a short code, and polls `/oauth/token` while they sign in and approve on that page (`AgentDevicePage`). The person must be signed in before a code is looked up, and wrong codes are counted per account. Pending requests live in `poppy_device_codes` and the counts in `poppy_device_attempts` (closed to clients); the limits are the `DEVICE_*` constants in `config.js`. To stop offering it, remove the device grant and `device_authorization_endpoint` from `authorizationServerMetadata` in `documents.js`.
- Web browsing (spec section 6): `poppy.json` lists `web.browser_session_endpoint` (`/poppy/browser-session`). An agent's browser joins its Session there with a one-time code the agent authorizes at `/poppy/browser-session/authorize`, which needs the `poppy:browser-sign-in` scope, and is then shown read-only, server-rendered inventory pages under `/browse` (`functions/src/poppy/web.js`). Those pages need `inventory:read` and have no way to change anything; the React app at `/` is not part of this and still signs people in with Google. Firebase Hosting forwards only a cookie named `__session` to functions, so that one cookie carries both the join secret and the web session, and cannot use the `__Host-` prefix. Join codes and web sessions live in `poppy_browser_codes` and `poppy_web_sessions` (closed to clients).
- storageloot.shop is served by the `poppyStorageloot` function (`functions/src/poppy/storageloot.js`, documents in `storagelootDocuments.js`; Hosting rewrites on the `storageloot` target). It is its own issuer (`https://storageloot.shop`) with its own sign-in: the same code as hunapuka.com (`functions/src/poppy/auth.js`, which `handler.js` also uses), with codes, grants, and tokens in `storageloot_poppy_*` collections and `sl`-prefixed tokens. Scopes are `messages:read` and `messages:send` (`STORAGELOOT.SCOPES` in `config.js`). The consent page is `/oauth/authorize` and Device Sign-In `/device` in the storageloot app (the older `/authorize` route is the MCP consent page). The API under `/api/v1`: `GET /listings` and `/listings/{id}` with a verified Session header only; `GET /conversations`, `/conversations/{id}` (`messages:read`); `POST /listings/{id}/messages` (inquiry, offer, listing_request) and `POST /conversations/{id}/messages` (reply) with `messages:send`, limited to `AGENT_MESSAGES_PER_HOUR` per grant. With no Authorization header, the conversation and message endpoints act for the agent's guest account instead (see "StorageLoot messages" above). Agents cannot accept or decline offers. Connected agents are listed on `/messages`. For browsing, an agent joins its browser anonymously, authorizing the code with a verified `Poppy-Session` header (aud/htu `https://storageloot.shop`) and no access token; it must be on `APPROVED_CLIENTS` regardless of `ENFORCE_AGENT_IDENTITY`. The browser then sees read-only pages of active listings under `/browse`. The join code is shared with hunapuka.com (`functions/src/poppy/join.js`), but codes and web sessions live in `storageloot_poppy_browser_codes` / `storageloot_poppy_web_sessions`, so they never cross sites.
- The API returns item names, descriptions, and structure only. `shapeItems` in `handler.js` builds the response field by field, so photos stay private unless added there on purpose.
- Tests: `npm test` in `functions/` runs the whole flow for both sites against a fake agent with no network. `apps/hunapuka` has component tests for the `/device` page (`npm test -- --watchAll=false`).

## Conventions worth knowing

- Functions code is **plain CommonJS** — no TypeScript, no bundler. Use `require`/`module.exports` and keep `index.js` as the single export surface.
- React apps are CRA with React 19. Firestore client SDK v12. No shared UI library between the two apps — duplication is intentional.
- Firestore indexes live in `firestore.indexes.json`; add composite indexes there when a query fails with a console link.
- `.local-jwk.json` (gitignored) is the local dev keypair for the MCP server. Generate with `services/mcp/scripts/generate-keypair.ts`.
- Smoke/probe scripts in `services/mcp/scripts/` are meant to be run with `tsx` against a real deployment — read the top of each file for required env vars before running.
v vars before running.
