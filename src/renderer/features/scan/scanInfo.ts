import {
  DEVICE_MODES,
  ANDROID_APP_ALIASES,
  ANDROID_RUNNING_ALIASES,
  LEGACY_RUNTIME_FIELDS
} from '../../../shared/contracts/scanResultContract.js';
import type { AndroidAppRecord, AndroidDeviceInfo } from '../../../main/services/androidService';
import type { IosDeviceInfo } from '../../../main/services/iosService';
import type {
  ApkFileRecord,
  DeviceMode,
  SavedScanMeta,
  SavedScanMvtResults,
  SavedScanPayload
} from '../../../types/scan-result';

export type GenericPayload = SavedScanPayload & {
  meta?: SavedScanMeta & {
    targetUserName?: string;
    subjectName?: string;
    personName?: string;
    examinerName?: string;
    targetMobile?: string;
    subjectPhone?: string;
    subjectMobile?: string;
    personPhone?: string;
    examinerPhone?: string;
  };
  deviceInfo?: Partial<AndroidDeviceInfo> & Partial<IosDeviceInfo> & {
    root?: string;
    rootStatus?: string;
  };
  results?: {
    allApps?: Array<Partial<AndroidAppRecord>>;
    apps?: Array<Partial<AndroidAppRecord>>;
    apkFiles?: ApkFileRecord[];
    apks?: ApkFileRecord[];
    runningApps?: Array<string | { packageName?: string; pkg?: string; name?: string }>;
    backgroundApps?: Array<string | { packageName?: string; pkg?: string; name?: string }>;
  };
  mvtResults?: Partial<SavedScanMvtResults> & {
    applications?: Array<Partial<AndroidAppRecord>>;
  };
  allApps?: Array<Partial<AndroidAppRecord>>;
  apkFiles?: ApkFileRecord[];
  apks?: ApkFileRecord[];
  apkList?: ApkFileRecord[];
  foundApks?: ApkFileRecord[];
  runningApps?: Array<string | { packageName?: string; pkg?: string; name?: string }>;
  backgroundApps?: Array<string | { packageName?: string; pkg?: string; name?: string }>;
  targetInfo?: { name?: string; phone?: string; mobile?: string };
  target?: { name?: string; phone?: string; mobile?: string };
  subject?: { name?: string; phone?: string; mobile?: string };
  clientInfo?: { name?: string; phone?: string };
  client?: { name?: string; phone?: string };
  clientName?: string;
  clientPhone?: string;
  examinerName?: string;
  examinerPhone?: string;
  examiner?: { name?: string; phone?: string };
};

export function normalizeDeviceMode(modeValue: string | number | boolean | null | undefined): DeviceMode | '' {
  const v = String(modeValue || '').toLowerCase();
  if (v.includes('ios')) return 'ios';
  if (v.includes('android')) return 'android';
  return v === 'ios' ? 'ios' : (v === 'android' ? 'android' : '');
}

function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '-';
  const d = (value instanceof Date) ? value : new Date(value as string | number | Date);
  if (isNaN(d.getTime())) return '-';

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatRootStatus(
  deviceInfo?: (Partial<AndroidDeviceInfo> & Partial<IosDeviceInfo> & {
    root?: string;
    rootStatus?: string;
  }),
): string {
  if (!deviceInfo) return '-';
  if (deviceInfo.isRooted === true) return '위험';
  if (deviceInfo.isRooted === false) return '안전함';
  return '-';
}

function setText(id: string, text: string | number | boolean | null | undefined): void {
  const el = document.getElementById(id);
  if (el) el.textContent = (text === undefined || text === null || text === '') ? '-' : String(text);
}

function toggleHidden(id: string, shouldHide: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('hidden', shouldHide);
}

function pickFirstArray<T>(candidates: Array<T[] | null | undefined>): T[] {
  return (candidates.find((v) => Array.isArray(v)) as T[]) || [];
}

export function stripLegacyRuntimeFields<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  for (const field of LEGACY_RUNTIME_FIELDS) {
    delete obj[field];
  }
  return obj;
}

export function stripLegacyRuntimeFieldsFromList<T extends Record<string, unknown>>(list: T[] | unknown): T[] {
  if (!Array.isArray(list)) return [];
  list.forEach(stripLegacyRuntimeFields);
  return list;
}

function getNormalizedApkFiles(payload?: GenericPayload): ApkFileRecord[] {
  return pickFirstArray([
    payload?.apkFiles,
    payload?.apks,
    payload?.apkList,
    payload?.foundApks,
    payload?.results?.apkFiles,
    payload?.results?.apks
  ]);
}

function applyAndroidBackgroundState(payload: GenericPayload): void {
  const apps = Array.isArray(payload?.allApps) ? payload.allApps : [];
  const hasRunningFlag = apps.some((a) => a && typeof a.isRunningBg === 'boolean');
  if (hasRunningFlag) return;

  const raw = pickFirstArray([
    ...ANDROID_RUNNING_ALIASES.map((key) => payload?.[key]),
    payload?.results?.runningApps,
    payload?.results?.backgroundApps
  ]);

  const pkgSet = new Set(
    raw
      .map((x: string | { packageName?: string; pkg?: string; name?: string }) => (typeof x === 'string') ? x : (x?.packageName || x?.pkg || x?.name))
      .filter(Boolean)
  );

  if (!pkgSet.size) return;

  apps.forEach((app) => {
    if (!app || !app.packageName) return;
    if (pkgSet.has(app.packageName)) app.isRunningBg = true;
  });
}

function normalizeAndroidScanPayload(payload: GenericPayload): GenericPayload {
  const apps = getNormalizedScanApps(payload);
  payload.allApps = Array.isArray(payload.allApps) ? payload.allApps : apps;
  payload.apkFiles = Array.isArray(payload.apkFiles) ? payload.apkFiles : getNormalizedApkFiles(payload);

  stripLegacyRuntimeFieldsFromList(payload.allApps);
  stripLegacyRuntimeFieldsFromList(payload.apkFiles);
  applyAndroidBackgroundState(payload);

  if (typeof payload.runningCount !== 'number') {
    payload.runningCount = (payload.allApps || []).filter((a) => a && a.isRunningBg).length;
  }

  return payload;
}

export function renderScanInfo(
  payload: GenericPayload | null | undefined,
  fileMeta?: { savedAt?: string | number | Date | null | undefined; mtimeMs?: number | null },
): void {
  const hasPayload = !!payload;
  toggleHidden('scan-info-empty', hasPayload);
  toggleHidden('scan-info-wrapper', !hasPayload);

  if (!hasPayload) {
    setText('scan-info-examiner-name', '-');
    setText('scan-info-examiner-phone', '-');
    setText('scan-info-model', '-');
    setText('scan-info-os', '-');
    setText('scan-info-serial', '-');
    setText('scan-info-root', '-');
    setText('scan-info-saved-at', '-');
    return;
  }

  const meta = payload?.meta || {};
  const deviceInfo = payload?.deviceInfo || {};

  const pick = (
    ...candidates: Array<
      | string
      | number
      | boolean
      | null
      | undefined
      | {
          name?: string;
          phone?: string;
          mobile?: string;
        }
    >
  ): string => {
    for (const v of candidates) {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (!s) continue;
      if (s.includes('익명')) continue;
      if (s === '000-0000-0000' || s === '0000-00-00' || s === '0001-01-01') continue;
      return s;
    }
    return '-';
  };

  const examinerName = pick(
    meta.targetName,
    meta.targetUserName,
    meta.subjectName,
    meta.personName,
    meta.clientName,
    payload?.targetInfo?.name,
    payload?.target?.name,
    payload?.subject?.name,
    payload?.clientInfo?.name,
    payload?.client?.name,
    payload?.clientName,
    payload?.examinerName,
    payload?.examiner?.name,
    meta.examinerName
  );
  const examinerPhone = pick(
    meta.targetPhone,
    meta.targetMobile,
    meta.subjectPhone,
    meta.subjectMobile,
    meta.personPhone,
    meta.clientPhone,
    payload?.targetInfo?.phone,
    payload?.targetInfo?.mobile,
    payload?.target?.phone,
    payload?.target?.mobile,
    payload?.subject?.phone,
    payload?.subject?.mobile,
    payload?.clientInfo?.phone,
    payload?.client?.phone,
    payload?.clientPhone,
    payload?.examinerPhone,
    payload?.examiner?.phone,
    meta.examinerPhone
  );

  setText('scan-info-examiner-name', examinerName);
  setText('scan-info-examiner-phone', examinerPhone);
  setText('scan-info-model', pick(deviceInfo.model));
  setText('scan-info-os', pick(deviceInfo.os, deviceInfo.osVersion, deviceInfo.version));
  setText('scan-info-serial', pick(deviceInfo.serial));
  setText('scan-info-root', formatRootStatus(deviceInfo));

  const savedAt = meta.savedAt || fileMeta?.savedAt || fileMeta?.mtimeMs;
  setText('scan-info-saved-at', formatDateTime(savedAt));
}

export function normalizeLoadedScanData(
  payload: GenericPayload,
  osMode?: string | number | boolean | null | undefined,
): GenericPayload {
  const mode = normalizeDeviceMode(osMode || payload?.deviceInfo?.os || payload?.osMode || payload?.deviceMode);
  if (!payload || mode !== DEVICE_MODES.ANDROID) return payload;
  return normalizeAndroidScanPayload(payload);
}

export function getNormalizedScanApps(payload?: GenericPayload | null): Array<Partial<AndroidAppRecord>> {
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    ...ANDROID_APP_ALIASES.map((key) => payload?.[key]),
    payload?.results?.allApps,
    payload?.results?.apps,
    payload?.mvtResults?.apps,
    payload?.mvtResults?.applications
  ];

  return pickFirstArray(candidates);
}
