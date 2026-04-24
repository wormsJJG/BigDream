"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFirestoreHandlers = registerFirestoreHandlers;
const IPC = require('../../shared/ipc/ipcChannels.js');
function registerFirestoreHandlers(options) {
    const { ipcMain, firestoreService } = options;
    if (!ipcMain)
        throw new Error('registerFirestoreHandlers: ipcMain is required');
    if (!firestoreService)
        throw new Error('registerFirestoreHandlers: firestoreService is required');
    ipcMain.handle(IPC.AUTH.LOGIN, async (_evt, payload) => {
        const { email, password } = payload;
        return await firestoreService.login(email, password);
    });
    ipcMain.handle(IPC.AUTH.LOGOUT, async () => {
        return await firestoreService.logout();
    });
    ipcMain.handle(IPC.AUTH.CREATE_USER, async (_evt, payload) => {
        const { email, password } = payload;
        return await firestoreService.createUser(email, password);
    });
    ipcMain.handle(IPC.FIRESTORE.CALL, async (_evt, payload) => {
        return await firestoreService.call(payload, { requireAuth: true });
    });
}
