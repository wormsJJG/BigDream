"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLoginStorage = createLoginStorage;
function createLoginStorage(options) {
    const { configPath, safeStorage, fs } = options;
    if (!configPath)
        throw new Error('loginStorage: configPath is required');
    if (!safeStorage)
        throw new Error('loginStorage: safeStorage is required');
    if (!fs)
        throw new Error('loginStorage: fs is required');
    function write(data) {
        fs.writeFileSync(configPath, JSON.stringify(data));
    }
    function save({ id, pw, remember }) {
        const data = {
            id: String(id ?? ''),
            remember: Boolean(remember),
        };
        if (data.remember) {
            const plainPw = String(pw ?? '');
            if (safeStorage.isEncryptionAvailable()) {
                data.isEncrypted = true;
                data.safePw = safeStorage.encryptString(plainPw).toString('base64');
            }
            else {
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
    function load() {
        try {
            if (!fs.existsSync(configPath)) {
                return { remember: false, id: '', pw: '' };
            }
            const fileContent = fs.readFileSync(configPath, 'utf8');
            if (!fileContent)
                return { remember: false, id: '', pw: '' };
            const data = JSON.parse(fileContent);
            const remember = Boolean(data.remember);
            const id = String(data.id ?? '');
            let pw = '';
            let shouldRewrite = false;
            if (remember) {
                if (data.isEncrypted && data.safePw && safeStorage.isEncryptionAvailable()) {
                    try {
                        const buffer = Buffer.from(String(data.safePw), 'base64');
                        pw = safeStorage.decryptString(buffer);
                    }
                    catch (_e) {
                        pw = '';
                    }
                }
                else if (typeof data.pw === 'string') {
                    if (safeStorage.isEncryptionAvailable()) {
                        try {
                            pw = data.pw;
                            data.isEncrypted = true;
                            data.safePw = safeStorage.encryptString(pw).toString('base64');
                            delete data.pw;
                            data.passwordStored = true;
                            shouldRewrite = true;
                        }
                        catch (_e) {
                            pw = '';
                            delete data.pw;
                            data.passwordStored = false;
                            shouldRewrite = true;
                        }
                    }
                    else {
                        delete data.pw;
                        data.passwordStored = false;
                        shouldRewrite = true;
                    }
                }
                else if (data.safePw && safeStorage.isEncryptionAvailable()) {
                    try {
                        const buffer = Buffer.from(String(data.safePw), 'base64');
                        pw = safeStorage.decryptString(buffer);
                    }
                    catch (_e) {
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
        }
        catch (_error) {
            return { remember: false, id: '', pw: '' };
        }
    }
    return { save, load };
}
