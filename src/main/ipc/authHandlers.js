/**
 * src/main/ipc/authHandlers.js
 *
 * IPC handlers related to authentication (remember-me).
 * This module should be side-effect free except for ipcMain registration.
 */

const IPC_MODULE = require('../../shared/ipc/ipcChannels');
const IPC = IPC_MODULE.default || IPC_MODULE;

function registerAuthHandlers({ ipcMain, loginStorage }) {
  if (!ipcMain) throw new Error('authHandlers: ipcMain is required');
  if (!loginStorage) throw new Error('authHandlers: loginStorage is required');

  ipcMain.handle(IPC.APP.SAVE_LOGIN_INFO, async (_event, { id, pw, remember }) => {
    try {
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

module.exports = { registerAuthHandlers };
