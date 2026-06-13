import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore } from "firebase/firestore";

// Values come from .env.local (see .env.example). Firebase web config is not
// secret — access control lives in firestore.rules.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// ignoreUndefinedProperties: optional fields left undefined (e.g. a manual
// question's auto/attributeKey, a project's min/maxSize) are omitted rather
// than rejected — Firestore otherwise throws on any undefined field value.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });

/** UID of the app admin (you). Must match the constant in firestore.rules. */
export const ADMIN_UID: string = import.meta.env.VITE_ADMIN_UID ?? "";

if (import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
