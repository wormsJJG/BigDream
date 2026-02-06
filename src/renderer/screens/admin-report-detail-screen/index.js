// Screen entry wrapper for admin-report-detail-screen
import { initActionHandlers } from '../modules/actionHandlers.js';

export function init(ctx) {
  // This screen's logic currently lives in a shared module for compatibility.
  initActionHandlers(ctx);
}
