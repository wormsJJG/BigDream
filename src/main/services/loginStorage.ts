type SafeStorageLike = {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(value: Buffer): string;
};

type FileSystemLike = {
    writeFileSync(path: string, data: string): void;
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: BufferEncoding): string;
};

type LoginSaveArgs = {
    id: string;
    pw: string;
    remember: boolean;
};

type LoginStoredData = {
    id: string;
    remember: boolean;
    isEncrypted?: boolean;
    safePw?: string;
    pw?: string;
    passwordStored?: boolean;
};

export type LoginLoadResult = {
    remember: boolean;
    id: string;
    pw: string;
    passwordStored?: boolean;
};

export type LoginSaveResult = {
    success: boolean;
    remember: boolean;
    passwordStored: boolean;
};

export function createLoginStorage(options: {
    configPath: string;
    safeStorage: SafeStorageLike;
    fs: FileSystemLike;
}) {
    const { configPath, safeStorage, fs } = options;

    if (!configPath) throw new Error('loginStorage: configPath is required');
    if (!safeStorage) throw new Error('loginStorage: safeStorage is required');
    if (!fs) throw new Error('loginStorage: fs is required');

    function write(data: LoginStoredData): void {
        fs.writeFileSync(configPath, JSON.stringify(data));
    }

    function save({ id, pw, remember }: LoginSaveArgs): LoginSaveResult {
        const data: LoginStoredData = {
            id: String(id ?? ''),
            remember: Boolean(remember),
        };

        if (data.remember) {
            const plainPw = String(pw ?? '');
            if (safeStorage.isEncryptionAvailable()) {
                data.isEncrypted = true;
                data.safePw = safeStorage.encryptString(plainPw).toString('base64');
            } else {
                data.isEncrypted = false;
                data.passwordStored = false;
            }
        }

        write(data);
        return {
            success: true,
            remember: data.remember,
            passwordStored: !!data.safePw
        };
    }

    function load(): LoginLoadResult {
        try {
            if (!fs.existsSync(configPath)) {
                return { remember: false, id: '', pw: '' };
            }

            const fileContent = fs.readFileSync(configPath, 'utf8');
            if (!fileContent) return { remember: false, id: '', pw: '' };

            const data = JSON.parse(fileContent) as LoginStoredData;

            const remember = Boolean(data.remember);
            const id = String(data.id ?? '');
            let pw = '';
            let shouldRewrite = false;

            if (remember) {
                if (data.isEncrypted && data.safePw && safeStorage.isEncryptionAvailable()) {
                    try {
                        const buffer = Buffer.from(String(data.safePw), 'base64');
                        pw = safeStorage.decryptString(buffer);
                    } catch (_e) {
                        pw = '';
                    }
                } else if (typeof data.pw === 'string') {
                    if (safeStorage.isEncryptionAvailable()) {
                        try {
                            pw = data.pw;
                            data.isEncrypted = true;
                            data.safePw = safeStorage.encryptString(pw).toString('base64');
                            delete data.pw;
                            data.passwordStored = true;
                            shouldRewrite = true;
                        } catch (_e) {
                            pw = '';
                            delete data.pw;
                            data.passwordStored = false;
                            shouldRewrite = true;
                        }
                    } else {
                        delete data.pw;
                        data.passwordStored = false;
                        shouldRewrite = true;
                    }
                } else if (data.safePw && safeStorage.isEncryptionAvailable()) {
                    try {
                        const buffer = Buffer.from(String(data.safePw), 'base64');
                        pw = safeStorage.decryptString(buffer);
                    } catch (_e) {
                        pw = '';
                    }
                }
            }

            if (shouldRewrite) {
                write(data);
            }

            return {
                remember,
                id,
                pw,
                passwordStored: Boolean(pw)
            };
        } catch (_error) {
            return { remember: false, id: '', pw: '' };
        }
    }

    return { save, load };
}
