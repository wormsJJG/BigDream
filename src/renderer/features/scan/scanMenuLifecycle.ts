import { createScanMenuLifecycle as createScanMenuLifecycleJs } from './scanMenuLifecycle.js';

export const createScanMenuLifecycle = createScanMenuLifecycleJs as (deps: any) => {
  setMenuState: (state: string) => void;
  attachShowScreenHook: () => void;
};
