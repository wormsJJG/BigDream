export const DEVICE_MODES = Object.freeze({
  ANDROID: 'android',
  IOS: 'ios'
} as const);

export const ANDROID_APP_ALIASES = Object.freeze([
  'allApps',
  'apps',
  'applications',
  'installedApps',
  'appList',
  'targetApps'
] as const);

export const ANDROID_RESULT_APP_ALIASES = Object.freeze([
  'results.allApps',
  'results.apps'
] as const);

export const ANDROID_APK_ALIASES = Object.freeze([
  'apkFiles',
  'apks',
  'apkList',
  'foundApks'
] as const);

export const ANDROID_RESULT_APK_ALIASES = Object.freeze([
  'results.apkFiles',
  'results.apks'
] as const);

export const ANDROID_RUNNING_ALIASES = Object.freeze([
  'runningApps',
  'backgroundApps',
  'bgApps',
  'runningPackages',
  'bgPackages'
] as const);

export const ANDROID_RESULT_RUNNING_ALIASES = Object.freeze([
  'results.runningApps',
  'results.backgroundApps'
] as const);

export const IOS_APP_ALIASES = Object.freeze([
  'allApps',
  'apps',
  'applications',
  'installedApps',
  'appList',
  'targetApps',
  'mvtResults.apps',
  'mvtResults.applications'
] as const);

export const LEGACY_RUNTIME_FIELDS = Object.freeze([
  '__bd_el',
  '__bd_fetchPromise',
  '__bd_index',
  '__bd_cached'
] as const);

export type DeviceMode = typeof DEVICE_MODES[keyof typeof DEVICE_MODES];
