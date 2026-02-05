// src/preload/preload.js
// Security-first preload: expose ONLY whitelisted APIs.

const { contextBridge, ipcRenderer } = require('electron');
const IPC = require('../shared/ipcChannels');

console.log('--- preload.js: 로드됨 ---');

// ✅ Structured API (recommended)
const bdScanner = {
    app: {
        forceWindowReset: () => ipcRenderer.invoke(IPC.APP.FORCE_WINDOW_RESET),
        checkForUpdate: (currentVersion) => ipcRenderer.invoke(IPC.APP.CHECK_FOR_UPDATE, currentVersion),
        saveScanResult: (data) => ipcRenderer.invoke(IPC.APP.SAVE_SCAN_RESULT, data),
        saveLoginInfo: (data) => ipcRenderer.invoke(IPC.APP.SAVE_LOGIN_INFO, data),
        getLoginInfo: () => ipcRenderer.invoke(IPC.APP.GET_LOGIN_INFO),
        onUpdateStart: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_START, (event, version) => callback(version)),
        onUpdateProgress: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_PROGRESS, (event, data) => callback(data)),
        onUpdateError: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_ERROR, (event, msg) => callback(msg))
    },
    android: {
        checkDeviceConnection: () => ipcRenderer.invoke(IPC.ANDROID.CHECK_DEVICE_CONNECTION),
        runScan: () => ipcRenderer.invoke(IPC.ANDROID.RUN_SCAN),
        openScanFile: () => ipcRenderer.invoke(IPC.ANDROID.OPEN_SCAN_FILE),
        getAppData: (packageName) => ipcRenderer.invoke(IPC.ANDROID.GET_APP_DATA, packageName),
        uninstallApp: (packageName) => ipcRenderer.invoke(IPC.ANDROID.UNINSTALL_APP, packageName),
        neutralizeApp: (pkg) => ipcRenderer.invoke(IPC.ANDROID.NEUTRALIZE_APP, pkg),
        deleteApkFile: (data) => ipcRenderer.invoke(IPC.ANDROID.DELETE_APK_FILE, data),
        autoPushReportToAndroid: () => ipcRenderer.invoke(IPC.ANDROID.AUTO_PUSH_REPORT),
        startFullScan: () => ipcRenderer.invoke(IPC.ANDROID.START_FULL_SCAN)
    },
    ios: {
        checkConnection: () => ipcRenderer.invoke(IPC.IOS.CHECK_CONNECTION),
        runScan: (udid) => ipcRenderer.invoke(IPC.IOS.RUN_SCAN, udid),
        deleteBackup: (udid) => ipcRenderer.invoke(IPC.IOS.DELETE_BACKUP, udid)
    }
};

// ✅ Backward-compatible API (do NOT remove yet)
// Existing renderer code uses window.electronAPI.*
const electronAPI = {
    checkDeviceConnection: bdScanner.android.checkDeviceConnection,
    runScan: bdScanner.android.runScan,
    openScanFile: bdScanner.android.openScanFile,
    forceWindowReset: bdScanner.app.forceWindowReset,
    getAppData: bdScanner.android.getAppData,
    uninstallApp: bdScanner.android.uninstallApp,
    neutralizeApp: bdScanner.android.neutralizeApp,
    checkIosConnection: bdScanner.ios.checkConnection,
    runIosScan: bdScanner.ios.runScan,
    deleteIosBackup: bdScanner.ios.deleteBackup,
    deleteApkFile: bdScanner.android.deleteApkFile,
    saveScanResult: bdScanner.app.saveScanResult,
    checkForUpdate: bdScanner.app.checkForUpdate,
    saveLoginInfo: bdScanner.app.saveLoginInfo,
    getLoginInfo: bdScanner.app.getLoginInfo,
    onUpdateStart: bdScanner.app.onUpdateStart,
    onUpdateProgress: bdScanner.app.onUpdateProgress,
    onUpdateError: bdScanner.app.onUpdateError,
    autoPushReportToAndroid: bdScanner.android.autoPushReportToAndroid,
    startFullScan: bdScanner.android.startFullScan
};

contextBridge.exposeInMainWorld('bdScanner', bdScanner);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

console.log('--- preload.js: bdScanner / electronAPI 브릿지 생성 완료 ---');
