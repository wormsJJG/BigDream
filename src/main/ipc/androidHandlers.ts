import { registerAndroidHandlers as registerAndroidHandlersJs } from './androidHandlers.js';
import type { MainConfig } from '../config/createConfig';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type BrowserWindowLike = {
    fromWebContents(sender: unknown): {
        webContents: {
            printToPDF(options: Record<string, unknown>): Promise<Buffer>;
        };
    };
};

type UtilsLike = {
    sleep(ms: number): Promise<unknown>;
};

type AndroidServiceLike = {
    checkConnection(): Promise<unknown>;
    runScan(): Promise<unknown>;
    getDashboardData(serial?: string): Promise<unknown>;
    getDeviceSecurityStatus(serial?: string): Promise<unknown>;
    performDeviceSecurityAction(serial?: string, action?: unknown): Promise<unknown>;
    setDeviceSecuritySetting(serial?: string, settingId?: string, enabled?: boolean): Promise<unknown>;
    openAndroidSettings(serial?: string, screen?: string): Promise<unknown>;
    uninstallApp(packageName: string): Promise<unknown>;
    deleteApkFile(serial: string, filePath: string): Promise<unknown>;
    neutralizeApp(packageName: string, perms?: string[]): Promise<unknown>;
    getGrantedPermissions(packageName: string): Promise<unknown>;
};

export function registerAndroidHandlers(options: {
    ipcMain: IpcMainLike;
    CONFIG: MainConfig;
    MockData: Record<string, unknown>;
    Utils: UtilsLike;
    client: unknown;
    androidService: AndroidServiceLike;
    log?: unknown;
    app: { getPath(name: string): string };
    BrowserWindow: BrowserWindowLike;
}) {
    return registerAndroidHandlersJs(options);
}

