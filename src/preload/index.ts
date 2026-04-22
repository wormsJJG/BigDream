import type { BdScannerApi, ElectronApiCompat } from '../types/preload-api';

type IpcRendererLike = {
  invoke(channel: string, args?: unknown, ...rest: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
};

type ContextBridgeLike = {
  exposeInMainWorld(key: string, api: unknown): void;
};

type ElectronLike = {
  contextBridge: ContextBridgeLike;
  ipcRenderer: IpcRendererLike;
};

declare function require(name: 'electron'): ElectronLike;
declare function require(name: '../shared/ipc/ipcChannels.js'): any;

const { contextBridge, ipcRenderer } = require('electron');
const IPC = require('../shared/ipc/ipcChannels.js');

function invokeWithTimeout(channel: string, args?: unknown, timeoutMs = 15000): Promise<unknown> {
  return Promise.race([
    ipcRenderer.invoke(channel, args),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`IPC timeout: ${channel}`)), timeoutMs))
  ]);
}

const bdScanner: BdScannerApi = {
  app: {
    forceWindowReset: () => ipcRenderer.invoke(IPC.APP.FORCE_WINDOW_RESET),
    saveScanResult: (data) => ipcRenderer.invoke(IPC.APP.SAVE_SCAN_RESULT, data),
    saveLoginInfo: (data) => ipcRenderer.invoke(IPC.APP.SAVE_LOGIN_INFO, data),
    getLoginInfo: () => ipcRenderer.invoke(IPC.APP.GET_LOGIN_INFO),
    readTextFile: (relativePath) => ipcRenderer.invoke(IPC.APP.READ_TEXT_FILE, { relativePath }) as Promise<string>,
    onUpdateStart: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_START, (_event, version) => callback(version as string)),
    onUpdateProgress: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_PROGRESS, (_event, data) => callback(data)),
    onUpdateError: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_ERROR, (_event, msg) => callback(msg as string))
  },
  android: {
    checkDeviceConnection: () => ipcRenderer.invoke(IPC.ANDROID.CHECK_DEVICE_CONNECTION),
    runScan: () => ipcRenderer.invoke(IPC.ANDROID.RUN_SCAN),
    openScanFile: () => ipcRenderer.invoke(IPC.ANDROID.OPEN_SCAN_FILE),
    getAppData: (packageName) => ipcRenderer.invoke(IPC.ANDROID.GET_APP_DATA, packageName),
    uninstallApp: (packageName) => ipcRenderer.invoke(IPC.ANDROID.UNINSTALL_APP, packageName),
    neutralizeApp: (pkg, perms) => ipcRenderer.invoke(IPC.ANDROID.NEUTRALIZE_APP, pkg, perms),
    getGrantedPermissions: (pkg) => ipcRenderer.invoke(IPC.ANDROID.GET_GRANTED_PERMISSIONS, pkg),
    deleteApkFile: (data) => ipcRenderer.invoke(IPC.ANDROID.DELETE_APK_FILE, data),
    autoPushReportToAndroid: () => ipcRenderer.invoke(IPC.ANDROID.AUTO_PUSH_REPORT),
    getDashboardData: () => ipcRenderer.invoke(IPC.ANDROID.GET_DASHBOARD_DATA),
    getDeviceSecurityStatus: () => invokeWithTimeout(IPC.ANDROID.GET_DEVICE_SECURITY_STATUS, {}),
    performDeviceSecurityAction: (payload) => invokeWithTimeout(IPC.ANDROID.PERFORM_DEVICE_SECURITY_ACTION, payload || {})
  },
  auth: {
    login: (email, password) => ipcRenderer.invoke(IPC.AUTH.LOGIN, { email, password }),
    logout: () => ipcRenderer.invoke(IPC.AUTH.LOGOUT),
    createUser: (email, password) => ipcRenderer.invoke(IPC.AUTH.CREATE_USER, { email, password })
  },
  firestore: {
    call: (payload) => ipcRenderer.invoke(IPC.FIRESTORE.CALL, payload)
  },
  ios: {
    checkConnection: () => ipcRenderer.invoke(IPC.IOS.CHECK_CONNECTION),
    runScan: (udid, options = {}) => ipcRenderer.invoke(IPC.IOS.RUN_SCAN, udid, options),
    deleteBackup: (udid) => ipcRenderer.invoke(IPC.IOS.DELETE_BACKUP, udid),
    exportReportPdf: (payload = {}) => ipcRenderer.invoke(IPC.IOS.EXPORT_REPORT_PDF, payload),
    onScanProgress: (callback) => {
      const handler = (_event: unknown, payload: unknown) => {
        try { callback(payload); } catch (_e) { /* noop */ }
      };
      ipcRenderer.on(IPC.IOS.PROGRESS, handler);
      return () => ipcRenderer.removeListener(IPC.IOS.PROGRESS, handler);
    }
  }
};

const electronAPI: ElectronApiCompat = {
  checkDeviceConnection: bdScanner.android.checkDeviceConnection,
  runScan: bdScanner.android.runScan,
  openScanFile: bdScanner.android.openScanFile,
  forceWindowReset: bdScanner.app.forceWindowReset,
  getAppData: bdScanner.android.getAppData,
  uninstallApp: bdScanner.android.uninstallApp,
  neutralizeApp: bdScanner.android.neutralizeApp,
  getGrantedPermissions: bdScanner.android.getGrantedPermissions,
  checkIosConnection: bdScanner.ios.checkConnection,
  runIosScan: bdScanner.ios.runScan,
  deleteIosBackup: bdScanner.ios.deleteBackup,
  exportIosReportPdf: bdScanner.ios.exportReportPdf,
  onIosScanProgress: bdScanner.ios.onScanProgress,
  deleteApkFile: bdScanner.android.deleteApkFile,
  saveScanResult: bdScanner.app.saveScanResult,
  saveLoginInfo: bdScanner.app.saveLoginInfo,
  getLoginInfo: bdScanner.app.getLoginInfo,
  onUpdateStart: bdScanner.app.onUpdateStart,
  onUpdateProgress: bdScanner.app.onUpdateProgress,
  onUpdateError: bdScanner.app.onUpdateError,
  autoPushReportToAndroid: bdScanner.android.autoPushReportToAndroid,
  readTextFile: bdScanner.app.readTextFile,
  firestoreCall: bdScanner.firestore.call,
  getAndroidDashboardData: bdScanner.android.getDashboardData,
  getDeviceSecurityStatus: bdScanner.android.getDeviceSecurityStatus,
  performDeviceSecurityAction: bdScanner.android.performDeviceSecurityAction,
  firebaseAuthLogin: (email, password) => ipcRenderer.invoke(IPC.AUTH.LOGIN, { email, password }),
  firebaseAuthLogout: () => ipcRenderer.invoke(IPC.AUTH.LOGOUT),
  firebaseAuthCreateUser: (email, password) => ipcRenderer.invoke(IPC.AUTH.CREATE_USER, { email, password })
};

contextBridge.exposeInMainWorld('bdScanner', bdScanner);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
