import { registerIosHandlers as registerIosHandlersJs } from './iosHandlers.js';
import type { MainConfig } from '../config/createConfig';
import type { createIosService } from '../services/iosService';
import type { createMainUtils } from '../services/createMainUtils';

type IpcMainLike = {
    handle(channel: string, handler: (...args: unknown[]) => unknown): void;
};

type MockDataLike = {
    getIosConnection(): unknown;
    getIosScanResult(): unknown;
};

type AppLike = {
    getPath(name: string): string;
};

type BrowserWindowLike = {
    fromWebContents(sender: unknown): {
        webContents: {
            printToPDF(options: Record<string, unknown>): Promise<Buffer>;
        };
    } | null;
};

type DialogLike = {
    showSaveDialog(
        window: unknown,
        options: Record<string, unknown>
    ): Promise<{ canceled: boolean; filePath?: string }>;
};

type IosServiceLike = ReturnType<typeof createIosService>;
type MainUtilsLike = ReturnType<typeof createMainUtils>;

export function registerIosHandlers(options: {
    ipcMain: IpcMainLike;
    CONFIG: MainConfig;
    MockData: MockDataLike;
    iosService: IosServiceLike;
    app: AppLike;
    BrowserWindow: BrowserWindowLike;
    dialog: DialogLike;
    Utils: MainUtilsLike;
    log?: unknown;
}) {
    return registerIosHandlersJs(options);
}
