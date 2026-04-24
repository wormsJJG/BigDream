import type { ScanDomHelpers } from './scanBootstrapHelpers';

declare function require(name: './scanLayoutRuntime.js'): typeof import('./scanLayoutRuntime.js');

export interface ScanLayoutRuntimeHelpers {
  resetAndroidDashboardUI(): void;
  setDashboardScrollLock(on: boolean): void;
}

export const createScanLayoutRuntimeHelpers = ((deps: { BD_DOM: ScanDomHelpers; document: Document }) =>
  require('./scanLayoutRuntime.js').createScanLayoutRuntimeHelpers(deps)) as (
  deps: { BD_DOM: ScanDomHelpers; document: Document }
) => ScanLayoutRuntimeHelpers;
