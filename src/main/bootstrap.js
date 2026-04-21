/**
 * src/main/bootstrap.js
 * Main-process bootstrap (refactor-safe).
 * - Keeps rootDir for resource resolution.
 * - Keeps legacy relative paths working via process.chdir(rootDir).
 */
function start({ rootDir }) {
  if (!rootDir) {
    throw new Error('bootstrap.start requires { rootDir }');
  }

  // Keep legacy relative paths working (e.g., loadFile('loading.html')).
  try { process.chdir(rootDir); } catch (e) {}

  /**
   * main.js
   * BD (Big Dream) Mobile Security Solution
   * Electron Main Process
   */

  const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const crypto = require('crypto');
  const adb = require('adbkit');
  const axios = require('axios');
  const { exec } = require('child_process');
  const { autoUpdater } = require("electron-updater");
  const log = require('electron-log');
  const ApkReader = require('adbkit-apkreader');

  const { createMainWindow } = require('./window/createMainWindow');
  const { createConfig } = require('./config/createConfig');
  const { initializeAutoUpdater } = require('./updater/initializeAutoUpdater');
  const { createMainUtils } = require('./services/createMainUtils');
  const { createLoginStorage } = require('./services/loginStorage');
  const { createFirestoreService } = require('./services/firestoreService');
  const { registerAuthHandlers } = require('./ipc/authHandlers');
  const { registerFirestoreHandlers } = require('./ipc/firestoreHandlers');
  const { createAndroidService } = require('./services/androidService');
  const { createIosService } = require('./services/iosService');
  const { registerAndroidHandlers } = require('./ipc/androidHandlers');
  const { registerIosHandlers } = require('./ipc/iosHandlers');
  const { registerAppHandlers } = require('./ipc/appHandlers');
  const { MockData } = require('./testing/mockData');

  const { analyzeAppWithStaticModel } = require(path.join(rootDir, 'ai', 'aiStaticAnalyzer')); // 경로는 맞게 조정

  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = "info";
  autoUpdater.autoDownload = true; // 업데이트 발견 시 자동 다운로드
  autoUpdater.allowPrerelease = false;

  const CONFIG = createConfig({ app, rootDir });

  // ============================================================
  // [1-1] Services (side-effect free)
  // ============================================================
  const loginStorage = createLoginStorage({
    configPath: CONFIG.PATHS.LOGIN_CONFIG_PATH,
    safeStorage,
    fs,
  });

const firestoreService = createFirestoreService();



  // ==========================================================
  // [1-2] IPC registration (grouped by feature)
  // ==========================================================
  registerAuthHandlers({ ipcMain, loginStorage });
  registerFirestoreHandlers({ ipcMain, firestoreService });

  const Utils = createMainUtils({ axios, CONFIG, fs, exec, BrowserWindow, dialog });

  // ADB 클라이언트 초기화
  const client = adb.createClient({ bin: CONFIG.PATHS.ADB });

  // ============================================================
  // [2] 앱 생명주기 및 창 관리 (APP LIFECYCLE)
  // ============================================================

  // Window/updater logic moved into src/main/* modules for maintainability.

  app.whenReady().then(async () => {
      const mainWindow = createMainWindow({ baseDir: rootDir });
      initializeAutoUpdater({ autoUpdater, log, BrowserWindow, CONFIG, Utils });
  }).catch(err => {
      console.log(err)
  });

  app.on('window-all-closed', () => {
      app.quit();
  })


  // ============================================================
  // [REFAC] Android / iOS domain services + IPC handlers
  // ============================================================
  const androidService = createAndroidService({
    client,
    adb,
    ApkReader,
    fs,
    path,
    os,
    crypto,
    log,
    exec,
    CONFIG,
    Utils,
    analyzeAppWithStaticModel
  });

  const iosService = createIosService({
    fs,
    path,
    os,
    log,
    CONFIG,
    Utils
  });

  registerAndroidHandlers({
    ipcMain,
    CONFIG,
    MockData,
    Utils,
    client,
    androidService,
    log,
    app,
    BrowserWindow
  });

  registerIosHandlers({
    ipcMain,
    CONFIG,
    MockData,
    iosService,
    log,
    app,
    BrowserWindow,
    dialog,
    Utils
  });

  registerAppHandlers({ ipcMain, BrowserWindow, dialog, app, fs });
}

module.exports = { start };
