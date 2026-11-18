// Personal Agent Protocol ("Poppy") support for hunapuka.com: lets a person's
// AI agent sign in with their approval and read or update their inventory. Firebase
// Hosting rewrites the protocol's paths on hunapuka.com to this function; see
// src/poppy/handler.js for the endpoints.

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { createClientDirectory } = require("./poppy/clientMetadata");
const { createJwtVerifier } = require("./poppy/jwt");
const { createFirestoreStore, createStorageLootStore, createUsedIdStore } = require("./poppy/store");
const { createPoppyHandler } = require("./poppy/handler");
const { createStorageLootHandler } = require("./poppy/storageloot");
const { STORAGELOOT } = require("./poppy/config");

if (!admin.apps.length) admin.initializeApp();

// One replay record in Firestore for both sites and every instance, so a
// captured client assertion or Session JWT is refused wherever it is replayed.
let usedIds;
const getUsedIds = () => (usedIds = usedIds || createUsedIdStore());

let handler;
function getHandler() {
  if (!handler) {
    const clients = createClientDirectory();
    handler = createPoppyHandler({
      store: createFirestoreStore(),
      clients,
      jwt: createJwtVerifier({ clients, usedIds: getUsedIds() }),
      verifyIdToken: (token) => admin.auth().verifyIdToken(token),
    });
  }
  return handler;
}

exports.poppy = onRequest({ region: "us-central1", maxInstances: 5 }, (req, res) =>
  getHandler()(req, res),
);

// storageloot.shop: anonymous browsing of public listings (src/poppy/storageloot.js).
// Firebase Hosting rewrites its Poppy paths on the storageloot target here.
let storageLootHandler;
function getStorageLootHandler() {
  if (!storageLootHandler) {
    storageLootHandler = createStorageLootHandler({
      store: createStorageLootStore(),
      jwt: createJwtVerifier({
        clients: createClientDirectory(),
        issuer: STORAGELOOT.ORIGIN,
        origin: STORAGELOOT.ORIGIN,
        usedIds: getUsedIds(),
      }),
    });
  }
  return storageLootHandler;
}

exports.poppyStorageloot = onRequest({ region: "us-central1", maxInstances: 5 }, (req, res) =>
  getStorageLootHandler()(req, res),
);

// Hourly, because anyone can load a join page and each load writes a code.
exports.poppyCleanup = onSchedule({ schedule: "every 1 hours", timeoutSeconds: 540 }, async () => {
  const now = Date.now();
  const removed =
    (await createFirestoreStore().deleteExpired(now)) +
    (await createStorageLootStore().deleteExpired(now)) +
    (await getUsedIds().deleteExpired(now));
  console.log(`Removed ${removed} expired Poppy record(s).`);
});
