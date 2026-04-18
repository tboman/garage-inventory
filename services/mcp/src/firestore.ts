import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { config } from './config.js';

let db: Firestore | null = null;

export function getDb(): Firestore {
  if (db) return db;
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      ...(config.gcpProject ? { projectId: config.gcpProject } : {}),
    });
  }
  db = getFirestore();
  return db;
}

export { FieldValue };
