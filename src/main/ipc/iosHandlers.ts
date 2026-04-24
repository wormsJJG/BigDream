import fs from 'fs';
import path from 'path';
import type { App, BaseWindow } from 'electron';
type IpcChannelsModule = typeof import('../../shared/ipc/ipcChannels');
declare function require(name: '../../shared/ipc/ipcChannels.js'): IpcChannelsModule & { default: IpcChannelsModule['default'] };
const IPC = require('../../shared/ipc/ipcChannels.js').default;
import type { MainConfig } from '../config/createConfig';
import type { createIosService } from '../services/iosService';
import type { createMainUtils } from '../services/createMainUtils';
import type { ExportPdfResult } from '../../types/preload-api';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type IpcSenderLike = {
    send(channel: string, payload: unknown): void;
};

type IpcEventLike = {
    sender: IpcSenderLike;
};

type MockDataLike = {
    getIosConnection(): {
        status: string;
        model?: string;
        udid?: string;
        type?: string;
        error?: string;
    };
    getIosScanResult(): {
        error?: string;
        deviceInfo?: Awaited<ReturnType<IosServiceLike['runScan']>>['deviceInfo'];
        suspiciousItems?: Awaited<ReturnType<IosServiceLike['runScan']>>['suspiciousItems'];
        allApps?: Awaited<ReturnType<IosServiceLike['runScan']>>['allApps'];
        privacyThreatApps?: Awaited<ReturnType<IosServiceLike['runScan']>>['privacyThreatApps'];
        fileCount?: number;
        mvtResults?: {
            web?: { status?: string; warnings?: string[]; files?: string[] };
            messages?: { status?: string; warnings?: string[]; files?: string[] };
            system?: { status?: string; warnings?: string[]; files?: string[] };
            apps?: { status?: string; warnings?: string[]; files?: string[] };
            artifacts?: { status?: string; warnings?: string[]; files?: string[] };
        };
    };
};

type AppLike = Pick<App, 'getPath'>;

type BrowserWindowInstanceLike = {
    webContents: {
        printToPDF(options: {
            printBackground: boolean;
            pageSize: 'A4';
        }): Promise<Buffer>;
    };
};

type BrowserWindowLike = {
    fromWebContents(sender: unknown): BrowserWindowInstanceLike | null;
};

type DialogLike = {
    showSaveDialog(
        window: BaseWindow | BrowserWindowInstanceLike,
        options: {
            title: string;
            defaultPath: string;
            filters: Array<{ name: string; extensions: string[] }>;
        }
    ): Promise<{ canceled: boolean; filePath?: string }>;
};

type IosServiceLike = ReturnType<typeof createIosService>;
type MainUtilsLike = ReturnType<typeof createMainUtils>;
type RunScanDeviceId = Parameters<IosServiceLike['runScan']>[0];
type RunScanOptions = NonNullable<Parameters<IosServiceLike['runScan']>[1]>;
type DeleteBackupDeviceId = Parameters<IosServiceLike['deleteBackup']>[0];
type IosProgressPayload = Parameters<NonNullable<RunScanOptions['onProgress']>>[0];
type ExportReportPayload = { fileName?: string };
type LogLike = Pick<Console, 'error'>;

export function registerIosHandlers(options: {
    ipcMain: IpcMainLike;
    CONFIG: MainConfig;
    MockData: MockDataLike;
    iosService: IosServiceLike;
    app: AppLike;
    BrowserWindow: BrowserWindowLike;
    dialog: DialogLike;
    Utils: MainUtilsLike;
    log?: LogLike;
}): void {
    const {
        ipcMain,
        CONFIG,
        MockData,
        iosService,
        app,
        BrowserWindow,
        dialog,
        Utils
    } = options;

    if (!ipcMain) throw new Error('registerIosHandlers requires ipcMain');
    if (!CONFIG) throw new Error('registerIosHandlers requires CONFIG');
    if (!iosService) throw new Error('registerIosHandlers requires iosService');
    if (!app) throw new Error('registerIosHandlers requires app');
    if (!BrowserWindow) throw new Error('registerIosHandlers requires BrowserWindow');
    if (!dialog) throw new Error('registerIosHandlers requires dialog');
    if (!Utils) throw new Error('registerIosHandlers requires Utils');

    ipcMain.handle(IPC.IOS.CHECK_CONNECTION, async () => {
        if (CONFIG.IS_DEV_MODE) return MockData.getIosConnection();
        return await iosService.checkConnection();
    });

    ipcMain.handle(IPC.IOS.RUN_SCAN, async (event, udid, runOptions = {}) => {
        if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();

        const typedEvent = event as IpcEventLike;
        const mainWindow = BrowserWindow.fromWebContents(typedEvent.sender);
        const prerequisitesReady = await Utils.checkAndInstallPrerequisites(mainWindow);
        if (!prerequisitesReady) {
            return { error: 'iOS 정밀 분석에 필요한 구성 요소가 준비되지 않았습니다.' };
        }

        const onProgress = (payload: IosProgressPayload) => {
            try {
                typedEvent.sender.send(IPC.IOS.PROGRESS, payload);
            } catch (_e) {
                /* noop */
            }
        };

        return await iosService.runScan(udid as RunScanDeviceId, { ...(runOptions as RunScanOptions), onProgress });
    });

    ipcMain.handle(IPC.IOS.DELETE_BACKUP, async (_event, udid) => {
        return await iosService.deleteBackup(udid as DeleteBackupDeviceId);
    });

    ipcMain.handle(IPC.IOS.EXPORT_REPORT_PDF, async (event, payload = {}) => {
        const typedEvent = event as IpcEventLike;
        const { fileName } = payload as ExportReportPayload;
        const mainWindow = BrowserWindow.fromWebContents(typedEvent.sender);
        if (!mainWindow) {
            return { success: false, error: '메인 창을 찾을 수 없습니다.' } as ExportPdfResult;
        }

        const safeName = String(fileName || 'BD_Scanner_Report.pdf').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        const downloadsDir = app.getPath('downloads');
        const defaultPath = path.join(downloadsDir, safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`);

        try {
            const saveResult = await dialog.showSaveDialog(mainWindow, {
                title: 'PDF 저장',
                defaultPath,
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });

            if (saveResult.canceled || !saveResult.filePath) {
                return { success: false, canceled: true, message: '저장 취소' } as ExportPdfResult;
            }

            const pdfData = await mainWindow.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4',
            });

            fs.writeFileSync(saveResult.filePath, pdfData);
            return { success: true, filePath: saveResult.filePath } as ExportPdfResult;
        } catch (err) {
            const error = err as Error;
            console.error('[iOS PDF Export] failed:', error);
            return { success: false, error: error.message } as ExportPdfResult;
        }
    });
}
