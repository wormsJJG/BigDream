import { createIosScanProgressBinding } from './iosScanProgressBinding.js';
import type { SavedScanPayload } from '../../../types/scan-result';
import type { ScanLifecycleHelpers } from './scanLifecycle';
import type { AndroidDashboardData } from '../../../main/services/androidService';
import type { IosScanProgressPayload } from '../../../types/preload-api';

export type AndroidDashboardRenderPayload = Pick<AndroidDashboardData, 'metrics' | 'spec' | 'top'>;

export type ScanControllerMethodDeps = {
    scanDeviceRuntime: {
        toggleLaser(isVisible: boolean): void;
        startAndroidDashboardPolling(): void;
        stopAndroidDashboardPolling(): void;
        renderAndroidDashboard(payload: AndroidDashboardRenderPayload): void;
    };
    scanStartUi: {
        prepareAndroidScanStart(deps: {
            toggleLaser: (isVisible: boolean) => void;
            resetSmartphoneUI: () => void;
            startAndroidDashboardPolling: () => void;
            resetAndroidDashboardUI: () => void;
        }): void;
        prepareIosScanStart(deps: {
            toggleLaser: (isVisible: boolean) => void;
        }): void;
    };
    androidScanRunner: {
        run(deps: {
            toggleLaser: (isVisible: boolean) => void;
            onSuccess: (scanData: SavedScanPayload) => void;
            onError: (error: unknown) => void;
        }): Promise<void>;
    };
    scanLogSession: {
        startLogTransaction(deviceMode: 'android' | 'ios' | null): Promise<boolean>;
        endLogTransaction(status: string, errorMessage?: string | null): Promise<void>;
    };
    scanLogQuota: {
        checkQuota(): Promise<boolean>;
    };
    iosScanProgress: {
        setIosStep(step: number, message: string): void;
        hasMeaningfulBackupSignal(payload: IosScanProgressPayload): boolean;
        resolveIosStageMessage(payload: IosScanProgressPayload): string;
    };
    iosScanRunner: {
        run(deps: {
            setIosStep: (step: number, message: string) => void;
            onSuccess: (data: SavedScanPayload) => void;
            onError: (error: unknown) => void;
        }): Promise<void>;
    };
    scanLifecycle: ScanLifecycleHelpers;
    bdResetAndroidDashboardUI: () => void;
    IOS_TRUST_PROMPT_MESSAGE: string;
};

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
}: ScanControllerMethodDeps): {
    toggleLaser(isVisible: boolean): void;
    startAndroidScan(): Promise<void>;
    startLogTransaction(deviceMode: 'android' | 'ios' | null): Promise<boolean>;
    endLogTransaction(status: string, errorMessage?: string | null): Promise<void>;
    checkQuota(): Promise<boolean>;
    startIosScan(): Promise<void>;
    resetSmartphoneUI(): void;
    startAndroidDashboardPolling(): void;
    stopAndroidDashboardPolling(): void;
    _renderAndroidDashboard(payload: AndroidDashboardRenderPayload): void;
    finishScan(data: SavedScanPayload): void;
    handleError(error: unknown): void;
} {
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
                } catch (_e) { /* noop */ }
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
