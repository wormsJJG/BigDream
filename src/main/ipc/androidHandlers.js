/**
 * src/main/ipc/androidHandlers.js
 * IPC wiring for Android features.
 * Responsibility: register IPC handlers only
 */

const fs = require('fs');
const path = require('path');
const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const IPC = require('../../shared/ipcChannels');

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
  ipcMain.handle(IPC.ANDROID.CHECK_DEVICE_CONNECTION, async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getAndroidConnection();
    return await androidService.checkConnection();
  });

  // --------------------------------------------------
  // Run scan
  // --------------------------------------------------
  ipcMain.handle(IPC.ANDROID.RUN_SCAN, async () => {
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
  ipcMain.handle(IPC.ANDROID.GET_DASHBOARD_DATA, async (_event, { serial } = {}) => {
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
  // ✅ Device Security Status (Android results-only)
  // --------------------------------------------------
  ipcMain.handle(IPC.ANDROID.GET_DEVICE_SECURITY_STATUS, async (_event, { serial } = {}) => {
    if (CONFIG.IS_DEV_MODE) {
      return {
        ok: true,
        items: [
          { id: 'devOptions', title: '개발자 옵션', status: 'ON', level: 'warn' },
          { id: 'usbDebug', title: 'USB 디버깅', status: 'ON', level: 'info', note: '검사를 위해 일시적으로 사용됩니다. 검사 종료 시 비활성화됩니다.' },
        ],
      };
    }

    try {
      return await androidService.getDeviceSecurityStatus(serial);
    } catch (err) {
      console.error('[get-device-security-status] failed:', err);
      return { ok: false, error: err.message, items: [] };
    }
  });

  // --------------------------------------------------
  // ✅ Device Security Actions (toggle / open settings)
  // --------------------------------------------------
  // Legacy/compat channel used by renderer patches.
  // action: { kind: 'toggle'|'openSettings', target?, value?, intent? }
  ipcMain.handle(IPC.ANDROID.PERFORM_DEVICE_SECURITY_ACTION, async (_event, { serial, action } = {}) => {
    try {
      return await androidService.performDeviceSecurityAction(serial, action);
    } catch (err) {
      console.error('[perform-device-security-action] failed:', err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.ANDROID.SET_DEVICE_SECURITY_SETTING, async (_event, { serial, settingId, enabled } = {}) => {
    if (CONFIG.IS_DEV_MODE) {
      return { ok: true, changed: true, settingId, enabled: !!enabled };
    }

    try {
      return await androidService.setDeviceSecuritySetting(serial, settingId, enabled);
    } catch (err) {
      console.error('[set-device-security-setting] failed:', err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.ANDROID.OPEN_ANDROID_SETTINGS, async (_event, { serial, screen } = {}) => {
    if (CONFIG.IS_DEV_MODE) {
      return { ok: true, opened: true, screen: screen || 'UNKNOWN' };
    }

    try {
      return await androidService.openAndroidSettings(serial, screen);
    } catch (err) {
      console.error('[open-android-settings] failed:', err);
      return { ok: false, error: err.message };
    }
  });

  // --------------------------------------------------
  // App uninstall
  // --------------------------------------------------
  ipcMain.handle(IPC.ANDROID.UNINSTALL_APP, async (_event, packageName) => {
    if (CONFIG.IS_DEV_MODE) {
      await Utils.sleep(1000);
      return { success: true };
    }
    return await androidService.uninstallApp(packageName);
  });

  // --------------------------------------------------
  // Delete APK
  // --------------------------------------------------
  ipcMain.handle(IPC.ANDROID.DELETE_APK_FILE, async (_event, { serial, filePath }) => {
    if (CONFIG.IS_DEV_MODE) return { success: true };
    return await androidService.deleteApkFile(serial, filePath);
  });

  // --------------------------------------------------
  // Neutralize app
  // --------------------------------------------------
  ipcMain.handle(IPC.ANDROID.NEUTRALIZE_APP, async (_event, packageName, perms) => {
    if (CONFIG.IS_DEV_MODE) {
      await Utils.sleep(1500);
      return { success: true, count: (perms?.length ?? 0)};
    }
    console.log('[neutralize-app] perms:', perms);
    return await androidService.neutralizeApp(packageName, perms);
  });

  ipcMain.handle(IPC.ANDROID.GET_GRANTED_PERMISSIONS, async (_event, packageName) => {
  if (CONFIG.IS_DEV_MODE) {
    return [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_FINE_LOCATION'
    ];
  }
  return await androidService.getGrantedPermissions(packageName);
  });

  // --------------------------------------------------
  // Get app icon / title
  // --------------------------------------------------
  ipcMain.handle(IPC.ANDROID.GET_APP_DATA, async (_event, packageName) => {
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
  ipcMain.handle(IPC.ANDROID.AUTO_PUSH_REPORT, async (event) => {
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
