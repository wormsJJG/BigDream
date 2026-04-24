type IpcChannelsModule = typeof import('../../shared/ipc/ipcChannels');
declare function require(name: '../../shared/ipc/ipcChannels.js'): IpcChannelsModule & { default: IpcChannelsModule['default'] };
const IPC = require('../../shared/ipc/ipcChannels.js').default;
import type { createFirestoreService } from '../services/firestoreService';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type LoginPayload = { email: string; password: string };

type FirestoreServiceLike = ReturnType<typeof createFirestoreService>;
type FirestoreCallPayload = Parameters<FirestoreServiceLike['call']>[0];

export function registerFirestoreHandlers(options: {
    ipcMain: IpcMainLike;
    firestoreService: FirestoreServiceLike;
}): void {
    const { ipcMain, firestoreService } = options;

    if (!ipcMain) throw new Error('registerFirestoreHandlers: ipcMain is required');
    if (!firestoreService) throw new Error('registerFirestoreHandlers: firestoreService is required');

    ipcMain.handle(IPC.AUTH.LOGIN, async (_evt, payload) => {
        const { email, password } = payload as LoginPayload;
        return await firestoreService.login(email, password);
    });

    ipcMain.handle(IPC.AUTH.LOGOUT, async () => {
        return await firestoreService.logout();
    });

    ipcMain.handle(IPC.AUTH.CREATE_USER, async (_evt, payload) => {
        const { email, password } = payload as LoginPayload;
        return await firestoreService.createUser(email, password);
    });

    ipcMain.handle(IPC.FIRESTORE.CALL, async (_evt, payload) => {
        return await firestoreService.call(payload as FirestoreCallPayload, { requireAuth: true });
    });
}
