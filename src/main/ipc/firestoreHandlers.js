/**
 * src/main/ipc/firestoreHandlers.js
 * IPC registration for Firebase Auth + Firestore proxy.
 */
function registerFirestoreHandlers({ ipcMain, firestoreService }) {
  if (!ipcMain) throw new Error('registerFirestoreHandlers: ipcMain is required');
  if (!firestoreService) throw new Error('registerFirestoreHandlers: firestoreService is required');

  ipcMain.handle('firebase-auth-login', async (_evt, { email, password }) => {
    return await firestoreService.login(email, password);
  });

  ipcMain.handle('firebase-auth-logout', async () => {
    return await firestoreService.logout();
  });

  ipcMain.handle('firebase-auth-create-user', async (_evt, { email, password }) => {
    return await firestoreService.createUser(email, password);
  });

  ipcMain.handle('firestore-call', async (_evt, payload) => {
    // Renderer should login first so rules work; enforce by default.
    return await firestoreService.call(payload, { requireAuth: true });
  });
}

module.exports = { registerFirestoreHandlers };
