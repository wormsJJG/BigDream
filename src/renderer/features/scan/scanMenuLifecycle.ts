import { createScanMenuLifecycle as createScanMenuLifecycleJs } from './scanMenuLifecycle.js';
import type { RendererState, ViewManagerLike } from '../../../types/renderer-context';

export type ScanMenuState = 'preScan' | 'scanning' | 'results';

export interface ScanMenuLifecycleHelpers {
  setMenuState(state: ScanMenuState): void;
  attachShowScreenHook(): void;
}

export const createScanMenuLifecycle = createScanMenuLifecycleJs as (
  deps: {
    State: Pick<RendererState, 'currentDeviceMode' | 'isLoadedScan' | 'lastScanData'>;
    ViewManager: ViewManagerLike & {
      __bd_wrapped_showScreen?: boolean;
    };
    document: Document;
  }
) => ScanMenuLifecycleHelpers;
