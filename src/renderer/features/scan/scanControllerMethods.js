import { createIosScanProgressBinding } from './iosScanProgressBinding.js';

export function createScanControllerMethods({
  scanDeviceRuntime,
  scanStartUi,
  androidScanRunner,
  scanLogSession,
  scanLogQuota,
  iosScanProgress,
  iosScanRunner,
  scanLifecycle,
  bdResetAndroidDashboardUI,
  IOS_TRUST_PROMPT_MESSAGE
}) {
  const ScanController = {
    toggleLaser(isVisible) {
      scanDeviceRuntime.toggleLaser(isVisible);
    },

    async startAndroidScan() {
      scanStartUi.prepareAndroidScanStart({
        toggleLaser: (...args) => this.toggleLaser(...args),
        resetSmartphoneUI: () => this.resetSmartphoneUI(),
        startAndroidDashboardPolling: () => this.startAndroidDashboardPolling(),
        resetAndroidDashboardUI: bdResetAndroidDashboardUI
      });
      await androidScanRunner.run({
        toggleLaser: (...args) => this.toggleLaser(...args),
        onSuccess: (scanData) => this.finishScan(scanData),
        onError: (error) => this.handleError(error)
      });
    },

    async startLogTransaction(deviceMode) {
      return scanLogSession.startLogTransaction(deviceMode);
    },

    async endLogTransaction(status, errorMessage = null) {
      await scanLogSession.endLogTransaction(status, errorMessage);
    },

    async checkQuota() {
      return scanLogQuota.checkQuota();
    },

    async startIosScan() {
      scanStartUi.prepareIosScanStart({
        toggleLaser: (...args) => this.toggleLaser(...args)
      });
      const { setIosStep, hasMeaningfulBackupSignal, resolveIosStageMessage } = iosScanProgress;
      const iosProgressBinding = createIosScanProgressBinding({
        setIosStep,
        resolveIosStageMessage,
        hasMeaningfulBackupSignal,
        trustPromptMessage: IOS_TRUST_PROMPT_MESSAGE
      });
      setIosStep(1, IOS_TRUST_PROMPT_MESSAGE);
      const offIosProgress = iosProgressBinding.bind();

      try {
        await iosScanRunner.run({
          setIosStep,
          onSuccess: (data) => this.finishScan(data),
          onError: (error) => this.handleError(error)
        });
      } catch (error) {
        this.handleError(error);
      } finally {
        try {
          if (typeof offIosProgress === 'function') offIosProgress();
        } catch (_e) {}
      }
    },

    resetSmartphoneUI() {
      scanLifecycle.resetSmartphoneUI();
    },

    startAndroidDashboardPolling() {
      scanDeviceRuntime.startAndroidDashboardPolling();
    },

    stopAndroidDashboardPolling() {
      scanDeviceRuntime.stopAndroidDashboardPolling();
    },

    _renderAndroidDashboard({ metrics, spec, top }) {
      scanDeviceRuntime.renderAndroidDashboard({ metrics, spec, top });
    },

    finishScan(data) {
      scanLifecycle.finishScan(data, {
        endLogTransaction: (...args) => this.endLogTransaction(...args),
        toggleLaser: (...args) => this.toggleLaser(...args)
      });
    },

    handleError(error) {
      scanLifecycle.handleError(error, {
        endLogTransaction: (...args) => this.endLogTransaction(...args)
      });
    }
  };

  return ScanController;
}
