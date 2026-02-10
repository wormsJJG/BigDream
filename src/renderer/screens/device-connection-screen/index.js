// Screen entry wrapper for device-connection-screen
import { initClientDevice } from '../modules/clientDevice.js';

export function init(ctx) {
  // This screen's logic currently lives in a shared module for compatibility.
  initClientDevice(ctx);
}
