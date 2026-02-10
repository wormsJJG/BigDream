// src/renderer/services/firestoreService.js
// Renderer-side Firestore service. Uses the IPC-backed proxy (no direct Firebase SDK import).

export function createFirestoreService(proxy) {
  // proxy is the module exported from ../core/firestoreProxy.js
  return {
    doc: proxy.doc,
    getDoc: proxy.getDoc,
    updateDoc: proxy.updateDoc,
    collection: proxy.collection,
    getDocs: proxy.getDocs,
    setDoc: proxy.setDoc,
    query: proxy.query,
    orderBy: proxy.orderBy,
    where: proxy.where,
    runTransaction: proxy.runTransaction,
    addDoc: proxy.addDoc,
    serverTimestamp: proxy.serverTimestamp,
    deleteDoc: proxy.deleteDoc,
    increment: proxy.increment,
    limit: proxy.limit
  };
}
