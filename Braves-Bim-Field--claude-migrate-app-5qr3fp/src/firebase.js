import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

let db = null;
if (firebaseEnabled) {
  const app = getApps()[0] || initializeApp(config);
  db = getFirestore(app);
} else {
  console.warn(
    "Firebase não configurado (variáveis VITE_FIREBASE_* ausentes) — sincronização entre dispositivos desativada, cada aparelho salva só localmente. Veja o README para configurar."
  );
}

export { db };
