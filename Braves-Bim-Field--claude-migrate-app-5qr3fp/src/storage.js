import {
  collection, doc, getDoc, setDoc, deleteDoc, getDocs, query, where, documentId, serverTimestamp,
} from "firebase/firestore";
import { db, firebaseEnabled } from "./firebase.js";

// Drop-in replacement for the Claude Artifact runtime's window.storage API:
// shared=true goes to Firestore (synced across devices), shared=false stays
// on this device via localStorage. Mirrors the {get,set,list,delete} shape
// so the rest of the app doesn't need to know which backend is used.

function kvDoc(key) {
  return doc(collection(db, "kv"), key);
}

export async function safeGet(key, shared) {
  try {
    if (shared) {
      if (!firebaseEnabled) return null;
      const snap = await getDoc(kvDoc(key));
      return snap.exists() ? snap.data().value : null;
    }
    return localStorage.getItem(key);
  } catch (e) { return null; }
}

export async function safeSet(key, value, shared) {
  try {
    if (shared) {
      if (!firebaseEnabled) return false;
      await setDoc(kvDoc(key), { value, updatedAt: serverTimestamp() });
      return true;
    }
    localStorage.setItem(key, value);
    return true;
  } catch (e) { return false; }
}

export async function safeList(prefix, shared) {
  try {
    if (shared) {
      if (!firebaseEnabled) return [];
      const q = query(
        collection(db, "kv"),
        where(documentId(), ">=", prefix),
        where(documentId(), "<", prefix + "")
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => d.id);
    }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return keys;
  } catch (e) { return []; }
}

export async function safeDelete(key, shared) {
  try {
    if (shared) {
      if (!firebaseEnabled) return false;
      await deleteDoc(kvDoc(key));
      return true;
    }
    localStorage.removeItem(key);
    return true;
  } catch (e) { return false; }
}

// Structured (non-JSON-blob) project metadata, one doc per project code, so
// external tools — the Revit add-in in particular — can list/search projects
// by name via Firestore's REST API without having to parse the `kv` blobs.
export async function syncProjectMeta(code, meta) {
  try {
    if (!firebaseEnabled || !code) return false;
    await setDoc(doc(collection(db, "projects"), code), { ...meta, code, updatedAt: serverTimestamp() });
    return true;
  } catch (e) { return false; }
}

// ---- local device cache (IndexedDB) ----------------------------------------
// Separate from safeGet/safeSet's localStorage fallback above: this is a
// dedicated key/value store used for larger per-device payloads (a whole
// project's data) that localStorage's ~5MB-ish quota isn't a safe fit for.
function openLocalDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("no-indexeddb")); return; }
    const req = indexedDB.open("braves_prancheta", 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("kv", { keyPath: "key" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function idbGet(key) {
  try {
    const db = await openLocalDB();
    return await new Promise((resolve) => {
      const tx = db.transaction("kv", "readonly");
      const r = tx.objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result ? r.result.value : null);
      r.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
}
export async function idbSet(key, value) {
  try {
    const db = await openLocalDB();
    return await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ key, value });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}
