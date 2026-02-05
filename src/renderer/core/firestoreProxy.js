// src/renderer/core/firestoreProxy.js
// Firestore proxy that routes all DB CRUD to the main process via IPC.
// This keeps renderer focused on UI/events and avoids exposing DB logic in the renderer.

function assertPath(path) {
  if (!Array.isArray(path) || path.length === 0) throw new Error('Invalid Firestore path');
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Encode special Firestore field values (increment, serverTimestamp)
function encodeFieldValue(value) {
  if (isPlainObject(value) && value.__op === 'increment') return { __op: 'increment', n: value.n };
  if (isPlainObject(value) && value.__op === 'serverTimestamp') return { __op: 'serverTimestamp' };
  return value;
}

function encodeData(obj) {
  if (Array.isArray(obj)) return obj.map(encodeData);
  if (!isPlainObject(obj)) return encodeFieldValue(obj);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeData(v);
  return out;
}

// --- Reference builders (match Firestore SDK call sites) ---
export function doc(_db, ...segments) {
  return { __type: 'doc', path: segments };
}

export function collection(_db, ...segments) {
  return { __type: 'collection', path: segments };
}

export function where(field, op, value) {
  return { __type: 'where', field, op, value };
}

export function orderBy(field, direction = 'asc') {
  return { __type: 'orderBy', field, direction };
}

export function limit(n) {
  return { __type: 'limit', n };
}

export function query(collectionRef, ...constraints) {
  if (!collectionRef || collectionRef.__type !== 'collection') throw new Error('query() expects a collectionRef');
  return {
    __type: 'query',
    path: collectionRef.path,
    constraints: constraints.filter(Boolean)
  };
}

export function increment(n) {
  return { __op: 'increment', n };
}

export function serverTimestamp() {
  return { __op: 'serverTimestamp' };
}

// --- CRUD calls (route to main) ---
async function callMain(payload) {
  if (!window?.bdScanner?.firestore?.call) {
    // Backward compat (older preload)
    if (window?.electronAPI?.firestoreCall) return await window.electronAPI.firestoreCall(payload);
    throw new Error('Firestore IPC is not available (preload missing)');
  }
  return await window.bdScanner.firestore.call(payload);
}

export async function getDoc(docRef) {
  assertPath(docRef?.path);
  const res = await callMain({ op: 'getDoc', path: docRef.path });
  return { exists: () => !!res?.exists, data: () => res?.data || null, id: res?.id };
}

export async function setDoc(docRef, data, options = {}) {
  assertPath(docRef?.path);
  await callMain({ op: 'setDoc', path: docRef.path, data: encodeData(data), options });
}

export async function updateDoc(docRef, data) {
  assertPath(docRef?.path);
  await callMain({ op: 'updateDoc', path: docRef.path, data: encodeData(data) });
}

export async function deleteDoc(docRef) {
  assertPath(docRef?.path);
  await callMain({ op: 'deleteDoc', path: docRef.path });
}

export async function addDoc(collectionRef, data) {
  assertPath(collectionRef?.path);
  const res = await callMain({ op: 'addDoc', path: collectionRef.path, data: encodeData(data) });
  return { id: res?.id };
}

export async function getDocs(q) {
  if (!q || q.__type !== 'query') throw new Error('getDocs() expects a query ref');
  const res = await callMain({ op: 'query', path: q.path, constraints: q.constraints });
  return {
    forEach: (fn) => (res?.docs || []).forEach(d => fn({ id: d.id, data: () => d.data })),
    docs: (res?.docs || []).map(d => ({ id: d.id, data: () => d.data }))
  };
}

export async function runTransaction() {
  throw new Error('runTransaction is not supported via proxy yet');
}
