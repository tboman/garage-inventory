This monorepo is a sophisticated, "agent-ready" ecosystem for inventory and marketplace management, built on a
  Firebase backbone. Here is the architectural analysis of its three primary services:

  1. Hunapuka (apps/hunapuka)
   * Purpose: A private inventory management tool.
   * Key Tech: React 19, Firebase (Auth/Firestore), and Google Drive API.
   * Unique Logic: Unlike typical apps, it stores item photos in the user's personal Google Drive rather than a central
     bucket. This reinforces a "private ownership" model for the user's personal data.
   * Interactions: It acts as the "source of truth" for items before they are listed for sale.

  2. StorageLoot (apps/storageloot)
   * Purpose: A public marketplace for selling items on platforms like eBay and Craigslist.
   * Key Tech: React 19, Firebase Storage, and React Router.
   * Interoperability: It features a deep integration with Hunapuka. The ImportFromHunaPuka logic allows users to
     "promote" private inventory items to public listings. This process triggers a backend workflow that copies photos
     from the user's Google Drive into the marketplace's infrastructure.
   * eBay Integration: Uses Firebase Functions to handle OAuth linking and exporting listings directly to eBay.

  3. MCP Server (services/mcp)
   * Purpose: A Model Context Protocol server that exposes StorageLoot's capabilities to AI agents (like Claude).
   * Key Tech: Node.js (TypeScript), Express, and OIDC (OpenID Connect).
   * Strategic Role: This service makes the entire ecosystem "agentic." By implementing a full OIDC flow (Authorization
     Code + PKCE), it allows AI agents to securely authenticate as a user.
   * Capabilities: It mints JWTs that bridge Firebase UIDs with eBay identities, enabling an agent to manage a user's
     marketplace presence programmatically.

  Backend Logic (functions)
  The functions directory serves as the integration hub. It handles:
   * eBay API: XML parsing and secure token management for eBay's specialized APIs.
   * Cross-App Workflows: The exportListing function is the bridge that moves data and media between the private
     (Hunapuka) and public (StorageLoot) domains.
   * Auth Bridging: Functions like mintAuthorizationCode support the OIDC flow used by the MCP server.

  Summary
  The monorepo follows a "Private-to-Public" pipeline:
   1. Capture in Hunapuka (Private/Drive).
   2. Import to StorageLoot (Public/Marketplace).
   3. Manage via AI Agents (MCP/OIDC).
