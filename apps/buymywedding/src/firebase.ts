// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// TO GET THIS CONFIG:
// 1. Go to your Firebase project console.
// 2. In the left-hand menu, click on the gear icon next to "Project Overview".
// 3. Click on "Project settings".
// 4. In the "General" tab, scroll down to the "Your apps" section.
// 5. Click on the "</>" icon to see the web app configuration.
const firebaseConfig = {
  apiKey: "AIzaSyD1CdiDaRLhZQAweI7E_ursIqKnCvjaDsw",
  authDomain: "buymywedding-21.firebaseapp.com",
  projectId: "buymywedding-21",
  storageBucket: "buymywedding-21.firebasestorage.app",
  messagingSenderId: "1069609682643",
  appId: "1:1069609682643:web:cb873fa8cffd00a5f53626"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
