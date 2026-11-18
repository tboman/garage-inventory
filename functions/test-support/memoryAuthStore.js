// An in-memory stand-in for agentAuthStore (src/poppy/store.js): codes,
// grants, access tokens, and Device Sign-In requests. The maps are exposed so
// tests can look inside.

function memoryAuthStore() {
  const codes = new Map();
  const grants = new Map();
  const access = new Map();
  const device = new Map();
  const misses = new Map();
  return {
    codes,
    grants,
    access,
    device,
    async putCode(h, d) {
      codes.set(h, { ...d });
    },
    async consumeCode(h) {
      const d = codes.get(h);
      if (!d) return { status: "missing" };
      if (d.used) return { status: "used", data: { ...d } };
      d.used = true;
      return { status: "ok", data: { ...d } };
    },
    async linkCodeToGrant(h, id) {
      codes.get(h).grant_id = id;
    },
    async putDeviceRequest(h, d) {
      device.set(h, { ...d });
    },
    async getDeviceRequest(h) {
      return device.has(h) ? { ...device.get(h) } : null;
    },
    async findDeviceRequest(userCodeHash) {
      const hits = [...device].filter(([, d]) => d.user_code_hash === userCodeHash);
      return hits.length === 1 ? { id: hits[0][0], ...hits[0][1] } : null;
    },
    async updateDeviceRequest(h, patch) {
      Object.assign(device.get(h), patch);
    },
    async moveDeviceRequest(h, from, patch) {
      const d = device.get(h);
      if (!d || d.status !== from) return false;
      Object.assign(d, patch);
      return true;
    },
    async getDeviceMisses(uid) {
      return misses.has(uid) ? { ...misses.get(uid) } : null;
    },
    async putDeviceMisses(uid, d) {
      misses.set(uid, { ...d });
    },
    async putGrant(id, d) {
      grants.set(id, { ...d });
    },
    async getGrant(id) {
      return grants.has(id) ? { ...grants.get(id) } : null;
    },
    async updateGrant(id, patch) {
      Object.assign(grants.get(id), patch);
    },
    async listGrants(uid) {
      return [...grants].filter(([, g]) => g.uid === uid && !g.revoked).map(([id, g]) => ({ id, ...g }));
    },
    async putAccessToken(h, d) {
      access.set(h, { ...d });
    },
    async getAccessToken(h) {
      return access.has(h) ? { ...access.get(h) } : null;
    },
    async updateAccessToken(h, patch) {
      Object.assign(access.get(h), patch);
    },
    async deleteAccessToken(h) {
      access.delete(h);
    },
    async deleteAccessTokensForGrant(id, before) {
      for (const [h, t] of access) {
        if (t.grant_id === id && (before === undefined || t.expires_at < before)) access.delete(h);
      }
    },
  };
}

module.exports = { memoryAuthStore };
