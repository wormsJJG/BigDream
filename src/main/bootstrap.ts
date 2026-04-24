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
import type { AndroidServiceOptions } from './services/androidService';
import type { IosServiceOptions } from './services/iosService';
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

type AnalyzeStaticModelLike = NonNullable<AndroidServiceOptions['analyzeAppWithStaticModel']>;
type AndroidHandlerDeps = Parameters<RegisterAndroidHandlersLike>[0];
type IosHandlerDeps = Parameters<RegisterIosHandlersLike>[0];
type AppHandlerDeps = Parameters<RegisterAppHandlersLike>[0];
type AuthHandlerDeps = Parameters<RegisterAuthHandlersLike>[0];
type FirestoreHandlerDeps = Parameters<RegisterFirestoreHandlersLike>[0];
type MainWindowLike = ReturnType<typeof createMainWindow>;

declare function require(id: string): any;

export function start({ rootDir }: StartArgs): void {
  if (!rootDir) {
    throw new Error('bootstrap.start requires { rootDir }');
  }

  try { process.chdir(rootDir); } catch (_e) { /* noop */ }

  const { analyzeAppWithStaticModel }: { analyzeAppWithStaticModel: AnalyzeStaticModelLike } = require(path.join(rootDir, 'ai', 'aiStaticAnalyzer'));

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

  const authHandlerDeps = { ipcMain, loginStorage } satisfies AuthHandlerDeps;
  const firestoreHandlerDeps = { ipcMain, firestoreService } satisfies FirestoreHandlerDeps;

  (registerAuthHandlers as RegisterAuthHandlersLike)(authHandlerDeps);
  (registerFirestoreHandlers as RegisterFirestoreHandlersLike)(firestoreHandlerDeps);

  const Utils: MainUtilsLike = createMainUtils({ axios, CONFIG, fs, exec, BrowserWindow, dialog });

  const client = adb.createClient({ bin: CONFIG.PATHS.ADB });

  app.whenReady().then(async () => {
    const mainWindow: MainWindowLike = createMainWindow({ baseDir: rootDir });
    void mainWindow;
    initializeAutoUpdater({ autoUpdater, log, BrowserWindow, CONFIG, Utils });
  }).catch(err => {
    console.log(err);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  const androidServiceOptions = {
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
  } satisfies AndroidServiceOptions;
  const androidService: AndroidServiceLike = createAndroidService(androidServiceOptions);

  const iosServiceOptions = {
    fs,
    path,
    os,
    log,
    CONFIG,
    Utils
  } satisfies IosServiceOptions;
  const iosService: IosServiceLike = createIosService(iosServiceOptions);

  const androidHandlerDeps = {
    ipcMain,
    CONFIG,
    MockData,
    Utils,
    client,
    androidService,
    log,
    app,
    BrowserWindow
  } satisfies AndroidHandlerDeps;

  const iosHandlerDeps = {
    ipcMain,
    CONFIG,
    MockData,
    iosService,
    log,
    app,
    BrowserWindow,
    dialog,
    Utils
  } satisfies IosHandlerDeps;

  const appHandlerDeps = { ipcMain, BrowserWindow, dialog, app, fs } satisfies AppHandlerDeps;

  (registerAndroidHandlers as RegisterAndroidHandlersLike)(androidHandlerDeps);
  (registerIosHandlers as RegisterIosHandlersLike)(iosHandlerDeps);
  (registerAppHandlers as RegisterAppHandlersLike)(appHandlerDeps);
}
