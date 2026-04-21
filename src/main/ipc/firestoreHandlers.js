const IPC = require('../../shared/ipcChannels');

/**
 * src/main/ipc/firestoreHandlers.js
 * IPC registration for Firebase Auth + Firestore proxy.
 */
function registerFirestoreHandlers({ ipcMain, firestoreService }) {
  if (!ipcMain) throw new Error('registerFirestoreHandlers: ipcMain is required');
  if (!firestoreService) throw new Error('registerFirestoreHandlers: firestoreService is required');

  ipcMain.handle(IPC.AUTH.LOGIN, async (_evt, { email, password }) => {
    return await firestoreService.login(email, password);
  });

  ipcMain.handle(IPC.AUTH.LOGOUT, async () => {
    return await firestoreService.logout();
  });

  ipcMain.handle(IPC.AUTH.CREATE_USER, async (_evt, { email, password }) => {
    return await firestoreService.createUser(email, password);
  });

  ipcMain.handle(IPC.FIRESTORE.CALL, async (_evt, payload) => {
    // Renderer should login first so rules work; enforce by default.
    return await firestoreService.call(payload, { requireAuth: true });
  });
}

module.exports = { registerFirestoreHandlers };
