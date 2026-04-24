"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAndroidHandlers = registerAndroidHandlers;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const IPC = require('../../shared/ipc/ipcChannels.js');
const playPreviewCache = new Map();
async function loadGooglePlayScraper() {
    const mod = await import('google-play-scraper');
    return mod.default || mod;
}
async function getGooglePlayPreview(packageName) {
    const normalizedPackage = String(packageName || '').trim();
    if (!normalizedPackage)
        return null;
    const cached = playPreviewCache.get(normalizedPackage);
    if (cached)
        return cached;
    const previewPromise = (async () => {
        try {
            const gplay = await loadGooglePlayScraper();
            const result = await Promise.race([
                gplay.app({ appId: normalizedPackage, lang: 'ko', country: 'kr' }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('PLAY_LOOKUP_TIMEOUT')), 2500))
            ]);
            return {
                title: String(result?.title || ''),
                icon: result?.icon ? String(result.icon) : null
            };
        }
        catch (_error) {
            return null;
        }
    })();
    playPreviewCache.set(normalizedPackage, previewPromise);
    return previewPromise;
}
function streamToPromise(stream) {
    return new Promise((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', (error) => reject(error));
    });
}
function fallbackTitle(packageName, utils) {
    if (utils?.formatAppName)
        return utils.formatAppName(packageName);
    const parts = String(packageName || '').split('.');
    const raw = parts[parts.length - 1] || packageName || 'Unknown';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}
function registerAndroidHandlers(options) {
    const { ipcMain, CONFIG, MockData, Utils, client, androidService, app, BrowserWindow } = options;
    if (!ipcMain)
        throw new Error('registerAndroidHandlers requires ipcMain');
    if (!CONFIG)
        throw new Error('registerAndroidHandlers requires CONFIG');
    if (!MockData)
        throw new Error('registerAndroidHandlers requires MockData');
    if (!client)
        throw new Error('registerAndroidHandlers requires client');
    if (!androidService)
        throw new Error('registerAndroidHandlers requires androidService');
    if (!app)
        throw new Error('registerAndroidHandlers requires app');
    if (!BrowserWindow)
        throw new Error('registerAndroidHandlers requires BrowserWindow');
    ipcMain.handle(IPC.ANDROID.CHECK_DEVICE_CONNECTION, async () => {
        if (CONFIG.IS_DEV_MODE)
            return MockData.getAndroidConnection();
        return await androidService.checkConnection();
    });
    ipcMain.handle(IPC.ANDROID.RUN_SCAN, async () => {
        if (CONFIG.IS_DEV_MODE)
            return MockData.getAndroidScanResult();
        return await androidService.runScan();
    });
    ipcMain.handle(IPC.ANDROID.GET_APP_DATA, async (_event, packageName) => {
        try {
            if (!packageName)
                return null;
            const devices = await client.listDevices();
            const serial = devices?.[0]?.id;
            if (!serial)
                return { title: fallbackTitle(packageName, Utils), icon: null };
            const apps = await androidService.getInstalledApps(serial);
            const appRecord = Array.isArray(apps)
                ? apps.find((item) => String(item?.packageName || '') === String(packageName))
                : null;
            const fallback = {
                title: String(appRecord?.cachedTitle || fallbackTitle(packageName, Utils)),
                icon: appRecord?.cachedIconUrl || null
            };
            if (fallback.icon)
                return fallback;
            const isStoreApp = Boolean(appRecord &&
                appRecord.isSystemApp !== true &&
                appRecord.isSideloaded === false);
            if (!isStoreApp)
                return fallback;
            const playPreview = await getGooglePlayPreview(packageName);
            if (!playPreview)
                return fallback;
            return {
                title: String(playPreview.title || fallback.title),
                icon: playPreview.icon || fallback.icon
            };
        }
        catch (_error) {
            return { title: fallbackTitle(packageName, Utils), icon: null };
        }
    });
    ipcMain.handle(IPC.ANDROID.GET_GRANTED_PERMISSIONS, async (_event, packageName) => {
        return await androidService.getGrantedPermissions(packageName);
    });
    ipcMain.handle(IPC.ANDROID.UNINSTALL_APP, async (_event, packageName) => {
        return await androidService.uninstallApp(packageName);
    });
    ipcMain.handle(IPC.ANDROID.NEUTRALIZE_APP, async (_event, packageName, perms) => {
        return await androidService.neutralizeApp(packageName, perms);
    });
    ipcMain.handle(IPC.ANDROID.DELETE_APK_FILE, async (_event, payload) => {
        return await androidService.deleteApkFile(payload?.serial, payload?.filePath);
    });
    ipcMain.handle(IPC.ANDROID.AUTO_PUSH_REPORT, async () => {
        try {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (!mainWindow?.webContents) {
                return { success: false, error: '메인 창을 찾을 수 없습니다.' };
            }
            const devices = await client.listDevices();
            const serial = devices?.[0]?.id;
            if (!serial) {
                return { success: false, error: '연결된 Android 기기가 없습니다.' };
            }
            if (typeof client.push !== 'function') {
                return { success: false, error: 'ADB push를 지원하지 않습니다.' };
            }
            const pdfData = await mainWindow.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4'
            });
            const now = new Date();
            const fileName = `BD_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${Date.now()}.pdf`;
            const tempPath = (0, path_1.join)(app.getPath('temp'), fileName);
            const remotePath = `/sdcard/Download/${fileName}`;
            (0, fs_1.writeFileSync)(tempPath, pdfData);
            try {
                const transfer = await client.push(serial, tempPath, remotePath);
                await streamToPromise(transfer);
            }
            finally {
                try {
                    (0, fs_1.unlinkSync)(tempPath);
                }
                catch (_e) { }
            }
            return { success: true, filePath: remotePath };
        }
        catch (error) {
            return { success: false, error: error?.message || String(error) };
        }
    });
    ipcMain.handle(IPC.ANDROID.GET_DASHBOARD_DATA, async (_event, payload) => {
        return await androidService.getDashboardData(payload?.serial);
    });
    ipcMain.handle(IPC.ANDROID.GET_DEVICE_SECURITY_STATUS, async (_event, payload) => {
        return await androidService.getDeviceSecurityStatus(payload?.serial);
    });
    ipcMain.handle(IPC.ANDROID.PERFORM_DEVICE_SECURITY_ACTION, async (_event, payload) => {
        return await androidService.performDeviceSecurityAction(payload?.serial, payload?.action ?? payload);
    });
    ipcMain.handle(IPC.ANDROID.SET_DEVICE_SECURITY_SETTING, async (_event, payload) => {
        return await androidService.setDeviceSecuritySetting(payload?.serial, payload?.settingId, payload?.enabled);
    });
    ipcMain.handle(IPC.ANDROID.OPEN_ANDROID_SETTINGS, async (_event, payload) => {
        return await androidService.openAndroidSettings(payload?.serial, payload?.screen);
    });
}
