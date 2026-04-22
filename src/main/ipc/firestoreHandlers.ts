import { registerFirestoreHandlers as registerFirestoreHandlersJs } from './firestoreHandlers.js';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type FirestoreServiceLike = {
    login(email: string, password: string): Promise<unknown>;
    logout(): Promise<unknown>;
    createUser(email: string, password: string): Promise<unknown>;
    call(payload: Record<string, unknown>, options?: { requireAuth?: boolean }): Promise<unknown>;
};

export function registerFirestoreHandlers(options: {
    ipcMain: IpcMainLike;
    firestoreService: FirestoreServiceLike;
}) {
    return registerFirestoreHandlersJs(options);
}

