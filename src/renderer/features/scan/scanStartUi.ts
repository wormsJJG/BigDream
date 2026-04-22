type ScanStartUiDeps = {
  State: {
    lastScanData: unknown;
  };
  document: Document;
};

type AndroidStartArgs = {
  toggleLaser: (isVisible: boolean) => void;
  resetSmartphoneUI: () => void;
  startAndroidDashboardPolling: () => void;
  resetAndroidDashboardUI: () => void;
};

type IosStartArgs = {
  toggleLaser: (isVisible: boolean) => void;
};

export function createScanStartUiHelpers({ State, document }: ScanStartUiDeps) {
  function resetScanResultState() {
    State.lastScanData = null;
    State.lastScanData = null;
  }

  function prepareAndroidScanStart({
    toggleLaser,
    resetSmartphoneUI,
    startAndroidDashboardPolling,
    resetAndroidDashboardUI
  }: AndroidStartArgs) {
    resetAndroidDashboardUI();
    resetScanResultState();
    toggleLaser(true);

    const particles = document.querySelectorAll('.data-particle');
    particles.forEach((particle) => {
      const element = particle as HTMLElement;
      element.style.display = 'block';
      element.style.opacity = '1';
    });

    const alertText = document.getElementById('phoneStatusAlert');
    if (alertText) {
      alertText.textContent = 'SYSTEM SCANNING';
      alertText.classList.add('sc-preline');
      (alertText as HTMLElement).style.color = '#00d2ff';
    }

    resetSmartphoneUI();
    startAndroidDashboardPolling();
  }

  function prepareIosScanStart({ toggleLaser }: IosStartArgs) {
    resetScanResultState();
    toggleLaser(true);
  }

  return {
    prepareAndroidScanStart,
    prepareIosScanStart,
    resetScanResultState
  };
}
