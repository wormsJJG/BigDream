import { createAndroidScanProgressHelpers as createAndroidScanProgressHelpersJs } from './androidScanProgress.js';

export interface AndroidScanProgressDeps {
  ViewManager: {
    updateProgress(percent: number, text: string, isIos?: boolean): void;
  };
  Utils: {
    formatAppName(value: string): string;
  };
}

export interface AndroidScanProgressHelpers {
  startPhase1AdbProgress(): { finish(): void };
  startPhase2TimedProgress(input: {
    totalDurationMs: number;
    apps: Array<{ packageName: string }>;
    onDone(): void;
  }): void;
}

export const createAndroidScanProgressHelpers = createAndroidScanProgressHelpersJs as (
  deps: AndroidScanProgressDeps
) => AndroidScanProgressHelpers;
