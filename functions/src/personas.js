const PERSONAS = {
  seller: {
    name: "seller",
    host: "mcp.storageloot.shop",
    issuer: "https://mcp.storageloot.shop",
    mcpScopes: ["openid", "profile", "market:read", "market:search"],
    requiredEbayScopes: [],
  },
  finance: {
    name: "finance",
    host: "mcp-finance.storageloot.shop",
    issuer: "https://mcp-finance.storageloot.shop",
    mcpScopes: ["openid", "profile", "finance:read"],
    requiredEbayScopes: [
      "https://api.ebay.com/oauth/api_scope/sell.account",
      "https://api.ebay.com/oauth/api_scope/sell.finances",
    ],
  },
  manager: {
    name: "manager",
    host: "mcp-admin.storageloot.shop",
    issuer: "https://mcp-admin.storageloot.shop",
    mcpScopes: ["openid", "profile", "identity:read"],
    requiredEbayScopes: [],
  },
};

const BY_HOST = new Map(
  Object.values(PERSONAS).map((p) => [p.host.toLowerCase(), p]),
);

function personaByName(name) {
  return PERSONAS[name] || null;
}

function personaForHost(host) {
  if (typeof host !== "string") return null;
  return BY_HOST.get(host.split(":")[0].toLowerCase()) || null;
}

module.exports = { personaByName, personaForHost };
