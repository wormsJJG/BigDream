// Screen entry wrapper for login-screen
import { initAuthSettings } from '../modules/authSettings.js';

export function init(ctx) {
  // This screen's logic currently lives in a shared module for compatibility.
  initAuthSettings(ctx);
}
