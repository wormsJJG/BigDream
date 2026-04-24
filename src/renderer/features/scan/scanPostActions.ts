import { createScanPostActions as createScanPostActionsJs } from './scanPostActions.js';

import type { CustomUiLike } from '../../../types/renderer-context';

export interface ScanPostActions {
  scheduleAndroidCleanupNotice(): void;
  scheduleIosBackupCleanup(udid: string | undefined): void;
}

export const createScanPostActions = createScanPostActionsJs as (
  deps: { CustomUI: CustomUiLike }
) => ScanPostActions;
