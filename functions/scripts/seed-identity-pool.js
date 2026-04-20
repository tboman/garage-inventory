#!/usr/bin/env node
const admin = require("firebase-admin");
const { randomBytes } = require("node:crypto");

const PROJECT_ID = "hunapuka-34ce6";

admin.initializeApp({ projectId: PROJECT_ID });

const POOL = [
  { email: "pool1_seller_agent1@x-auth.com", persona: "seller" },
  { email: "pool1_seller_agent2@x-auth.com", persona: "seller" },
  { email: "pool1_seller_agent3@x-auth.com", persona: "seller" },
  { email: "pool1_seller_agent4@x-auth.com", persona: "seller" },
  { email: "pool1_seller_agent5@x-auth.com", persona: "seller" },
  { email: "pool1_finance_agent1@x-auth.com", persona: "finance" },
  { email: "pool1_finance_agent2@x-auth.com", persona: "finance" },
  { email: "pool1_admin_agent1@x-auth.com", persona: "manager" },
];

const RETIRED_EMAILS = [
  "seller_pool1_agent1@x-auth.com",
  "seller_pool1_agent2@x-auth.com",
  "seller_pool1_agent3@x-auth.com",
  "seller_pool1_agent4@x-auth.com",
  "seller_pool1_agent5@x-auth.com",
  "finance_pool1_agent1@x-auth.com",
  "finance_pool1_agent2@x-auth.com",
  "admin_pool1_agent1@x-auth.com",
];

const PERSONA_ISSUER = {
  seller: "https://mcp.storageloot.shop",
  finance: "https://mcp-finance.storageloot.shop",
  manager: "https://mcp-admin.storageloot.shop",
};

async function run() {
  const password = "Pool-" + randomBytes(9).toString("base64url");
  console.log("Project:", PROJECT_ID);
  console.log("Shared password for all 8 pool identities:", password);
  console.log();

  const auth = admin.auth();
  const db = admin.firestore();

  for (const email of RETIRED_EMAILS) {
    try {
      const user = await auth.getUserByEmail(email);
      const seedDocs = await db
        .collection("mcp_refresh_tokens")
        .where("uid", "==", user.uid)
        .where("seed", "==", true)
        .get();
      for (const doc of seedDocs.docs) await doc.ref.delete();
      await auth.deleteUser(user.uid);
      console.log(`retired ${email.padEnd(38)} -> ${user.uid}`);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
    }
  }

  for (const { email, persona } of POOL) {
    let user;
    try {
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { password, emailVerified: true });
      console.log(`updated ${email.padEnd(38)} -> ${user.uid}  (${persona})`);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        user = await auth.createUser({ email, password, emailVerified: true });
        console.log(`created ${email.padEnd(38)} -> ${user.uid}  (${persona})`);
      } else {
        throw err;
      }
    }

    const docId = `seed-${user.uid}-${persona}`;
    await db.collection("mcp_refresh_tokens").doc(docId).set({
      uid: user.uid,
      client_id: "seed-pool",
      scope: "",
      persona,
      issuer: PERSONA_ISSUER[persona],
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000,
      revoked: false,
      seed: true,
    });
  }

  console.log();
  console.log("Done. 8 identities seeded.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
