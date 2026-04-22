type ScanDeviceRuntimeDeps = {
  State: {
    currentDeviceMode?: string;
  };
  androidDashboardController: {
    start: () => void;
    stop: () => void;
    render: (payload: unknown) => void;
  };
  document: Document;
};

export function createScanDeviceRuntimeHelpers({
  State,
  androidDashboardController,
  document
}: ScanDeviceRuntimeDeps) {
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

  function renderAndroidDashboard(payload: unknown) {
    androidDashboardController.render(payload);
  }

  return {
    toggleLaser,
    startAndroidDashboardPolling,
    stopAndroidDashboardPolling,
    renderAndroidDashboard
  };
}
