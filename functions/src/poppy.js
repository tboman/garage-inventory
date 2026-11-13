// Personal Agent Protocol ("Poppy") support for hunapuka.com: lets a person's
// AI agent sign in with their approval and read or update their inventory. Firebase
// Hosting rewrites the protocol's paths on hunapuka.com to this function; see
// src/poppy/handler.js for the endpoints.

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { createClientDirectory } = require("./poppy/clientMetadata");
const { createJwtVerifier } = require("./poppy/jwt");
const { createFirestoreStore } = require("./poppy/store");
const { createPoppyHandler } = require("./poppy/handler");

if (!admin.apps.length) admin.initializeApp();

let handler;
function getHandler() {
  if (!handler) {
    const clients = createClientDirectory();
    handler = createPoppyHandler({
      store: createFirestoreStore(),
      clients,
      jwt: createJwtVerifier({ clients }),
      verifyIdToken: (token) => admin.auth().verifyIdToken(token),
    });
  }
  return handler;
}

exports.poppy = onRequest({ region: "us-central1", maxInstances: 5 }, (req, res) =>
  getHandler()(req, res),
);

exports.poppyCleanup = onSchedule("every 24 hours", async () => {
  const removed = await createFirestoreStore().deleteExpired(Date.now());
  console.log(`Removed ${removed} expired Poppy record(s).`);
});
