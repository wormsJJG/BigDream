/**
 * src/main/ipc/iosHandlers.js
 * IPC wiring for iOS features.
 * Responsibility: register IPC handlers only.
 */

const fs = require('fs');
const path = require('path');
const IPC_MODULE = require('../../shared/ipc/ipcChannels');
const IPC = IPC_MODULE.default || IPC_MODULE;

function registerIosHandlers({ ipcMain, CONFIG, MockData, iosService, app, BrowserWindow, dialog, Utils }) {
  if (!ipcMain) throw new Error('registerIosHandlers requires ipcMain');
  if (!CONFIG) throw new Error('registerIosHandlers requires CONFIG');
  if (!iosService) throw new Error('registerIosHandlers requires iosService');
  if (!app) throw new Error('registerIosHandlers requires app');
  if (!BrowserWindow) throw new Error('registerIosHandlers requires BrowserWindow');
  if (!dialog) throw new Error('registerIosHandlers requires dialog');
  if (!Utils) throw new Error('registerIosHandlers requires Utils');

  ipcMain.handle(IPC.IOS.CHECK_CONNECTION, async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosConnection();
    return await iosService.checkConnection();
  });

  ipcMain.handle(IPC.IOS.RUN_SCAN, async (event, udid, runOptions = {}) => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();

    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    const prerequisitesReady = await Utils.checkAndInstallPrerequisites(mainWindow);
    if (!prerequisitesReady) {
      return { error: 'iOS 정밀 분석에 필요한 구성 요소가 준비되지 않았습니다.' };
    }

    const onProgress = (payload) => {
      try {
        event.sender.send(IPC.IOS.PROGRESS, payload);
      } catch (_e) { }
    };

    return await iosService.runScan(udid, { ...runOptions, onProgress });
  });

  ipcMain.handle(IPC.IOS.DELETE_BACKUP, async (_event, udid) => {
    return await iosService.deleteBackup(udid);
  });

  ipcMain.handle(IPC.IOS.EXPORT_REPORT_PDF, async (event, { fileName } = {}) => {
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
