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

  ipcMain.handle('run-ios-scan', async (event, udid) => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();

    const onProgress = (payload) => {
      try {
        event.sender.send('ios-scan-progress', payload);
      } catch (_e) { }
    };

    return await iosService.runScan(udid, { onProgress });
  });

  ipcMain.handle('delete-ios-backup', async (_event, udid) => {
    return await iosService.deleteBackup(udid);
  });
}

module.exports = { registerIosHandlers };
