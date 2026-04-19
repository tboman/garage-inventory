import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from './auth/verifyJwt.js';

export type PersonaName = 'seller' | 'finance';

export type ToolRegistration = (server: McpServer, auth: AuthContext) => void;

export interface Persona {
  name: PersonaName;
  host: string;
  issuer: string;
  mcpScopes: readonly string[];
  requiredEbayScopes: readonly string[];
  toolRegistrations: readonly ToolRegistration[];
}

import { registerPing } from './tools/ping.js';
import { registerListUserEbayItems } from './tools/listUserEbayItems.js';
import { registerFinancePing } from './tools/financePing.js';
import { registerFinanceTransactionSummary } from './tools/financeTransactionSummary.js';

const SELLER: Persona = {
  name: 'seller',
  host: 'mcp.storageloot.shop',
  issuer: 'https://mcp.storageloot.shop',
  mcpScopes: ['openid', 'profile', 'market:read', 'market:search'],
  requiredEbayScopes: [],
  toolRegistrations: [registerPing, registerListUserEbayItems],
};

const FINANCE: Persona = {
  name: 'finance',
  host: 'mcp-finance.storageloot.shop',
  issuer: 'https://mcp-finance.storageloot.shop',
  mcpScopes: ['openid', 'profile', 'finance:read'],
  requiredEbayScopes: [
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.finances',
  ],
  toolRegistrations: [registerFinancePing, registerFinanceTransactionSummary],
};

const ALL_PERSONAS: readonly Persona[] = [SELLER, FINANCE];

const BY_HOST = new Map<string, Persona>(
  ALL_PERSONAS.map((p) => [p.host.toLowerCase(), p]),
);

const BY_NAME = new Map<PersonaName, Persona>(
  ALL_PERSONAS.map((p) => [p.name, p]),
);

export function personaForHost(host: string | undefined): Persona | null {
  if (!host) return null;
  const bare = host.split(':')[0]?.toLowerCase() ?? '';
  return BY_HOST.get(bare) ?? null;
}

export function personaByName(name: string): Persona | null {
  return BY_NAME.get(name as PersonaName) ?? null;
}

export function allPersonas(): readonly Persona[] {
  return ALL_PERSONAS;
}
