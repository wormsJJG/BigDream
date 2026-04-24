import { createIosScanProgressHelpers as createIosScanProgressHelpersJs } from './iosScanProgress.js';
import type { IosScanProgressPayload } from '../../../types/preload-api';

export interface IosScanProgressDeps {
  Utils: {
    sleep(ms: number): Promise<unknown>;
  };
  IOS_TRUST_PROMPT_MESSAGE: string;
}

export interface IosScanProgressHelpers {
  setIosStep(step: number, message: string): void;
  hasMeaningfulBackupSignal(payload: IosScanProgressPayload): boolean;
  resolveIosStageMessage(payload: IosScanProgressPayload): string;
}

export const createIosScanProgressHelpers = createIosScanProgressHelpersJs as (
  deps: IosScanProgressDeps
) => IosScanProgressHelpers;
