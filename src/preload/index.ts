import type {
  BdScannerApi,
  ElectronApiCompat,
  UpdateProgressPayload,
} from '../types/preload-api';
import type {
  FirestoreCreateUserResult,
  FirestoreLoginResult,
  FirestoreLogoutResult,
} from '../main/services/firestoreService';

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

function invokeTyped<T>(channel: string, args?: unknown, ...rest: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, args, ...rest) as Promise<T>;
}

function invokeWithTimeoutTyped<T>(channel: string, args?: unknown, timeoutMs = 15000): Promise<T> {
  return invokeWithTimeout(channel, args, timeoutMs) as Promise<T>;
}

const bdScanner: BdScannerApi = {
  app: {
    forceWindowReset: () => invokeTyped(IPC.APP.FORCE_WINDOW_RESET),
    saveScanResult: (data) => invokeTyped(IPC.APP.SAVE_SCAN_RESULT, data),
    saveLoginInfo: (data) => invokeTyped(IPC.APP.SAVE_LOGIN_INFO, data),
    getLoginInfo: () => invokeTyped(IPC.APP.GET_LOGIN_INFO),
    readTextFile: (relativePath) => invokeTyped<string>(IPC.APP.READ_TEXT_FILE, { relativePath }),
    onUpdateStart: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_START, (_event, version) => callback(version as string)),
    onUpdateProgress: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_PROGRESS, (_event, data) => callback(data as UpdateProgressPayload)),
    onUpdateError: (callback) => ipcRenderer.on(IPC.EVENTS.UPDATE_ERROR, (_event, msg) => callback(msg as string))
  },
  android: {
    checkDeviceConnection: () => invokeTyped(IPC.ANDROID.CHECK_DEVICE_CONNECTION),
    runScan: () => invokeTyped(IPC.ANDROID.RUN_SCAN),
    openScanFile: () => invokeTyped(IPC.ANDROID.OPEN_SCAN_FILE),
    getAppData: (packageName) => invokeTyped(IPC.ANDROID.GET_APP_DATA, packageName),
    uninstallApp: (packageName) => invokeTyped(IPC.ANDROID.UNINSTALL_APP, packageName),
    neutralizeApp: (pkg, perms) => invokeTyped(IPC.ANDROID.NEUTRALIZE_APP, pkg, perms),
    getGrantedPermissions: (pkg) => invokeTyped(IPC.ANDROID.GET_GRANTED_PERMISSIONS, pkg),
    deleteApkFile: (data) => invokeTyped(IPC.ANDROID.DELETE_APK_FILE, data),
    autoPushReportToAndroid: () => invokeTyped(IPC.ANDROID.AUTO_PUSH_REPORT),
    getDashboardData: () => invokeTyped(IPC.ANDROID.GET_DASHBOARD_DATA),
    getDeviceSecurityStatus: () => invokeWithTimeoutTyped(IPC.ANDROID.GET_DEVICE_SECURITY_STATUS, {}),
    performDeviceSecurityAction: (payload) => invokeWithTimeoutTyped(IPC.ANDROID.PERFORM_DEVICE_SECURITY_ACTION, payload || {})
  },
  auth: {
    login: (email, password) => invokeTyped(IPC.AUTH.LOGIN, { email, password }),
    logout: () => invokeTyped(IPC.AUTH.LOGOUT),
    createUser: (email, password) => invokeTyped(IPC.AUTH.CREATE_USER, { email, password })
  },
  firestore: {
    call: (payload) => invokeTyped(IPC.FIRESTORE.CALL, payload)
  },
  ios: {
    checkConnection: () => invokeTyped(IPC.IOS.CHECK_CONNECTION),
    runScan: (udid, options = {}) => invokeTyped(IPC.IOS.RUN_SCAN, udid, options),
    deleteBackup: (udid) => invokeTyped(IPC.IOS.DELETE_BACKUP, udid),
    exportReportPdf: (payload = {}) => invokeTyped(IPC.IOS.EXPORT_REPORT_PDF, payload),
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
  firebaseAuthLogin: (email, password) => invokeTyped<FirestoreLoginResult>(IPC.AUTH.LOGIN, { email, password }),
  firebaseAuthLogout: () => invokeTyped<FirestoreLogoutResult>(IPC.AUTH.LOGOUT),
  firebaseAuthCreateUser: (email, password) => invokeTyped<FirestoreCreateUserResult>(IPC.AUTH.CREATE_USER, { email, password })
};

contextBridge.exposeInMainWorld('bdScanner', bdScanner);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
