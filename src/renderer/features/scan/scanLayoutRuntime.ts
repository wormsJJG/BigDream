export const createScanLayoutRuntimeHelpers = ((deps: any) => require('./scanLayoutRuntime.js').createScanLayoutRuntimeHelpers(deps)) as (deps: any) => {
  resetAndroidDashboardUI: () => void;
  setDashboardScrollLock: (on: boolean) => void;
};
