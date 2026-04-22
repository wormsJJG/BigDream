import { registerAuthHandlers as registerAuthHandlersJs } from './authHandlers.js';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type LoginStorageLike = {
    save(args: { id: string; pw: string; remember: boolean }): unknown;
    load(): unknown;
};

export function registerAuthHandlers(options: {
    ipcMain: IpcMainLike;
    loginStorage: LoginStorageLike;
}) {
    return registerAuthHandlersJs(options);
}

