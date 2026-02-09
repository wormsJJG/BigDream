// preload.js (root entry)
//
// Why this file contains the full implementation:
// - Some Electron setups (e.g., webpack / electron-webpack) execute preload scripts
//   from a sandbox bundle where relative `require('./src/...')` cannot resolve.
// - To keep runtime stable, we avoid requiring project-relative modules here.
//
// Security-first preload: expose ONLY whitelisted APIs.

const { contextBridge, ipcRenderer } = require('electron');

// IPC channel names (inlined for maximum compatibility)
const IPC = {
    ANDROID: {
        CHECK_DEVICE_CONNECTION: 'check-device-connection',
        RUN_SCAN: 'run-scan',
        OPEN_SCAN_FILE: 'open-scan-file',
        GET_APP_DATA: 'get-app-data',
        UNINSTALL_APP: 'uninstall-app',
        NEUTRALIZE_APP: 'neutralize-app',
        DELETE_APK_FILE: 'delete-apk-file',
        AUTO_PUSH_REPORT: 'auto-push-report-to-android',
        START_FULL_SCAN: 'start-full-scan',
        GET_DASHBOARD_DATA: 'get-android-dashboard-data'
    },
    IOS: {
        CHECK_CONNECTION: 'check-ios-connection',
        RUN_SCAN: 'run-ios-scan',
        DELETE_BACKUP: 'delete-ios-backup'
    },
    APP: {
        FORCE_WINDOW_RESET: 'force-window-reset',
        SAVE_SCAN_RESULT: 'saveScanResult',
        CHECK_FOR_UPDATE: 'checkForUpdate',
        SAVE_LOGIN_INFO: 'saveLoginInfo',
        GET_LOGIN_INFO: 'getLogininfo',
        READ_TEXT_FILE: 'read-text-file'
    },
    FIRESTORE: {
        CALL: 'firestore-call'
    },
    EVENTS: {
        UPDATE_START: 'update-start',
        UPDATE_PROGRESS: 'update-progress',
        UPDATE_ERROR: 'update-error'
    }
};

// ✅ Structured API (recommended)
const bdScanner = {
    app: {
        forceWindowReset: () => ipcRenderer.invoke(IPC.APP.FORCE_WINDOW_RESET),
        checkForUpdate: (currentVersion) => ipcRenderer.invoke(IPC.APP.CHECK_FOR_UPDATE, currentVersion),
        saveScanResult: (data) => ipcRenderer.invoke(IPC.APP.SAVE_SCAN_RESULT, data),
        saveLoginInfo: (data) => ipcRenderer.invoke(IPC.APP.SAVE_LOGIN_INFO, data),
        getLoginInfo: () => ipcRenderer.invoke(IPC.APP.GET_LOGIN_INFO),
        // Read bundled HTML partials reliably (avoids fetch(file://) issues)
        readTextFile: (relativePath) => ipcRenderer.invoke(IPC.APP.READ_TEXT_FILE, { relativePath }),
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
        startFullScan: () => ipcRenderer.invoke(IPC.ANDROID.START_FULL_SCAN),
        getDashboardData: () => ipcRenderer.invoke(IPC.ANDROID.GET_DASHBOARD_DATA)
    },
    auth: {
      login: (email, password) => ipcRenderer.invoke('firebase-auth-login', { email, password }),
      logout: () => ipcRenderer.invoke('firebase-auth-logout'),
      createUser: (email, password) => ipcRenderer.invoke('firebase-auth-create-user', { email, password }),
    },
    firestore: {
        call: (payload) => ipcRenderer.invoke(IPC.FIRESTORE.CALL, payload)
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
    startFullScan: bdScanner.android.startFullScan,
    readTextFile: bdScanner.app.readTextFile,
    firestoreCall: bdScanner.firestore.call,
    getAndroidDashboardData: bdScanner.android.getDashboardData,
    // Firebase Auth (backward compatible helpers)
    firebaseAuthLogin: (email, password) => ipcRenderer.invoke('firebase-auth-login', { email, password }),
    firebaseAuthLogout: () => ipcRenderer.invoke('firebase-auth-logout'),
    firebaseAuthCreateUser: (email, password) => ipcRenderer.invoke('firebase-auth-create-user', { email, password })
};

contextBridge.exposeInMainWorld('bdScanner', bdScanner);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
