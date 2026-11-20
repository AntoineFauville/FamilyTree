// Online storage and sign-in with Firebase (only when js/firebase-config.js is filled in).
//
// trees/main            { file: encrypted tree (JSON text), version, updatedAt, updatedBy }
// trees/main/history/*  { file, version, savedAt, savedBy }  every saved version
// editors/{email}       { admin: true|false }                who may save
//
// Firebase only ever sees the encrypted file; the family codes never leave the browser.

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const TREE = 'main';
const EMAIL_KEY = 'familytree.signInEmail';

export const cloudEnabled = !!firebaseConfig;

let fb = null; // { app, auth, db, A: auth functions, F: firestore functions }

async function init() {
  if (fb) return fb;
  const [appMod, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { app, auth: A.getAuth(app), db: F.getFirestore(app), A, F };
  return fb;
}

const treeRef = ({ F, db }) => F.doc(db, 'trees', TREE);

// The online tree: { file, version, updatedAt, updatedBy } or null if none saved yet.
// Uses one plain web request (no Firebase code to download), so viewing stays fast
// on phones; the full Firebase code is only loaded for editors.
export async function loadTree() {
  const { projectId, apiKey } = firebaseConfig;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + `/databases/(default)/documents/trees/${TREE}?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`online tree: HTTP ${r.status}`);
  const f = (await r.json()).fields || {};
  return {
    file: JSON.parse(f.file.stringValue),
    version: Number(f.version.integerValue),
    updatedAt: f.updatedAt?.timestampValue ? new Date(f.updatedAt.timestampValue) : null,
    updatedBy: f.updatedBy?.stringValue || '',
  };
}

// Saves a new version. expectedVersion is the version this browser started from:
// if someone else saved in the meantime, nothing is written and 'conflict' is thrown.
export async function saveTree(fileObj, expectedVersion) {
  const c = await init();
  const { F } = c;
  const email = c.auth.currentUser?.email?.toLowerCase();
  if (!email) throw new Error('not-signed-in');
  const text = JSON.stringify(fileObj);
  const ref = treeRef(c);
  const version = await F.runTransaction(c.db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data().version : 0;
    if (current !== (expectedVersion || 0)) throw new Error('conflict');
    const next = current + 1;
    tx.set(ref, { file: text, version: next, updatedAt: F.serverTimestamp(), updatedBy: email });
    return next;
  });
  // Keep a copy of every version (for undo); a failure here doesn't undo the save.
  try {
    await F.addDoc(F.collection(ref, 'history'), { file: text, version, savedAt: F.serverTimestamp(), savedBy: email });
  } catch (e) { console.warn('history copy failed', e); }
  return version;
}

// ---- Sign-in

export async function onUser(cb) {
  const c = await init();
  c.A.onAuthStateChanged(c.auth, (u) => cb(u ? { email: (u.email || '').toLowerCase() } : null));
}

export async function signInWithGoogle() {
  const c = await init();
  await c.A.signInWithPopup(c.auth, new c.A.GoogleAuthProvider());
}

// Sends a sign-in link by email. The link comes back to this page (without the family code).
export async function sendEmailLink(email) {
  const c = await init();
  const url = `${location.origin}${location.pathname}`;
  await c.A.sendSignInLinkToEmail(c.auth, email, { url, handleCodeInApp: true });
  try { localStorage.setItem(EMAIL_KEY, email); } catch { /* ignore */ }
}

// If this page was opened from a sign-in email, finish signing in. Returns true if it did.
export async function completeEmailLink(askEmail) {
  if (!cloudEnabled || !/[?&]oobCode=/.test(location.search)) return false;
  const c = await init();
  if (!c.A.isSignInWithEmailLink(c.auth, location.href)) return false;
  let email = null;
  try { email = localStorage.getItem(EMAIL_KEY); } catch { /* ignore */ }
  if (!email) email = askEmail();
  if (!email) return false;
  await c.A.signInWithEmailLink(c.auth, email, location.href);
  try { localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname); // remove the long sign-in code from the address
  return true;
}

export async function signOutUser() {
  const c = await init();
  await c.A.signOut(c.auth);
}

// 'admin', 'editor' or null (not on the list).
export async function myRole() {
  const c = await init();
  const email = c.auth.currentUser?.email?.toLowerCase();
  if (!email) return null;
  try {
    const snap = await c.F.getDoc(c.F.doc(c.db, 'editors', email));
    if (!snap.exists()) return null;
    return snap.data().admin ? 'admin' : 'editor';
  } catch {
    return null; // not allowed to read the list = not an editor
  }
}

// ---- Editors list (admins)

export async function listEditors() {
  const c = await init();
  const snap = await c.F.getDocs(c.F.collection(c.db, 'editors'));
  return snap.docs.map((d) => ({ email: d.id, admin: !!d.data().admin })).sort((a, b) => a.email.localeCompare(b.email));
}

export async function setEditor(email, admin) {
  const c = await init();
  const me = c.auth.currentUser?.email?.toLowerCase() || '';
  await c.F.setDoc(c.F.doc(c.db, 'editors', email.trim().toLowerCase()), { admin: !!admin, addedBy: me, addedAt: c.F.serverTimestamp() });
}

export async function removeEditor(email) {
  const c = await init();
  await c.F.deleteDoc(c.F.doc(c.db, 'editors', email));
}

// ---- History (editors): most recent saved versions first.

export async function listHistory(max = 30) {
  const c = await init();
  const { F } = c;
  const q = F.query(F.collection(treeRef(c), 'history'), F.orderBy('version', 'desc'), F.limit(max));
  const snap = await F.getDocs(q);
  return snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, version: x.version, savedAt: x.savedAt?.toDate?.() || null, savedBy: x.savedBy, file: JSON.parse(x.file) };
  });
}
