import { createLoginStorage as createLoginStorageJs } from './loginStorage.js';

type SafeStorageLike = {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(value: Buffer): string;
};

type FileSystemLike = {
    writeFileSync(path: string, data: string): void;
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: unknown): string;
};

type LoginSaveArgs = {
    id: string;
    pw: string;
    remember: boolean;
};

type LoginStorage = {
    save(args: LoginSaveArgs): {
        success: boolean;
        remember: boolean;
        passwordStored: boolean;
    };
    load(): {
        remember: boolean;
        id: string;
        pw: string;
        passwordStored?: boolean;
    };
};

export function createLoginStorage(options: {
    configPath: string;
    safeStorage: SafeStorageLike;
    fs: FileSystemLike;
}): LoginStorage {
    return createLoginStorageJs(options) as LoginStorage;
}
