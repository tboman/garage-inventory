import { z } from 'zod';
import { getAuth } from 'firebase-admin/auth';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from '../auth/verifyJwt.js';
import { hasScope } from '../auth/verifyJwt.js';
import { getDb } from '../firestore.js';

const REQUIRED_SCOPE = 'identity:read';

function toolError(code: string, message: string) {
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: code, message }, null, 2),
      },
    ],
  };
}

function getAdminUids(): Set<string> {
  const raw = process.env['MANAGER_ADMIN_UIDS'] ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function registerListIdentities(
  server: McpServer,
  auth: AuthContext,
): void {
  server.registerTool(
    'list_identities',
    {
      title: 'List StorageLoot identities',
      description:
        'Returns every StorageLoot user on the system with the MCP persona grants each has authorized (including the scope set per persona) and the external integrations linked to the account (currently eBay, including the eBay OAuth scopes granted). Admin-only; requires the identity:read MCP scope and caller must be in MANAGER_ADMIN_UIDS.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe('Maximum number of users to return (default 1000).'),
      },
    },
    async ({ limit }) => {
      if (!hasScope(auth, REQUIRED_SCOPE)) {
        return toolError(
          'insufficient_scope',
          `This tool requires the "${REQUIRED_SCOPE}" scope.`,
        );
      }

      const admins = getAdminUids();
      if (!admins.has(auth.sub)) {
        return toolError(
          'forbidden',
          'Caller is not a StorageLoot manager. Ask a manager to add this uid to MANAGER_ADMIN_UIDS.',
        );
      }

      const db = getDb();
      const [rtSnap, integrationsSnap] = await Promise.all([
        db
          .collection('mcp_refresh_tokens')
          .where('revoked', '==', false)
          .get(),
        db.collectionGroup('integrations').get(),
      ]);

      const mcpGrantsByUid = new Map<string, Map<string, Set<string>>>();
      for (const doc of rtSnap.docs) {
        const data = doc.data() as {
          uid?: unknown;
          persona?: unknown;
          scope?: unknown;
        };
        const uid = typeof data.uid === 'string' ? data.uid : null;
        const persona =
          typeof data.persona === 'string' ? data.persona : 'unknown';
        const scopeStr = typeof data.scope === 'string' ? data.scope : '';
        if (!uid) continue;
        let personaMap = mcpGrantsByUid.get(uid);
        if (!personaMap) {
          personaMap = new Map();
          mcpGrantsByUid.set(uid, personaMap);
        }
        let scopeSet = personaMap.get(persona);
        if (!scopeSet) {
          scopeSet = new Set();
          personaMap.set(persona, scopeSet);
        }
        for (const s of scopeStr.split(/\s+/).filter(Boolean)) {
          scopeSet.add(s);
        }
      }

      const ebayByUid = new Map<string, Record<string, unknown>>();
      for (const doc of integrationsSnap.docs) {
        if (doc.id !== 'ebay') continue;
        const uid = doc.ref.parent.parent?.id;
        if (!uid) continue;
        ebayByUid.set(uid, doc.data() as Record<string, unknown>);
      }

      function toIso(value: unknown): string | null {
        if (!value) return null;
        if (typeof value === 'string') return value;
        if (
          typeof value === 'object' &&
          value !== null &&
          'toDate' in value &&
          typeof (value as { toDate: unknown }).toDate === 'function'
        ) {
          return (value as { toDate: () => Date }).toDate().toISOString();
        }
        return null;
      }

      function ebayIntegration(uid: string): {
        linked: boolean;
        username: string | null;
        linked_at: string | null;
        scopes: string[];
      } {
        const data = ebayByUid.get(uid);
        if (!data) {
          return { linked: false, username: null, linked_at: null, scopes: [] };
        }
        const rawScopes = (data as { scopes?: unknown }).scopes;
        const scopes = Array.isArray(rawScopes)
          ? rawScopes.filter((s): s is string => typeof s === 'string')
          : typeof rawScopes === 'string'
            ? rawScopes.split(/\s+/).filter(Boolean)
            : [];
        return {
          linked: true,
          username:
            typeof (data as { username?: unknown }).username === 'string'
              ? ((data as { username: string }).username)
              : null,
          linked_at: toIso((data as { linkedAt?: unknown }).linkedAt),
          scopes: scopes.slice().sort(),
        };
      }

      const listResult = await getAuth().listUsers(limit ?? 1000);
      const identities = listResult.users.map((u) => {
        const personaMap = mcpGrantsByUid.get(u.uid);
        const mcp_grants = personaMap
          ? Array.from(personaMap.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([persona, scopes]) => ({
                persona,
                scopes: Array.from(scopes).sort(),
              }))
          : [];
        return {
          uid: u.uid,
          email: u.email ?? null,
          display_name: u.displayName ?? null,
          created_at: u.metadata.creationTime,
          last_signed_in_at: u.metadata.lastSignInTime || null,
          mcp_grants,
          integrations: {
            ebay: ebayIntegration(u.uid),
          },
        };
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: identities.length,
                next_page_token: listResult.pageToken ?? null,
                identities,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
