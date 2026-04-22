import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import adb from 'adbkit';
import axios from 'axios';
import { exec } from 'child_process';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import ApkReader from 'adbkit-apkreader';
import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';

import { createMainWindow } from './window/createMainWindow';
import { createConfig } from './config/createConfig';
import { initializeAutoUpdater } from './updater/initializeAutoUpdater';
import { createMainUtils } from './services/createMainUtils';
import { createLoginStorage } from './services/loginStorage.js';
import { createFirestoreService } from './services/firestoreService.js';
import { registerAuthHandlers } from './ipc/authHandlers.js';
import { registerFirestoreHandlers } from './ipc/firestoreHandlers.js';
import { createAndroidService } from './services/androidService.js';
import { createIosService } from './services/iosService.js';
import { registerAndroidHandlers } from './ipc/androidHandlers.js';
import { registerIosHandlers } from './ipc/iosHandlers';
import { registerAppHandlers } from './ipc/appHandlers';
import { MockData } from './testing/mockData.js';
import type { MainConfig } from './config/createConfig';
import type { createLoginStorage as createLoginStorageTs } from './services/loginStorage';
import type { createFirestoreService as createFirestoreServiceTs } from './services/firestoreService';
import type { registerAuthHandlers as registerAuthHandlersTs } from './ipc/authHandlers';
import type { registerFirestoreHandlers as registerFirestoreHandlersTs } from './ipc/firestoreHandlers';
import type { registerAndroidHandlers as registerAndroidHandlersTs } from './ipc/androidHandlers';
import type { registerIosHandlers as registerIosHandlersTs } from './ipc/iosHandlers';
import type { registerAppHandlers as registerAppHandlersTs } from './ipc/appHandlers';

type StartArgs = {
  rootDir: string;
};

type LoginStorageLike = ReturnType<typeof createLoginStorageTs>;
type FirestoreServiceLike = ReturnType<typeof createFirestoreServiceTs>;
type MainUtilsLike = ReturnType<typeof createMainUtils>;
type AndroidServiceLike = ReturnType<typeof createAndroidService>;
type IosServiceLike = ReturnType<typeof createIosService>;
type RegisterAuthHandlersLike = typeof registerAuthHandlersTs;
type RegisterFirestoreHandlersLike = typeof registerFirestoreHandlersTs;
type RegisterAndroidHandlersLike = typeof registerAndroidHandlersTs;
type RegisterIosHandlersLike = typeof registerIosHandlersTs;
type RegisterAppHandlersLike = typeof registerAppHandlersTs;

declare function require(id: string): any;

export function start({ rootDir }: StartArgs): void {
  if (!rootDir) {
    throw new Error('bootstrap.start requires { rootDir }');
  }

  try { process.chdir(rootDir); } catch (_e) { /* noop */ }

  const { analyzeAppWithStaticModel } = require(path.join(rootDir, 'ai', 'aiStaticAnalyzer'));

  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = false;

  const CONFIG: MainConfig = createConfig({ app, rootDir });

  const loginStorage: LoginStorageLike = createLoginStorage({
    configPath: CONFIG.PATHS.LOGIN_CONFIG_PATH,
    safeStorage,
    fs,
  });

  const firestoreService: FirestoreServiceLike = createFirestoreService();

  (registerAuthHandlers as RegisterAuthHandlersLike)({ ipcMain, loginStorage });
  (registerFirestoreHandlers as RegisterFirestoreHandlersLike)({ ipcMain, firestoreService });

  const Utils: MainUtilsLike = createMainUtils({ axios, CONFIG, fs, exec, BrowserWindow, dialog });

  const client = adb.createClient({ bin: CONFIG.PATHS.ADB });

  app.whenReady().then(async () => {
    createMainWindow({ baseDir: rootDir });
    initializeAutoUpdater({ autoUpdater, log, BrowserWindow, CONFIG, Utils });
  }).catch(err => {
    console.log(err);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  const androidService: AndroidServiceLike = createAndroidService({
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

  const iosService: IosServiceLike = createIosService({
    fs,
    path,
    os,
    log,
    CONFIG,
    Utils
  });

  (registerAndroidHandlers as RegisterAndroidHandlersLike)({
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

  (registerIosHandlers as RegisterIosHandlersLike)({
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

  (registerAppHandlers as RegisterAppHandlersLike)({ ipcMain, BrowserWindow, dialog, app, fs });
}
