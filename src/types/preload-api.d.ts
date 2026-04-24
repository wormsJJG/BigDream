import type {
  AndroidConnectionStatus,
  AndroidDashboardData,
  AndroidDeleteApkResult,
  AndroidDeviceSecurityStatus,
  AndroidNeutralizeResult,
  AndroidScanResult,
  AndroidSecurityActionPayload as MainAndroidSecurityActionPayload,
  AndroidSecurityActionResult,
  AndroidUninstallResult,
} from '../main/services/androidService';
import type {
  AppForceWindowResetResult,
  AppOpenScanFileResult,
  AppSaveScanResult,
} from '../main/ipc/appHandlers';
import type {
  FirestoreCallPayload,
  FirestoreCallResult,
  FirestoreCreateUserResult,
  FirestoreLoginResult,
  FirestoreLogoutResult,
} from '../main/services/firestoreService';
import type {
  IosConnectionStatus,
  IosDeleteBackupResult,
  IosRunScanOptions,
  IosScanResult,
} from '../main/services/iosService';
import type { LoginLoadResult, LoginSaveResult } from '../main/services/loginStorage';
import type { SavedScanPayload } from './scan-result';

export interface UpdateProgressPayload {
  percent: number;
  bytesPerSecond: string;
  transferred: string;
  total: string;
}
export interface IosScanProgressPayload {
  stage?: string;
  message?: string;
  trustConfirmed?: boolean;
}

export interface AppCommandResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface AndroidAutoPushReportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface AndroidAppPreview {
  title: string;
  icon: string | null;
}

export interface AndroidDeleteApkPayload {
  serial: string;
  filePath: string;
}

export type AndroidDeviceSecurityActionObject = Exclude<MainAndroidSecurityActionPayload, string>;

export interface AndroidDeviceSecurityActionPayload {
  serial?: string;
  action?: string | AndroidDeviceSecurityActionObject;
  settingId?: string;
  enabled?: boolean;
  screen?: string;
}

export interface PdfExportPayload {
  fileName?: string;
}

export interface ExportPdfResult {
  success: boolean;
  canceled?: boolean;
  message?: string;
  filePath?: string;
  error?: string;
}

export interface BdScannerAppApi {
  forceWindowReset(): Promise<AppForceWindowResetResult>;
  saveScanResult(data: SavedScanPayload): Promise<AppSaveScanResult>;
  saveLoginInfo(data: { id: string; pw: string; remember: boolean }): Promise<LoginSaveResult>;
  getLoginInfo(): Promise<LoginLoadResult>;
  readTextFile(relativePath: string): Promise<string>;
  onUpdateStart(callback: (version: string) => void): void;
  onUpdateProgress(callback: (data: UpdateProgressPayload) => void): void;
  onUpdateError(callback: (message: string) => void): void;
}

export interface BdScannerAndroidApi {
  checkDeviceConnection(): Promise<AndroidConnectionStatus>;
  runScan(): Promise<AndroidScanResult>;
  openScanFile(): Promise<AppOpenScanFileResult>;
  getAppData(packageName: string): Promise<AndroidAppPreview | null>;
  uninstallApp(packageName: string): Promise<AndroidUninstallResult>;
  neutralizeApp(pkg: string, perms: string[]): Promise<AndroidNeutralizeResult>;
  getGrantedPermissions(pkg: string): Promise<string[]>;
  deleteApkFile(data: AndroidDeleteApkPayload): Promise<AndroidDeleteApkResult>;
  autoPushReportToAndroid(): Promise<AndroidAutoPushReportResult>;
  getDashboardData(): Promise<AndroidDashboardData>;
  getDeviceSecurityStatus(): Promise<AndroidDeviceSecurityStatus>;
  performDeviceSecurityAction(payload: AndroidDeviceSecurityActionPayload): Promise<AndroidSecurityActionResult>;
}

export interface BdScannerAuthApi {
  login(email: string, password: string): Promise<FirestoreLoginResult>;
  logout(): Promise<FirestoreLogoutResult>;
  createUser(email: string, password: string): Promise<FirestoreCreateUserResult>;
}

export interface BdScannerFirestoreApi {
  call(payload: FirestoreCallPayload): Promise<FirestoreCallResult>;
}

export interface BdScannerIosApi {
  checkConnection(): Promise<IosConnectionStatus>;
  runScan(udid: string, options?: IosRunScanOptions): Promise<IosScanResult>;
  deleteBackup(udid: string): Promise<IosDeleteBackupResult>;
  exportReportPdf(payload?: PdfExportPayload): Promise<ExportPdfResult>;
  onScanProgress(callback: (payload: IosScanProgressPayload) => void): () => void;
}

export interface BdScannerApi {
  app: BdScannerAppApi;
  android: BdScannerAndroidApi;
  auth: BdScannerAuthApi;
  firestore: BdScannerFirestoreApi;
  ios: BdScannerIosApi;
}

export interface ElectronApiCompat {
  checkDeviceConnection(): Promise<AndroidConnectionStatus>;
  runScan(): Promise<AndroidScanResult>;
  openScanFile(): Promise<AppOpenScanFileResult>;
  forceWindowReset(): Promise<AppForceWindowResetResult>;
  getAppData(packageName: string): Promise<AndroidAppPreview | null>;
  uninstallApp(packageName: string): Promise<AndroidUninstallResult>;
  neutralizeApp(pkg: string, perms: string[]): Promise<AndroidNeutralizeResult>;
  getGrantedPermissions(pkg: string): Promise<string[]>;
  checkIosConnection(): Promise<IosConnectionStatus>;
  runIosScan(udid: string, options?: IosRunScanOptions): Promise<IosScanResult>;
  deleteIosBackup(udid: string): Promise<IosDeleteBackupResult>;
  exportIosReportPdf(payload?: PdfExportPayload): Promise<ExportPdfResult>;
  onIosScanProgress(callback: (payload: IosScanProgressPayload) => void): () => void;
  deleteApkFile(data: AndroidDeleteApkPayload): Promise<AndroidDeleteApkResult>;
  saveScanResult(data: SavedScanPayload): Promise<AppSaveScanResult>;
  saveLoginInfo(data: { id: string; pw: string; remember: boolean }): Promise<LoginSaveResult>;
  getLoginInfo(): Promise<LoginLoadResult>;
  onUpdateStart(callback: (version: string) => void): void;
  onUpdateProgress(callback: (data: UpdateProgressPayload) => void): void;
  onUpdateError(callback: (message: string) => void): void;
  autoPushReportToAndroid(): Promise<AndroidAutoPushReportResult>;
  readTextFile(relativePath: string): Promise<string>;
  firestoreCall(payload: FirestoreCallPayload): Promise<FirestoreCallResult>;
  getAndroidDashboardData(): Promise<AndroidDashboardData>;
  getDeviceSecurityStatus(): Promise<AndroidDeviceSecurityStatus>;
  performDeviceSecurityAction(payload: AndroidDeviceSecurityActionPayload): Promise<AndroidSecurityActionResult>;
  firebaseAuthLogin(email: string, password: string): Promise<FirestoreLoginResult>;
  firebaseAuthLogout(): Promise<FirestoreLogoutResult>;
  firebaseAuthCreateUser(email: string, password: string): Promise<FirestoreCreateUserResult>;
}

declare global {
  interface Window {
    bdScanner: BdScannerApi;
    electronAPI: ElectronApiCompat;
  }
}

export {};
