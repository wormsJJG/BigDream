/**
 * src/main/ipc/iosHandlers.js
 * IPC wiring for iOS features.
 * Responsibility: register IPC handlers only.
 */

const fs = require('fs');
const path = require('path');

function registerIosHandlers({ ipcMain, CONFIG, MockData, iosService, app, BrowserWindow, dialog }) {
  if (!ipcMain) throw new Error('registerIosHandlers requires ipcMain');
  if (!CONFIG) throw new Error('registerIosHandlers requires CONFIG');
  if (!iosService) throw new Error('registerIosHandlers requires iosService');
  if (!app) throw new Error('registerIosHandlers requires app');
  if (!BrowserWindow) throw new Error('registerIosHandlers requires BrowserWindow');
  if (!dialog) throw new Error('registerIosHandlers requires dialog');

  ipcMain.handle('check-ios-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosConnection();
    return await iosService.checkConnection();
  });

  ipcMain.handle('run-ios-scan', async (event, udid, runOptions = {}) => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();

    const onProgress = (payload) => {
      try {
        event.sender.send('ios-scan-progress', payload);
      } catch (_e) { }
    };

    return await iosService.runScan(udid, { ...runOptions, onProgress });
  });

  ipcMain.handle('delete-ios-backup', async (_event, udid) => {
    return await iosService.deleteBackup(udid);
  });

  ipcMain.handle('export-ios-report-pdf', async (event, { fileName } = {}) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mainWindow) {
      return { success: false, error: '메인 창을 찾을 수 없습니다.' };
    }

    const safeName = String(fileName || 'BD_Scanner_Report.pdf').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    const downloadsDir = app.getPath('downloads');
    const defaultPath = path.join(downloadsDir, safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`);

    try {
      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: 'PDF 저장',
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true, message: '저장 취소' };
      }

      const pdfData = await mainWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
      });

      fs.writeFileSync(saveResult.filePath, pdfData);
      return { success: true, filePath: saveResult.filePath };
    } catch (err) {
      console.error('[iOS PDF Export] failed:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIosHandlers };
