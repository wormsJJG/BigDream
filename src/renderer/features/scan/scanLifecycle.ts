import { createScanLifecycleHelpers as createScanLifecycleHelpersJs } from './scanLifecycle.js';
import type { SavedScanPayload } from '../../../types/scan-result';

export interface ScanLifecycleDeps {
  State: {
    scanRuntime: {
      inProgress: boolean;
      phase: 'idle' | 'starting' | 'completed' | 'error';
    };
    lastScanData: SavedScanPayload | null;
    currentDeviceMode: string | null;
    currentUdid?: string | null;
  };
  ViewManager: {
    activateMenu(targetId: string): void;
    showScreen(parentView: HTMLElement | null, screenId: string): void;
  };
  ResultsRenderer: {
    render(data: SavedScanPayload): void;
  };
  loggedInView: HTMLElement | null;
}

export interface ScanLifecycleHelpers {
  resetSmartphoneUI(): void;
  finishScan(
    data: SavedScanPayload,
    deps: {
      endLogTransaction(status: string, errorMessage?: string | null): Promise<void>;
      toggleLaser(isVisible: boolean): void;
    }
  ): void;
  handleError(
    error: unknown,
    deps: {
      endLogTransaction(status: string, errorMessage?: string | null): Promise<void>;
    }
  ): void;
}

export const createScanLifecycleHelpers = createScanLifecycleHelpersJs as (
  deps: ScanLifecycleDeps
) => ScanLifecycleHelpers;
