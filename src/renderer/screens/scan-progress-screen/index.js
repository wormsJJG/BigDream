// Screen entry wrapper for scan-progress-screen
import { initScanController } from '../modules/scanController.js';

export function init(ctx) {
  // This screen's logic currently lives in a shared module for compatibility.
  initScanController(ctx);
}
