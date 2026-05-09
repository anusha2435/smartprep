// lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyADbSLehcWdmSW7HHaFicLN8W82kntEXu0",
  authDomain: "smartprep-57e4f.firebaseapp.com",
  projectId: "smartprep-57e4f",
  storageBucket: "smartprep-57e4f.firebasestorage.app",
  messagingSenderId: "325106331546",
  appId: "1:325106331546:web:57008149ee7efe6baa1423",
  measurementId: "G-B7HQCEMT3S",
};

// Prevent duplicate initialization in Next.js dev mode
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;