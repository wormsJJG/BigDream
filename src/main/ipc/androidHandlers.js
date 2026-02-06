/**
 * src/main/ipc/androidHandlers.js
 * IPC wiring for Android features.
 * Responsibility: register IPC handlers only (validation + delegate to service).
 */

const fs = require('fs');
const path = require('path');
const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;

function registerAndroidHandlers({
  ipcMain,
  CONFIG,
  MockData,
  Utils,
  client,
  androidService,
  log,
  app,
  BrowserWindow,
}) {
  if (!ipcMain) throw new Error('registerAndroidHandlers requires ipcMain');
  if (!CONFIG) throw new Error('registerAndroidHandlers requires CONFIG');
  if (!client) throw new Error('registerAndroidHandlers requires client');
  if (!androidService) throw new Error('registerAndroidHandlers requires androidService');

  ipcMain.handle('check-device-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getAndroidConnection();
    return await androidService.checkConnection();
  });

  ipcMain.handle('run-scan', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getAndroidScanResult?.() || { error: 'DEV scan result is not implemented' };
    try {
      return await androidService.runScan();
    } catch (err) {
      console.error(err);
      return { error: err.message };
    }
  });

  ipcMain.handle('uninstall-app', async (_event, packageName) => {
    console.log(`--- [Android] 앱 삭제 요청: ${packageName} ---`);
    if (CONFIG.IS_DEV_MODE) {
      await Utils.sleep(1000);
      return { success: true, message: '[DEV] 가상 삭제 성공' };
    }
    return await androidService.uninstallApp(packageName);
  });

  ipcMain.handle('delete-apk-file', async (_event, { serial, filePath }) => {
    if (CONFIG.IS_DEV_MODE) return { success: true };
    return await androidService.deleteApkFile(serial, filePath);
  });

  ipcMain.handle('neutralize-app', async (_event, packageName) => {
    console.log(`--- [Android] 앱 무력화 요청: ${packageName} ---`);
    if (CONFIG.IS_DEV_MODE) {
      await Utils.sleep(1500);
      return { success: true, count: 5 };
    }
    return await androidService.neutralizeApp(packageName);
  });

  ipcMain.handle('get-app-data', async (_event, packageName) => {
    if (CONFIG.IS_DEV_MODE || !packageName) return null;

    try {
      if (typeof gplay.app !== 'function') {
        console.error('[Error] gplay.app 함수를 찾을 수 없습니다. gplay 객체:', gplay);
        return null;
      }

      const appData = await gplay.app({
        appId: packageName,
        lang: 'ko',
        country: 'kr',
      });

      return { icon: appData.icon, title: appData.title };
    } catch (err) {
      if (err.status !== 404) {
        console.warn(`[Icon Fetch Fail] ${packageName}:`, err.message);
      }
      return null;
    }
  });

  ipcMain.handle('auto-push-report-to-android', async (event) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    const tempPdfPath = path.join(app.getPath('temp'), `BD_Scanner_Report.pdf`);

    try {
      const pdfData = await mainWindow.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4',
      });

      fs.writeFileSync(tempPdfPath, pdfData);

      const devices = await client.listDevices();
      if (devices.length === 0) throw new Error('기기가 연결되어 있지 않습니다.');
      const serial = devices[0].id;

      const remotePath = `/storage/emulated/0/Download/BD_Scanner_Report.pdf`;
      await client.push(serial, tempPdfPath, remotePath);

      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

      return { success: true, remotePath };
    } catch (err) {
      console.error('휴대폰 자동 전송 실패:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerAndroidHandlers };
