#!/usr/bin/env node
const admin = require("firebase-admin");
const { randomBytes } = require("node:crypto");

const PROJECT_ID = "hunapuka-34ce6";
const OWNER_EMAIL = "tomasboman@gmail.com";

admin.initializeApp({ projectId: PROJECT_ID });

const AGENTS = [
  { email: "tomas_sales_agent1@x-auth.com", persona: "seller", label: "Sales agent 1" },
  { email: "tomas_sales_agent2@x-auth.com", persona: "seller", label: "Sales agent 2" },
  { email: "tomas_sales_agent3@x-auth.com", persona: "seller", label: "Sales agent 3" },
  { email: "tomas_finance_agent1@x-auth.com", persona: "finance", label: "Finance agent 1" },
  { email: "tomas_finance_agent2@x-auth.com", persona: "finance", label: "Finance agent 2" },
  { email: "tomas_admin_agent1@x-auth.com", persona: "manager", label: "Administrative agent 1" },
];

const PERSONA_ISSUER = {
  seller: "https://mcp.storageloot.shop",
  finance: "https://mcp-finance.storageloot.shop",
  manager: "https://mcp-admin.storageloot.shop",
};

async function run() {
  const auth = admin.auth();
  const db = admin.firestore();

  const owner = await auth.getUserByEmail(OWNER_EMAIL);
  console.log(`Owner: ${OWNER_EMAIL} -> ${owner.uid}`);

  const password = "Agent-" + randomBytes(9).toString("base64url");
  console.log(`Shared password for agent sign-in: ${password}`);
  console.log();

  for (const { email, persona, label } of AGENTS) {
    let agentUser;
    try {
      agentUser = await auth.getUserByEmail(email);
      await auth.updateUser(agentUser.uid, {
        password,
        emailVerified: true,
        displayName: label,
      });
      console.log(`updated ${email.padEnd(36)} -> ${agentUser.uid}  (${persona})`);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        agentUser = await auth.createUser({
          email,
          password,
          emailVerified: true,
          displayName: label,
        });
        console.log(`created ${email.padEnd(36)} -> ${agentUser.uid}  (${persona})`);
      } else {
        throw err;
      }
    }

    await db
      .collection("users")
      .doc(owner.uid)
      .collection("agents")
      .doc(agentUser.uid)
      .set({
        agent_uid: agentUser.uid,
        email,
        label,
        persona,
        seed: true,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

    await db.collection("agent_owners").doc(agentUser.uid).set({
      owner_uid: owner.uid,
      persona,
      seed: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    const tokenDocId = `seed-${agentUser.uid}-${persona}`;
    await db.collection("mcp_refresh_tokens").doc(tokenDocId).set({
      uid: agentUser.uid,
      client_id: "seed-owner-agents",
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
  const adminAgentEmail = AGENTS.find((a) => a.persona === "manager").email;
  const adminAgent = await auth.getUserByEmail(adminAgentEmail);
  console.log(`Admin agent UID (add to MANAGER_ADMIN_UIDS): ${adminAgent.uid}`);
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
