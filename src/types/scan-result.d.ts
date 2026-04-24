import type { RiskReason } from '../shared/risk/riskRules';
import type {
  AndroidAppRecord,
  AndroidDeviceInfo,
  AndroidScanResult,
  AndroidPrivacyThreatApp,
} from '../main/services/androidService';
import type {
  IosDeviceInfo,
  IosInstalledApp,
  IosMvtAreaResult,
  IosScanResult,
  IosPrivacyThreatCard,
  IosSuspiciousItem,
} from '../main/services/iosService';

export type DeviceMode = 'android' | 'ios';

export interface SavedScanMeta {
  savedAt?: string | number | Date;
  clientName?: string;
  clientPhone?: string;
  targetName?: string;
  targetPhone?: string;
}

export type SavedScanDeviceInfo =
  | (Partial<AndroidDeviceInfo> & { osMode?: DeviceMode })
  | (Partial<IosDeviceInfo> & { osMode?: DeviceMode });

export type AppRiskReason = RiskReason;

export type SavedAndroidScanResult = Pick<AndroidScanResult, 'deviceInfo' | 'allApps' | 'suspiciousApps' | 'privacyThreatApps' | 'apkFiles' | 'runningCount'>;
export type SavedIosScanResult = Pick<IosScanResult, 'deviceInfo' | 'allApps' | 'suspiciousItems' | 'privacyThreatApps' | 'mvtResults' | 'fileCount'>;
export type ScanAppRecord = Partial<AndroidAppRecord>;
export type SavedIosAppRecord = Partial<IosInstalledApp>;
export type SavedSuspiciousAppRecord = Partial<AndroidAppRecord> | Partial<IosSuspiciousItem>;
export type SavedPrivacyThreatRecord = AndroidPrivacyThreatApp | IosPrivacyThreatCard;

export type ApkFileRecord = Partial<AndroidAppRecord> & {
  apkPath?: string;
  installStatus?: string;
  permissions?: string[];
};

export interface SavedScanMvtResults {
  web: IosMvtAreaResult;
  messages: IosMvtAreaResult;
  system: IosMvtAreaResult;
  apps: IosMvtAreaResult;
  artifacts: IosMvtAreaResult;
  applications?: SavedIosAppRecord[];
}

export interface SavedScanPayload {
  deviceMode?: DeviceMode;
  osMode?: DeviceMode;
  meta?: SavedScanMeta;
  deviceInfo?: SavedScanDeviceInfo;
  allApps?: Array<ScanAppRecord | SavedIosAppRecord>;
  apkFiles?: SavedAndroidScanResult['apkFiles'] | ApkFileRecord[];
  privacyThreatApps?: SavedAndroidScanResult['privacyThreatApps'] | SavedIosScanResult['privacyThreatApps'];
  suspiciousApps?: SavedAndroidScanResult['suspiciousApps'] | SavedIosScanResult['suspiciousItems'];
  mvtResults?: SavedIosScanResult['mvtResults'] | Partial<SavedScanMvtResults>;
  runningCount?: SavedAndroidScanResult['runningCount'];
  fileCount?: SavedIosScanResult['fileCount'];
}
