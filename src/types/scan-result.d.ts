export type DeviceMode = 'android' | 'ios';

export interface SavedScanMeta {
  savedAt?: string | number | Date;
  clientName?: string;
  clientPhone?: string;
  targetName?: string;
  targetPhone?: string;
}

export interface SavedScanDeviceInfo {
  model?: string;
  serial?: string;
  phoneNumber?: string;
  os?: string;
  osMode?: DeviceMode;
  isRooted?: boolean;
}

export interface AppRiskReason {
  code?: string;
  title?: string;
  detail?: string;
  severity?: string;
}

export interface ScanAppRecord {
  packageName?: string;
  cachedTitle?: string;
  riskLevel?: string;
  reason?: string;
  riskReasons?: AppRiskReason[];
  grantedList?: string[];
  requestedList?: string[];
  permissions?: string[];
  isRunningBg?: boolean;
  isSideloaded?: boolean;
  apkPath?: string;
  installDate?: string;
}

export interface ApkFileRecord {
  packageName?: string;
  cachedTitle?: string;
  apkPath?: string;
  installStatus?: string;
  permissions?: string[];
}

export interface SavedScanPayload {
  deviceMode?: DeviceMode;
  osMode?: DeviceMode;
  meta?: SavedScanMeta;
  deviceInfo?: SavedScanDeviceInfo;
  allApps?: ScanAppRecord[];
  apkFiles?: ApkFileRecord[];
  privacyThreatApps?: ScanAppRecord[];
  suspiciousApps?: ScanAppRecord[];
  mvtResults?: Record<string, unknown>;
  runningCount?: number;
}
