import { createScanController as createScanControllerJs } from './scanControllerCore.js';

export const createScanController = createScanControllerJs as (ctx: any, deps: any) => any;
