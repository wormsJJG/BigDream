import { createIosService as createIosServiceJs } from './iosService.js';

type FileSystemLike = {
    existsSync(path: string): boolean;
};
type PathLike = unknown;
type OsLike = unknown;
type LogLike = unknown;
type ConfigLike = {
    PATHS?: Record<string, string>;
    KEEP_BACKUP?: boolean;
};
type UtilsLike = {
    runCommand(command: string): Promise<string>;
    sleep(ms: number): Promise<unknown>;
    cleanDirectory(dirPath: string): void;
};

type IosConnectionStatus =
    | { status: 'disconnected' }
    | { status: 'unauthorized'; error: string }
    | { status: 'connected'; model: string; udid: string; type: 'ios' }
    | { status: 'error'; error: string };

type IosScanResult = {
    deviceInfo?: Record<string, unknown>;
    suspiciousItems?: Array<Record<string, unknown>>;
    allApps?: Array<Record<string, unknown>>;
    privacyThreatApps?: Array<Record<string, unknown>>;
    fileCount?: number;
    mvtResults?: Record<string, unknown>;
    error?: string;
};

type IosService = {
    checkConnection(): Promise<IosConnectionStatus>;
    runScan(udid: string, options?: Record<string, unknown>): Promise<IosScanResult>;
    deleteBackup(udid: string): Promise<{ success: boolean; deleted?: boolean; skipped?: boolean; message?: string; error?: string }>;
    [key: string]: unknown;
};

export type IosServiceOptions = {
    fs: FileSystemLike;
    path: PathLike;
    os: OsLike;
    log: LogLike;
    CONFIG: ConfigLike;
    Utils: UtilsLike;
};

export function createIosService(options: IosServiceOptions): IosService {
    return createIosServiceJs(options) as IosService;
}
