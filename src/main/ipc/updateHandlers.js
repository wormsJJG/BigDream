/**
 * src/main/ipc/updateHandlers.js
 * IPC registration for update checking.
 */
function registerUpdateHandlers({ ipcMain, updateService }) {
  if (!ipcMain) throw new Error('registerUpdateHandlers: ipcMain is required');
  if (!updateService) throw new Error('registerUpdateHandlers: updateService is required');

  ipcMain.handle('checkForUpdate', async (_evt, currentVersion) => {
    try {
      return await updateService.checkForUpdate(currentVersion);
    } catch (e) {
      return { available: false, error: e.message, message: '업데이트 서버 접속 실패' };
    }
  });
}

module.exports = { registerUpdateHandlers };
