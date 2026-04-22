export type UpdateProgressPayload = unknown;
export type IosScanProgressPayload = unknown;

export interface BdScannerAppApi {
  forceWindowReset(): Promise<unknown>;
  saveScanResult(data: unknown): Promise<unknown>;
  saveLoginInfo(data: unknown): Promise<{
    success?: boolean;
    passwordStored?: boolean;
  } | unknown>;
  getLoginInfo(): Promise<{
    id?: string;
    pw?: string;
    remember?: boolean;
  } | unknown>;
  readTextFile(relativePath: string): Promise<string>;
  onUpdateStart(callback: (version: string) => void): void;
  onUpdateProgress(callback: (data: UpdateProgressPayload) => void): void;
  onUpdateError(callback: (message: string) => void): void;
}

export interface BdScannerAndroidApi {
  checkDeviceConnection(): Promise<unknown>;
  runScan(): Promise<unknown>;
  openScanFile(): Promise<unknown>;
  getAppData(packageName: string): Promise<unknown>;
  uninstallApp(packageName: string): Promise<unknown>;
  neutralizeApp(pkg: string, perms: string[]): Promise<unknown>;
  getGrantedPermissions(pkg: string): Promise<unknown>;
  deleteApkFile(data: unknown): Promise<unknown>;
  autoPushReportToAndroid(): Promise<unknown>;
  getDashboardData(): Promise<unknown>;
  getDeviceSecurityStatus(): Promise<unknown>;
  performDeviceSecurityAction(payload: unknown): Promise<unknown>;
}

export interface BdScannerAuthApi {
  login(email: string, password: string): Promise<unknown>;
  logout(): Promise<unknown>;
  createUser(email: string, password: string): Promise<unknown>;
}

export interface BdScannerFirestoreApi {
  call(payload: unknown): Promise<unknown>;
}

export interface BdScannerIosApi {
  checkConnection(): Promise<unknown>;
  runScan(udid: string, options?: Record<string, unknown>): Promise<unknown>;
  deleteBackup(udid: string): Promise<unknown>;
  exportReportPdf(payload?: Record<string, unknown>): Promise<unknown>;
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
  checkDeviceConnection(): Promise<unknown>;
  runScan(): Promise<unknown>;
  openScanFile(): Promise<unknown>;
  forceWindowReset(): Promise<unknown>;
  getAppData(packageName: string): Promise<unknown>;
  uninstallApp(packageName: string): Promise<unknown>;
  neutralizeApp(pkg: string, perms: string[]): Promise<unknown>;
  getGrantedPermissions(pkg: string): Promise<unknown>;
  checkIosConnection(): Promise<unknown>;
  runIosScan(udid: string, options?: Record<string, unknown>): Promise<unknown>;
  deleteIosBackup(udid: string): Promise<unknown>;
  exportIosReportPdf(payload?: Record<string, unknown>): Promise<unknown>;
  onIosScanProgress(callback: (payload: IosScanProgressPayload) => void): () => void;
  deleteApkFile(data: unknown): Promise<unknown>;
  saveScanResult(data: unknown): Promise<unknown>;
  saveLoginInfo(data: unknown): Promise<unknown>;
  getLoginInfo(): Promise<unknown>;
  onUpdateStart(callback: (version: string) => void): void;
  onUpdateProgress(callback: (data: UpdateProgressPayload) => void): void;
  onUpdateError(callback: (message: string) => void): void;
  autoPushReportToAndroid(): Promise<unknown>;
  readTextFile(relativePath: string): Promise<string>;
  firestoreCall(payload: unknown): Promise<unknown>;
  getAndroidDashboardData(): Promise<unknown>;
  getDeviceSecurityStatus(): Promise<unknown>;
  performDeviceSecurityAction(payload: unknown): Promise<unknown>;
  firebaseAuthLogin(email: string, password: string): Promise<unknown>;
  firebaseAuthLogout(): Promise<unknown>;
  firebaseAuthCreateUser(email: string, password: string): Promise<unknown>;
}

declare global {
  interface Window {
    bdScanner: BdScannerApi;
    electronAPI: ElectronApiCompat;
  }
}

export {};
