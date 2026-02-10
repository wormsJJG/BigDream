/**
 * src/main/ipc/iosHandlers.js
 * IPC wiring for iOS features.
 * Responsibility: register IPC handlers only.
 */

function registerIosHandlers({ ipcMain, CONFIG, MockData, iosService }) {
  if (!ipcMain) throw new Error('registerIosHandlers requires ipcMain');
  if (!CONFIG) throw new Error('registerIosHandlers requires CONFIG');
  if (!iosService) throw new Error('registerIosHandlers requires iosService');

  ipcMain.handle('check-ios-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosConnection();
    return await iosService.checkConnection();
  });

  

  ipcMain.handle('check-ios-backup-status', async (_event, udid) => {
    if (CONFIG.IS_DEV_MODE) {
      // In dev mode assume no cache unless mock says otherwise.
      return { exists: false };
    }
    return await iosService.checkBackupStatus(udid);
  });
ipcMain.handle('run-ios-scan', async (_event, udid) => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();
    return await iosService.runScan(udid);
  });

  ipcMain.handle('delete-ios-backup', async (_event, udid) => {
    return await iosService.deleteBackup(udid);
  });
}

module.exports = { registerIosHandlers };
