import type { FirestoreService } from '../../types/renderer-context';

type FirestoreProxyShape = FirestoreService;

export function createFirestoreService(proxy: FirestoreProxyShape): FirestoreService {
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
    limit: proxy.limit,
    startAfter: proxy.startAfter
  };
}
