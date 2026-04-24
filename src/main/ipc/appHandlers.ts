import os from 'os';
import path from 'path';
import type { App } from 'electron';
import type { SavedScanPayload } from '../../types/scan-result';
type IpcChannelsModule = typeof import('../../shared/ipc/ipcChannels');
declare function require(name: '../../shared/ipc/ipcChannels.js'): IpcChannelsModule & { default: IpcChannelsModule['default'] };
const IPC = require('../../shared/ipc/ipcChannels.js').default;

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type BrowserWindowLike = {
    getAllWindows(): Array<{
        blur(): void;
        focus(): void;
        show(): void;
        webContents?: { focus(): void };
    }>;
};

type DialogLike = {
    showSaveDialog(options: Record<string, unknown>): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(options: Record<string, unknown>): Promise<{ canceled: boolean; filePaths: string[] }>;
};

type AppLike = Pick<App, 'getAppPath'>;

type ScanFileMeta = {
    filePath: string;
    mtimeMs: number;
    savedAt: number;
};

export type AppForceWindowResetResult = void;

export type AppSaveScanResult = {
    success: boolean;
    message?: string;
    error?: string;
};

export type AppOpenScanFileResult = {
    success: boolean;
    message?: string;
    error?: string;
    osMode?: 'android' | 'ios';
    data?: ScanSavePayload;
    fileMeta?: ScanFileMeta;
};

type ScanSavePayload = SavedScanPayload & {
    meta?: Record<string, unknown>;
};

type FsLike = {
    writeFileSync(path: string, data: string): void;
    readFileSync(path: string, encoding: BufferEncoding): string;
    statSync(path: string): { mtimeMs: number };
    promises: {
        readFile(path: string, encoding: BufferEncoding): Promise<string>;
    };
};

export function registerAppHandlers(options: {
    ipcMain: IpcMainLike;
    BrowserWindow: BrowserWindowLike;
    dialog: DialogLike;
    app: AppLike;
    fs: FsLike;
}): void {
    const { ipcMain, BrowserWindow, dialog, app, fs } = options;

    if (!ipcMain) throw new Error('registerAppHandlers: ipcMain is required');
    if (!BrowserWindow) throw new Error('registerAppHandlers: BrowserWindow is required');
    if (!dialog) throw new Error('registerAppHandlers: dialog is required');
    if (!app) throw new Error('registerAppHandlers: app is required');
    if (!fs) throw new Error('registerAppHandlers: fs is required');

    ipcMain.handle(IPC.APP.FORCE_WINDOW_RESET, () => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (!mainWindow) return;

        mainWindow.blur();
        setTimeout(() => {
            mainWindow.focus();
            mainWindow.show();
            if (mainWindow.webContents) {
                mainWindow.webContents.focus();
            }
        }, 50);
    });

    ipcMain.handle(IPC.APP.SAVE_SCAN_RESULT, async (_event, data) => {
        const typedData = data as ScanSavePayload;
        try {
            const now = new Date();
            const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
            const modelName = typedData?.deviceInfo?.model ? typedData.deviceInfo.model.replace(/\s/g, '_') : 'UnknownDevice';
            const defaultPath = path.join(os.homedir(), `BD_${dateStr}_${modelName}.json`);

            const result = await dialog.showSaveDialog({
                title: '검사 결과 저장',
                defaultPath,
                filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
            });

            if (result.canceled) {
                return { success: false, message: '저장 취소' };
            }

            const filePath = result.filePath as string;
            try {
                typedData.meta = typedData.meta || {};
                typedData.meta.savedAt = new Date().toISOString();
            } catch (_e) {
                /* noop */
            }

            fs.writeFileSync(filePath, JSON.stringify(typedData, null, 2));
            return { success: true, message: `결과가 성공적으로 저장되었습니다:\n${filePath}` };
        } catch (err) {
            const error = err as Error;
            console.error('로컬 저장 오류:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC.ANDROID.OPEN_SCAN_FILE, async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: '검사 결과 열기',
                properties: ['openFile'],
                filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
            });

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, message: '열기 취소' };
            }

            const filePath = result.filePaths[0];
            const scanData = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ScanSavePayload;

            if (!scanData.deviceInfo || !scanData.deviceInfo.os) {
                throw new Error('파일 구조가 올바르지 않거나 OS 정보가 누락되었습니다.');
            }

            const rawOs = String(scanData.deviceInfo.os).toLowerCase();
            const normalizedOsMode = rawOs.includes('ios') ? 'ios' : 'android';
            const stat = fs.statSync(filePath);

            return {
                success: true,
                data: scanData,
                osMode: normalizedOsMode,
                fileMeta: {
                    filePath,
                    mtimeMs: stat.mtimeMs,
                    savedAt: stat.mtimeMs
                } as ScanFileMeta
            };
        } catch (err) {
            const error = err as Error;
            console.error('로컬 파일 열기 오류:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle(IPC.APP.READ_TEXT_FILE, async (_evt, payload) => {
        const { relativePath } = payload as { relativePath: string };
        if (!relativePath || typeof relativePath !== 'string') {
            throw new Error('relativePath is required');
        }

        const baseDir = app.getAppPath();
        const resolved = path.resolve(baseDir, relativePath);
        if (!resolved.startsWith(baseDir)) {
            throw new Error('Invalid path');
        }

        return await fs.promises.readFile(resolved, 'utf8');
    });
}
