# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo with three independent Node projects, no workspace tooling — each has its own `package.json` and `node_modules`. Run commands from the package directory, not the root.

- `apps/hunapuka` — private inventory React app (CRA + React 19). Hosted at `hunapuka-34ce6` Firebase Hosting target.
- `apps/storageloot` — public marketplace React app (CRA + React 19 + React Router). Hosted at `storageloot-shop` Firebase Hosting target.
- `apps/buymywedding` — standalone Vite + React 19 + TS app with its **own** Firebase project (`buymywedding-21`), its own `firebase.json`, rules, and TypeScript Cloud Functions. Vendored into the monorepo but deploys independently — see "buymywedding (separate Firebase project)" below.
- `functions/` — Firebase Cloud Functions for `hunapuka-34ce6` (Node 20, plain CommonJS — **no build step**). Entry point is `functions/index.js`, which re-exports handlers from `functions/src/*.js`.
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

Firestore rules (`firestore.rules`) are the contract between the layers: items and integrations are per-user and private; `listings` and `groups` are world-readable but write-gated to their `sellerId`/`ownerId`. `mcp_clients`, `auth_sessions`, `mcp_refresh_tokens`, and `integration_tokens` are closed to all client access — only server-side admin SDK may read/write them.

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

### eBay integration
- `services/mcp/src/ebay/` — app-token + user-token flows, Browse API, Trading API (XML via `fast-xml-parser`), and userLink lookups.
- `functions/src/ebayTokens.js` + `linkEbayAccount.js` + `unlinkEbayAccount.js` — user OAuth token storage under `users/{uid}/integration_tokens/ebay` (server-write only per rules).
- `EBAY_ENV=sandbox` switches both the OAuth and API base URLs in `services/mcp/src/config.ts`.

### CIMD (Client-Initiated Marketplace Delegation)
Clients whose IDs begin with the CIMD prefix (`src/cimd.ts` / `functions/src/cimd.js`) represent pre-registered agent identities. The `/token` endpoint resolves these via `fetchCimd` instead of looking them up in `mcp_clients`. Agent identities are seeded by `functions/scripts/seed-identity-pool.js` and `seed-owner-agents.js`.

## Conventions worth knowing

- Functions code is **plain CommonJS** — no TypeScript, no bundler. Use `require`/`module.exports` and keep `index.js` as the single export surface.
- React apps are CRA with React 19. Firestore client SDK v12. No shared UI library between the two apps — duplication is intentional.
- Firestore indexes live in `firestore.indexes.json`; add composite indexes there when a query fails with a console link.
- `.local-jwk.json` (gitignored) is the local dev keypair for the MCP server. Generate with `services/mcp/scripts/generate-keypair.ts`.
- Smoke/probe scripts in `services/mcp/scripts/` are meant to be run with `tsx` against a real deployment — read the top of each file for required env vars before running.
v vars before running.
