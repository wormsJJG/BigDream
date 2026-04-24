"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthHandlers = registerAuthHandlers;
const IPC = require('../../shared/ipc/ipcChannels.js');
function registerAuthHandlers(options) {
    const { ipcMain, loginStorage } = options;
    if (!ipcMain)
        throw new Error('authHandlers: ipcMain is required');
    if (!loginStorage)
        throw new Error('authHandlers: loginStorage is required');
    ipcMain.handle(IPC.APP.SAVE_LOGIN_INFO, async (_event, payload) => {
        try {
            const { id, pw, remember } = payload;
            return loginStorage.save({ id, pw, remember });
        }
        catch (error) {
            console.error('로그인 정보 저장 실패:', error);
            return { success: false };
        }
    });
    ipcMain.handle(IPC.APP.GET_LOGIN_INFO, async () => {
        try {
            return loginStorage.load();
        }
        catch (error) {
            console.error('로그인 정보 로드 실패:', error);
            return { remember: false, id: '', pw: '' };
        }
    });
}
