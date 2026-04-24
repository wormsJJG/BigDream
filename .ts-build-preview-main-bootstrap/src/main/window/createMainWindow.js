"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMainWindow = createMainWindow;
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
function createMainWindow({ baseDir }) {
    console.log('--- [System] Main Window Created ---');
    const mainWindow = new electron_1.BrowserWindow({
        show: false,
        frame: true,
        autoHideMenuBar: true,
        width: 1280,
        height: 900,
        webPreferences: {
            devTools: false,
            preload: path_1.default.join(baseDir, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile(path_1.default.join(baseDir, 'index.html'));
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });
    return mainWindow;
}
