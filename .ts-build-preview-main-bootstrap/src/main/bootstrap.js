"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = start;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const adbkit_1 = __importDefault(require("adbkit"));
const axios_1 = __importDefault(require("axios"));
const child_process_1 = require("child_process");
const electron_updater_1 = require("electron-updater");
const electron_log_1 = __importDefault(require("electron-log"));
const adbkit_apkreader_1 = __importDefault(require("adbkit-apkreader"));
const electron_1 = require("electron");
const createMainWindow_1 = require("./window/createMainWindow");
const createConfig_1 = require("./config/createConfig");
const initializeAutoUpdater_1 = require("./updater/initializeAutoUpdater");
const createMainUtils_1 = require("./services/createMainUtils");
const loginStorage_js_1 = require("./services/loginStorage.js");
const firestoreService_js_1 = require("./services/firestoreService.js");
const authHandlers_js_1 = require("./ipc/authHandlers.js");
const firestoreHandlers_js_1 = require("./ipc/firestoreHandlers.js");
const androidService_js_1 = require("./services/androidService.js");
const iosService_js_1 = require("./services/iosService.js");
const androidHandlers_js_1 = require("./ipc/androidHandlers.js");
const iosHandlers_1 = require("./ipc/iosHandlers");
const appHandlers_1 = require("./ipc/appHandlers");
const mockData_js_1 = require("./testing/mockData.js");
function start({ rootDir }) {
    if (!rootDir) {
        throw new Error('bootstrap.start requires { rootDir }');
    }
    try {
        process.chdir(rootDir);
    }
    catch (_e) { /* noop */ }
    const { analyzeAppWithStaticModel } = require(path_1.default.join(rootDir, 'ai', 'aiStaticAnalyzer'));
    electron_updater_1.autoUpdater.logger = electron_log_1.default;
    electron_updater_1.autoUpdater.logger.transports.file.level = 'info';
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.allowPrerelease = false;
    const CONFIG = (0, createConfig_1.createConfig)({ app: electron_1.app, rootDir });
    const loginStorage = (0, loginStorage_js_1.createLoginStorage)({
        configPath: CONFIG.PATHS.LOGIN_CONFIG_PATH,
        safeStorage: electron_1.safeStorage,
        fs: fs_1.default,
    });
    const firestoreService = (0, firestoreService_js_1.createFirestoreService)();
    const authHandlerDeps = { ipcMain: electron_1.ipcMain, loginStorage };
    const firestoreHandlerDeps = { ipcMain: electron_1.ipcMain, firestoreService };
    authHandlers_js_1.registerAuthHandlers(authHandlerDeps);
    firestoreHandlers_js_1.registerFirestoreHandlers(firestoreHandlerDeps);
    const Utils = (0, createMainUtils_1.createMainUtils)({ axios: axios_1.default, CONFIG, fs: fs_1.default, exec: child_process_1.exec, BrowserWindow: electron_1.BrowserWindow, dialog: electron_1.dialog });
    const client = adbkit_1.default.createClient({ bin: CONFIG.PATHS.ADB });
    electron_1.app.whenReady().then(async () => {
        (0, createMainWindow_1.createMainWindow)({ baseDir: rootDir });
        (0, initializeAutoUpdater_1.initializeAutoUpdater)({ autoUpdater: electron_updater_1.autoUpdater, log: electron_log_1.default, BrowserWindow: electron_1.BrowserWindow, CONFIG, Utils });
    }).catch(err => {
        console.log(err);
    });
    electron_1.app.on('window-all-closed', () => {
        electron_1.app.quit();
    });
    const androidServiceOptions = {
        client,
        adb: adbkit_1.default,
        ApkReader: adbkit_apkreader_1.default,
        fs: fs_1.default,
        path: path_1.default,
        os: os_1.default,
        crypto: crypto_1.default,
        log: electron_log_1.default,
        exec: child_process_1.exec,
        CONFIG,
        Utils,
        analyzeAppWithStaticModel
    };
    const androidService = (0, androidService_js_1.createAndroidService)(androidServiceOptions);
    const iosServiceOptions = {
        fs: fs_1.default,
        path: path_1.default,
        os: os_1.default,
        log: electron_log_1.default,
        CONFIG,
        Utils
    };
    const iosService = (0, iosService_js_1.createIosService)(iosServiceOptions);
    const androidHandlerDeps = {
        ipcMain: electron_1.ipcMain,
        CONFIG,
        MockData: mockData_js_1.MockData,
        Utils,
        client,
        androidService,
        log: electron_log_1.default,
        app: electron_1.app,
        BrowserWindow: electron_1.BrowserWindow
    };
    const iosHandlerDeps = {
        ipcMain: electron_1.ipcMain,
        CONFIG,
        MockData: mockData_js_1.MockData,
        iosService,
        log: electron_log_1.default,
        app: electron_1.app,
        BrowserWindow: electron_1.BrowserWindow,
        dialog: electron_1.dialog,
        Utils
    };
    const appHandlerDeps = { ipcMain: electron_1.ipcMain, BrowserWindow: electron_1.BrowserWindow, dialog: electron_1.dialog, app: electron_1.app, fs: fs_1.default };
    androidHandlers_js_1.registerAndroidHandlers(androidHandlerDeps);
    iosHandlers_1.registerIosHandlers(iosHandlerDeps);
    appHandlers_1.registerAppHandlers(appHandlerDeps);
}
