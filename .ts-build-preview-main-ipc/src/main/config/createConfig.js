"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfig = createConfig;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
function parseBool(v, fallback = false) {
    if (v === true)
        return true;
    if (v === false)
        return false;
    if (v === 1 || v === 0)
        return Boolean(v);
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes' || s === 'y')
            return true;
        if (s === 'false' || s === '0' || s === 'no' || s === 'n')
            return false;
    }
    return fallback;
}
function getOptionalSecret(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}
function createConfig({ app, rootDir }) {
    if (!app)
        throw new Error('createConfig: app is required');
    if (!rootDir)
        throw new Error('createConfig: rootDir is required');
    const resourceDir = app.isPackaged ? process.resourcesPath : rootDir;
    void parseBool;
    return {
        IS_DEV_MODE: false,
        KEEP_BACKUP: false,
        VIRUSTOTAL_API_KEY: getOptionalSecret('BIGDREAM_VIRUSTOTAL_API_KEY', 'VIRUSTOTAL_API_KEY'),
        PATHS: {
            ADB: path_1.default.join(resourceDir, 'platform-tools', os_1.default.platform() === 'win32' ? 'adb.exe' : 'adb'),
            IOS_TOOLS: path_1.default.join(resourceDir, 'ios-tools'),
            IOS_ID: path_1.default.join(resourceDir, 'ios-tools', os_1.default.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id'),
            IOS_PAIR: path_1.default.join(resourceDir, 'ios-tools', os_1.default.platform() === 'win32' ? 'idevicepair.exe' : 'idevicepair'),
            IOS_INFO: path_1.default.join(resourceDir, 'ios-tools', os_1.default.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo'),
            IOS_BACKUP: path_1.default.join(resourceDir, 'ios-tools', os_1.default.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2'),
            TEMP_BACKUP: path_1.default.join(app.getPath('userData'), 'iphone_backups'),
            MVT_RESULT: path_1.default.join(app.getPath('userData'), 'mvt_results'),
            LOGIN_CONFIG_PATH: path_1.default.join(app.getPath('userData'), 'login-info.json')
        }
    };
}
