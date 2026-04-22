import type { RendererContext } from '../../../types/renderer-context';
import { initializeScanRuntime } from './scanInitRuntime.js';

export function initScanController(ctx: RendererContext): void {
  initializeScanRuntime(ctx);
}
