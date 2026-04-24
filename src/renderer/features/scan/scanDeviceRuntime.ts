import type { RendererState } from '../../../types/renderer-context';
import type { AndroidDashboardData } from '../../../main/services/androidService';

export interface AndroidDashboardControllerLike {
  start(): void;
  stop(): void;
  render(payload: AndroidDashboardData): void;
}

export interface ScanDeviceRuntimeHelpers {
  toggleLaser(isVisible: boolean): void;
  startAndroidDashboardPolling(): void;
  stopAndroidDashboardPolling(): void;
  renderAndroidDashboard(payload: AndroidDashboardData): void;
}

export function createScanDeviceRuntimeHelpers({
  State,
  androidDashboardController,
  document
}: {
  State: Pick<RendererState, 'currentDeviceMode'>;
  androidDashboardController: AndroidDashboardControllerLike;
  document: Document;
}): ScanDeviceRuntimeHelpers {
  function toggleLaser(isVisible: boolean) {
    const show = !!isVisible;

    const dashBeam = document.getElementById('dashboardScannerBeam') as HTMLElement | null;
    const legacyBeam = document.getElementById('scannerBeam') as HTMLElement | null;

    if (State.currentDeviceMode === 'android') {
      if (dashBeam) dashBeam.style.display = show ? 'block' : 'none';
      if (legacyBeam) legacyBeam.style.display = 'none';
      return;
    }

    if (legacyBeam) legacyBeam.style.display = show ? 'block' : 'none';
    if (dashBeam) dashBeam.style.display = 'none';
  }

  function startAndroidDashboardPolling() {
    androidDashboardController.start();
  }

  function stopAndroidDashboardPolling() {
    androidDashboardController.stop();
  }

  function renderAndroidDashboard(payload: AndroidDashboardData) {
    androidDashboardController.render(payload);
  }

  return {
    toggleLaser,
    startAndroidDashboardPolling,
    stopAndroidDashboardPolling,
    renderAndroidDashboard
  };
}
