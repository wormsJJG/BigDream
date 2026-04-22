import path from 'path';
import os from 'os';

type AppLike = {
  isPackaged: boolean;
  getPath(name: string): string;
};

type CreateConfigArgs = {
  app: AppLike;
  rootDir: string;
};

type AppPaths = {
  ADB: string;
  IOS_TOOLS: string;
  IOS_ID: string;
  IOS_PAIR: string;
  IOS_INFO: string;
  IOS_BACKUP: string;
  TEMP_BACKUP: string;
  MVT_RESULT: string;
  LOGIN_CONFIG_PATH: string;
};

export type MainConfig = {
  IS_DEV_MODE: boolean;
  KEEP_BACKUP: boolean;
  VIRUSTOTAL_API_KEY: string;
  PATHS: AppPaths;
};

function parseBool(v: unknown, fallback = false): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === 0) return Boolean(v);
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  }
  return fallback;
}

function getOptionalSecret(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function createConfig({ app, rootDir }: CreateConfigArgs): MainConfig {
  if (!app) throw new Error('createConfig: app is required');
  if (!rootDir) throw new Error('createConfig: rootDir is required');

  const resourceDir = app.isPackaged ? process.resourcesPath : rootDir;
  void parseBool;

  return {
    IS_DEV_MODE: false,
    KEEP_BACKUP: false,
    VIRUSTOTAL_API_KEY: getOptionalSecret('BIGDREAM_VIRUSTOTAL_API_KEY', 'VIRUSTOTAL_API_KEY'),
    PATHS: {
      ADB: path.join(resourceDir, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb'),
      IOS_TOOLS: path.join(resourceDir, 'ios-tools'),
      IOS_ID: path.join(resourceDir, 'ios-tools', os.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id'),
      IOS_PAIR: path.join(resourceDir, 'ios-tools', os.platform() === 'win32' ? 'idevicepair.exe' : 'idevicepair'),
      IOS_INFO: path.join(resourceDir, 'ios-tools', os.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo'),
      IOS_BACKUP: path.join(resourceDir, 'ios-tools', os.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2'),
      TEMP_BACKUP: path.join(app.getPath('userData'), 'iphone_backups'),
      MVT_RESULT: path.join(app.getPath('userData'), 'mvt_results'),
      LOGIN_CONFIG_PATH: path.join(app.getPath('userData'), 'login-info.json')
    }
  };
}
