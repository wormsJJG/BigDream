import { createAndroidService as createAndroidServiceJs } from './androidService.js';

type AdbClientLike = {
    listDevices(): Promise<Array<{ id: string; type?: string }>>;
};
type AdbLike = unknown;
type ApkReaderLike = unknown;
type FileSystemLike = unknown;
type PathLike = unknown;
type OsLike = unknown;
type CryptoLike = unknown;
type LogLike = unknown;
type ExecLike = unknown;
type ConfigLike = {
    PATHS?: Record<string, string>;
};
type UtilsLike = {
    checkVirusTotal?(...args: unknown[]): Promise<unknown>;
    formatAppName?(value: string): string;
};

type AnalyzeStaticModel = ((payload: Record<string, unknown>) => Promise<{
    score: number;
    grade: string;
    reason: string;
}>) | undefined;

type AndroidConnectionStatus =
    | { status: 'disconnected' }
    | { status: 'unauthorized' }
    | { status: 'offline' }
    | { status: 'connected'; model: string }
    | { status: 'error'; error: string };

type AndroidScanResult = {
    deviceInfo?: Record<string, unknown>;
    allApps?: Array<Record<string, unknown>>;
    suspiciousApps?: Array<Record<string, unknown>>;
    privacyThreatApps?: Array<Record<string, unknown>>;
    apkFiles?: Array<Record<string, unknown>>;
    runningCount?: number;
    error?: string;
};

type AndroidService = {
    checkConnection(): Promise<AndroidConnectionStatus>;
    runScan(): Promise<AndroidScanResult>;
    getDeviceInfo(serial: string): Promise<Record<string, unknown>>;
    getDashboardData(serial?: string): Promise<unknown>;
    getDeviceSecurityStatus(serial?: string): Promise<unknown>;
    performDeviceSecurityAction(serial?: string, action?: unknown): Promise<unknown>;
    setDeviceSecuritySetting(serial?: string, settingId?: string, enabled?: boolean): Promise<unknown>;
    openAndroidSettings(serial?: string, screen?: string): Promise<unknown>;
    uninstallApp(packageName: string): Promise<{ success: boolean; message?: string; error?: string }>;
    deleteApkFile(serial: string, filePath: string): Promise<unknown>;
    neutralizeApp(packageName: string, perms?: string[]): Promise<{ success: boolean; count?: number; error?: string }>;
    getGrantedPermissions(packageName: string): Promise<unknown>;
    [key: string]: unknown;
};

export type AndroidServiceOptions = {
    client: AdbClientLike;
    adb: AdbLike;
    ApkReader: ApkReaderLike;
    fs: FileSystemLike;
    path: PathLike;
    os: OsLike;
    crypto: CryptoLike;
    log: LogLike;
    exec: ExecLike;
    CONFIG: ConfigLike;
    Utils: UtilsLike;
    analyzeAppWithStaticModel?: AnalyzeStaticModel;
};

export function createAndroidService(options: AndroidServiceOptions): AndroidService {
    return createAndroidServiceJs(options) as AndroidService;
}
