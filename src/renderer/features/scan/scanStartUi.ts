import type { RendererState } from '../../../types/renderer-context';

export interface ScanStartUiHelpers {
  prepareAndroidScanStart(args: {
    toggleLaser: (isVisible: boolean) => void;
    resetSmartphoneUI: () => void;
    startAndroidDashboardPolling: () => void;
    resetAndroidDashboardUI: () => void;
  }): void;
  prepareIosScanStart(args: {
    toggleLaser: (isVisible: boolean) => void;
  }): void;
  resetScanResultState(): void;
}

export function createScanStartUiHelpers({ State, document }: { State: Pick<RendererState, 'lastScanData'>; document: Document }): ScanStartUiHelpers {
  function resetScanResultState() {
    State.lastScanData = null;
  }

  function prepareAndroidScanStart({
    toggleLaser,
    resetSmartphoneUI,
    startAndroidDashboardPolling,
    resetAndroidDashboardUI
  }: {
    toggleLaser: (isVisible: boolean) => void;
    resetSmartphoneUI: () => void;
    startAndroidDashboardPolling: () => void;
    resetAndroidDashboardUI: () => void;
  }) {
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

  function prepareIosScanStart({ toggleLaser }: { toggleLaser: (isVisible: boolean) => void }) {
    resetScanResultState();
    toggleLaser(true);
  }

  return {
    prepareAndroidScanStart,
    prepareIosScanStart,
    resetScanResultState
  };
}
