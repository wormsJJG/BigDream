/**
 * src/main/ipc/authHandlers.js
 *
 * IPC handlers related to authentication (remember-me).
 * This module should be side-effect free except for ipcMain registration.
 */

function registerAuthHandlers({ ipcMain, loginStorage }) {
  if (!ipcMain) throw new Error('authHandlers: ipcMain is required');
  if (!loginStorage) throw new Error('authHandlers: loginStorage is required');

  ipcMain.handle('saveLoginInfo', async (_event, { id, pw, remember }) => {
    try {
      return loginStorage.save({ id, pw, remember });
    } catch (error) {
      console.error('로그인 정보 저장 실패:', error);
      return { success: false };
    }
  });

  ipcMain.handle('getLogininfo', async () => {
    try {
      return loginStorage.load();
    } catch (error) {
      console.error('로그인 정보 로드 실패:', error);
      return { remember: false, id: '', pw: '' };
    }
  });
}

module.exports = { registerAuthHandlers };
