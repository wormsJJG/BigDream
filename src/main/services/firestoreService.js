/**
 * src/main/services/firestoreService.js
 * Firebase client SDK wrapper for the Electron main process.
 *
 * Responsibilities:
 * - Initialize Firebase app lazily (no side effects at import time)
 * - Provide auth login/logout (so Firestore rules can be evaluated in main)
 * - Provide a constrained Firestore "proxy" API for the renderer via IPC
 *
 * NOTE: Some operations (like update checks) may be allowed without auth depending on rules.
 */
function createFirestoreService() {
  let firebaseApp = null;
  let firebaseAuth = null;
  let firestoreDb = null;

  const firebaseConfig = {
    apiKey: "AIzaSyDGTvT4En8iXJENDU3miHSJnD_n6MUF10M",
    authDomain: "bigdream-216cb.firebaseapp.com",
    projectId: "bigdream-216cb",
    storageBucket: "bigdream-216cb.firebasestorage.app",
    messagingSenderId: "495577029138",
    appId: "1:495577029138:web:23c815b526932fc71196cb",
    measurementId: "G-TEQ25W7CGZ"
  };

  function ensureFirebase() {
    if (firebaseApp && firebaseAuth && firestoreDb) return;

    const { initializeApp, getApps } = require('firebase/app');
    const { getAuth } = require('firebase/auth');
    const { getFirestore } = require('firebase/firestore');

    const apps = getApps();
    firebaseApp = apps.length === 0 ? initializeApp(firebaseConfig) : apps[0];
    firebaseAuth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
  }

  function requireAuthIfNeeded(requireAuth) {
    ensureFirebase();
    if (requireAuth && !firebaseAuth.currentUser) {
      const err = new Error('NOT_AUTHENTICATED_IN_MAIN');
      err.code = 'NOT_AUTHENTICATED_IN_MAIN';
      throw err;
    }
  }

  async function login(email, password) {
    ensureFirebase();
    const { signInWithEmailAndPassword } = require('firebase/auth');
    if (!email || !password) throw new Error('email/password required');
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    return { ok: true, uid: cred?.user?.uid || null };
  }

  async function logout() {
    ensureFirebase();
    const { signOut } = require('firebase/auth');
    await signOut(firebaseAuth);
    return { ok: true };
  }

  /**
   * Create a new Firebase Auth user without affecting the current auth session.
   * (Equivalent to the legacy "secondaryApp" pattern that was previously done in renderer.)
   */
  async function createUser(email, password) {
    ensureFirebase();
    if (!email || !password) throw new Error('email/password required');

    const { initializeApp, deleteApp } = require('firebase/app');
    const { getAuth, createUserWithEmailAndPassword } = require('firebase/auth');

    const secondaryName = `secondaryApp-${Date.now()}`;
    const secondaryApp = initializeApp(firebaseConfig, secondaryName);
    try {
      const secondaryAuth = getAuth(secondaryApp);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      return { ok: true, uid: cred?.user?.uid || null };
    } finally {
      // Prevent memory leaks / dangling app instances
      try { await deleteApp(secondaryApp); } catch (_e) {}
    }
  }

  // --- Firestore payload decoding (supports FieldValue encodings) ---
  function decodeFieldValue(v) {
    if (v && typeof v === 'object' && v.__op === 'increment') {
      const { increment } = require('firebase/firestore');
      // Renderer IPC를 거치면 FieldValue.increment()가 평범한 객체로 직렬화될 수 있음.
      // 여러 형태를 모두 수용한다: {__op:'increment', n}, {operand}, {increment}, {value}
      const raw =
        (v.n !== undefined ? v.n : undefined) ??
        (v.operand !== undefined ? v.operand : undefined) ??
        (v.increment !== undefined ? v.increment : undefined) ??
        (v.value !== undefined ? v.value : undefined) ??
        0;
      return increment(Number(raw || 0));
    }
    if (v && typeof v === 'object' && v.__op === 'serverTimestamp') {
      const { serverTimestamp } = require('firebase/firestore');
      return serverTimestamp();
    }
    return v;
  }

  function decodeData(obj) {
    if (Array.isArray(obj)) return obj.map(decodeData);
    if (!obj || typeof obj !== 'object') return decodeFieldValue(obj);

    // ✅ 핵심: FieldValue 인코딩 객체({__op:'increment' ...})는 "데이터 맵"으로 풀어버리면 안 됨
    // 이전 버그: {__op:'increment', n:-1} 를 그대로 updateDoc에 넘겨 Firestore에 map으로 저장됨
    const decoded = decodeFieldValue(obj);
    if (decoded !== obj) return decoded;

    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = decodeData(v);
    return out;
  }

  function docRef(pathSegments) {
    const { doc } = require('firebase/firestore');
    return doc(firestoreDb, ...pathSegments);
  }

  function colRef(pathSegments) {
    const { collection } = require('firebase/firestore');
    return collection(firestoreDb, ...pathSegments);
  }

  function applyConstraints(baseQuery, constraints) {
    const { where, orderBy, limit, query } = require('firebase/firestore');
    const clauses = [];
    for (const c of (constraints || [])) {
      if (!c || !c.__type) continue;
      if (c.__type === 'where') clauses.push(where(c.field, c.op, c.value));
      if (c.__type === 'orderBy') clauses.push(orderBy(c.field, c.direction || 'asc'));
      if (c.__type === 'limit') clauses.push(limit(Number(c.n || 0)));
    }
    return query(baseQuery, ...clauses);
  }

  async function getDocPublic(pathSegments) {
    ensureFirebase();
    const { getDoc } = require('firebase/firestore');
    const snap = await getDoc(docRef(pathSegments));
    return { exists: snap.exists(), id: snap.id, data: snap.exists() ? snap.data() : null };
  }

  async function call(payload, { requireAuth = true } = {}) {
    requireAuthIfNeeded(requireAuth);

    const op = payload?.op;
    const pathSegments = payload?.path;

    if (!op || !Array.isArray(pathSegments) || pathSegments.length === 0) {
      throw new Error('Invalid firestore payload');
    }

    const firestore = require('firebase/firestore');
    const { getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocs } = firestore;

    switch (op) {
      case 'getDoc': {
        const snap = await getDoc(docRef(pathSegments));
        return { exists: snap.exists(), id: snap.id, data: snap.exists() ? snap.data() : null };
      }
      case 'setDoc': {
        await setDoc(docRef(pathSegments), decodeData(payload.data || {}), payload.options || {});
        return { ok: true };
      }
      case 'updateDoc': {
        await updateDoc(docRef(pathSegments), decodeData(payload.data || {}));
        return { ok: true };
      }
      case 'deleteDoc': {
        await deleteDoc(docRef(pathSegments));
        return { ok: true };
      }
      case 'addDoc': {
        const added = await addDoc(colRef(pathSegments), decodeData(payload.data || {}));
        return { ok: true, id: added.id };
      }
      case 'query': {
        const base = colRef(pathSegments);
        const qq = applyConstraints(base, payload.constraints || []);
        const snap = await getDocs(qq);
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, data: d.data() }));
        return { docs };
      }
      default:
        throw new Error(`Unsupported firestore op: ${op}`);
    }
  }

  return {
    ensureFirebase,
    login,
    logout,
    createUser,
    call,
    getDocPublic,
  };
}

module.exports = { createFirestoreService };
