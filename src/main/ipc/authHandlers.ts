type IpcChannelsModule = typeof import('../../shared/ipc/ipcChannels');
declare function require(name: '../../shared/ipc/ipcChannels.js'): IpcChannelsModule & { default: IpcChannelsModule['default'] };
const IPC = require('../../shared/ipc/ipcChannels.js').default;
import type { createLoginStorage } from '../services/loginStorage';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type LoginStorageSavePayload = {
    id: string;
    pw: string;
    remember: boolean;
};

type LoginStorageLike = ReturnType<typeof createLoginStorage>;

export function registerAuthHandlers(options: {
    ipcMain: IpcMainLike;
    loginStorage: LoginStorageLike;
}): void {
    const { ipcMain, loginStorage } = options;

    if (!ipcMain) throw new Error('authHandlers: ipcMain is required');
    if (!loginStorage) throw new Error('authHandlers: loginStorage is required');

    ipcMain.handle(IPC.APP.SAVE_LOGIN_INFO, async (_event, payload) => {
        try {
            const { id, pw, remember } = payload as LoginStorageSavePayload;
            return loginStorage.save({ id, pw, remember });
        } catch (error) {
            console.error('로그인 정보 저장 실패:', error);
            return { success: false };
        }
    });

    ipcMain.handle(IPC.APP.GET_LOGIN_INFO, async () => {
        try {
            return loginStorage.load();
        } catch (error) {
            console.error('로그인 정보 로드 실패:', error);
            return { remember: false, id: '', pw: '' };
        }
    });
}
