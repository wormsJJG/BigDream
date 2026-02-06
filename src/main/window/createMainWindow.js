// src/main/window/createMainWindow.js

const path = require('path');
const { BrowserWindow } = require('electron');

function createMainWindow({ baseDir }) {
    console.log('--- [System] Main Window Created ---');

    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        webPreferences: {
            devTools: true,
            preload: path.join(baseDir, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(baseDir, 'index.html'));

    return mainWindow;
}

module.exports = { createMainWindow };
