const path = require('path');
const { BrowserWindow } = require('electron');

function createMainWindow({ baseDir }) {
    console.log('--- [System] Main Window Created ---');
    const mainWindow = new BrowserWindow({
        show: false,
        frame: true,
        autoHideMenuBar: true,
        width: 1280,
        height: 900,
        webPreferences: {
            devTools: false,
            preload: path.join(baseDir, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    mainWindow.loadFile(path.join(baseDir, 'index.html'));
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });
    return mainWindow;
}

module.exports = { createMainWindow };
