/**
 * src/main/ipc/androidHandlers.js
 * IPC wiring for Android features.
 * Responsibility: register IPC handlers only
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

  // --------------------------------------------------
  // Device connection
  // --------------------------------------------------
  ipcMain.handle('check-device-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getAndroidConnection();
    return await androidService.checkConnection();
  });

  // --------------------------------------------------
  // Run scan
  // --------------------------------------------------
  ipcMain.handle('run-scan', async () => {
    if (CONFIG.IS_DEV_MODE) {
      return MockData.getAndroidScanResult?.() || { error: 'DEV scan result not implemented' };
    }
    try {
      return await androidService.runScan();
    } catch (err) {
      console.error(err);
      return { error: err.message };
    }
  });

  // --------------------------------------------------
  // ✅ Android Dashboard Realtime Data (ONLY ONE)
  // --------------------------------------------------
  ipcMain.handle('get-android-dashboard-data', async (_event, { serial } = {}) => {
    if (CONFIG.IS_DEV_MODE) {
      return MockData.getAndroidDashboardData?.() || {
        ok: true,
        metrics: {
          batteryLevel: 90,
          memUsagePercent: 40,
          deviceTempC: 18.3,
          connected: true,
        },
        spec: {
          model: 'SM-X205N',
          os: 'ANDROID',
          serial: serial || '-',
          rooted: false,
        },
        top: [],
      };
    }

    try {
      return await androidService.getDashboardData(serial);
    } catch (err) {
      console.error('[get-android-dashboard-data] failed:', err);
      return { ok: false, error: err.message };
    }
  });

  // --------------------------------------------------
  // App uninstall
  // --------------------------------------------------
  ipcMain.handle('uninstall-app', async (_event, packageName) => {
    if (CONFIG.IS_DEV_MODE) {
      await Utils.sleep(1000);
      return { success: true };
    }
    return await androidService.uninstallApp(packageName);
  });

  // --------------------------------------------------
  // Delete APK
  // --------------------------------------------------
  ipcMain.handle('delete-apk-file', async (_event, { serial, filePath }) => {
    if (CONFIG.IS_DEV_MODE) return { success: true };
    return await androidService.deleteApkFile(serial, filePath);
  });

  // --------------------------------------------------
  // Neutralize app
  // --------------------------------------------------
  ipcMain.handle('neutralize-app', async (_event, packageName) => {
    if (CONFIG.IS_DEV_MODE) {
      await Utils.sleep(1500);
      return { success: true, count: 5 };
    }
    return await androidService.neutralizeApp(packageName);
  });

  // --------------------------------------------------
  // Get app icon / title
  // --------------------------------------------------
  ipcMain.handle('get-app-data', async (_event, packageName) => {
    if (CONFIG.IS_DEV_MODE || !packageName) return null;

    try {
      if (typeof gplay.app !== 'function') return null;

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

  // --------------------------------------------------
  // Push report to Android
  // --------------------------------------------------
  ipcMain.handle('auto-push-report-to-android', async (event) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);
    const tempPdfPath = path.join(app.getPath('temp'), 'BD_Scanner_Report.pdf');

    try {
      const pdfData = await mainWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
      });

      fs.writeFileSync(tempPdfPath, pdfData);

      const devices = await client.listDevices();
      if (devices.length === 0) throw new Error('기기 연결 안 됨');

      const serial = devices[0].id;
      const remotePath = '/storage/emulated/0/Download/BD_Scanner_Report.pdf';

      await client.push(serial, tempPdfPath, remotePath);
      fs.unlinkSync(tempPdfPath);

      return { success: true, remotePath };
    } catch (err) {
      console.error(err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerAndroidHandlers };
