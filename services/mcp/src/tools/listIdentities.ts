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
        'Returns every StorageLoot user on the system with the set of MCP personas each has authorized an agent for. Admin-only; requires the identity:read MCP scope and caller must be in MANAGER_ADMIN_UIDS.',
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
      const rtSnap = await db
        .collection('mcp_refresh_tokens')
        .where('revoked', '==', false)
        .get();
      const personasByUid = new Map<string, Set<string>>();
      for (const doc of rtSnap.docs) {
        const data = doc.data() as {
          uid?: unknown;
          persona?: unknown;
        };
        const uid = typeof data.uid === 'string' ? data.uid : null;
        const persona =
          typeof data.persona === 'string' ? data.persona : 'unknown';
        if (!uid) continue;
        let set = personasByUid.get(uid);
        if (!set) {
          set = new Set();
          personasByUid.set(uid, set);
        }
        set.add(persona);
      }

      const listResult = await getAuth().listUsers(limit ?? 1000);
      const identities = listResult.users.map((u) => ({
        uid: u.uid,
        email: u.email ?? null,
        display_name: u.displayName ?? null,
        created_at: u.metadata.creationTime,
        last_signed_in_at: u.metadata.lastSignInTime || null,
        personas: Array.from(personasByUid.get(u.uid) ?? []).sort(),
      }));

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
