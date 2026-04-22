import { bindOpenScanFileButton as bindOpenScanFileButtonJs, bindScanStartButton as bindScanStartButtonJs } from './scanEntryBindings.js';

export const bindScanStartButton = bindScanStartButtonJs as (deps: any) => void;
export const bindOpenScanFileButton = bindOpenScanFileButtonJs as (deps: any) => void;
