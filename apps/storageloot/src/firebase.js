import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Plain sign-in asks only for basic profile, so buyers never see Google's
// "unverified app" warning. Drive access (drive.file only, which Google does
// not treat as sensitive) is requested separately, only when a seller imports
// from HunaPuka (see googleToken.js).
export const googleProvider = new GoogleAuthProvider();
export const googleMediaProvider = new GoogleAuthProvider();
googleMediaProvider.addScope('https://www.googleapis.com/auth/drive.file');
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Local testing against the Auth and Firestore emulators, never production:
//   REACT_APP_USE_EMULATORS=true npm start
if (process.env.REACT_APP_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
