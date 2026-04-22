import { registerAppHandlers as registerAppHandlersJs } from './appHandlers.js';

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

type AppLike = {
    getAppPath(): string;
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
}) {
    return registerAppHandlersJs(options);
}
