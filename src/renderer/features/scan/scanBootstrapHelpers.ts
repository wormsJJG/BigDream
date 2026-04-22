import {
  createScanDomHelpers as createScanDomHelpersJs,
  createShowAppDetail as createShowAppDetailJs,
  createScanFeatureBundle as createScanFeatureBundleJs
} from './scanBootstrapHelpers.js';

export const createScanDomHelpers = createScanDomHelpersJs as () => any;
export const createShowAppDetail = createShowAppDetailJs as (ctx: any) => (appData: any, displayName: string) => void;
export const createScanFeatureBundle = createScanFeatureBundleJs as (ctx: any, deps: any) => any;
