import { createAndroidScanProgressHelpers } from './androidScanProgress.js';
import { createIosScanProgressHelpers } from './iosScanProgress.js';
import { createScanLifecycleHelpers } from './scanLifecycle.js';
import { createScanLogQuotaHelpers } from './scanLogQuota.js';
import { createScanPostActions } from './scanPostActions.js';
import { createScanStartUiHelpers } from './scanStartUi.js';
import { createAndroidScanRunner } from './androidScanRunner.js';
import { createIosScanRunner } from './iosScanRunner.js';
import { createScanDeviceRuntimeHelpers } from './scanDeviceRuntime.js';
import { createScanLogSessionHelpers } from './scanLogSession.js';
import { createScanControllerMethods } from './scanControllerMethods.js';
import type { RendererContext, FirestoreService } from '../../../types/renderer-context';
import type { ResultsRendererLike } from './scanBootstrapHelpers';
import type { AndroidScanProgressHelpers } from './androidScanProgress';
import type { IosScanProgressHelpers } from './iosScanProgress';
import type { ScanLifecycleHelpers } from './scanLifecycle';
import type { ScanLogQuotaHelpers } from './scanLogQuota';
import type { ScanPostActions } from './scanPostActions';
import type { AndroidDashboardControllerLike, ScanDeviceRuntimeHelpers } from './scanDeviceRuntime';
import type { ScanStartUiHelpers } from './scanStartUi';
import type { ScanLogSessionHelpers } from './scanLogSession';
import type { AndroidScanRunner } from './androidScanRunner';
import type { IosScanRunner } from './iosScanRunner';
import type { AndroidScanResult } from '../../../main/services/androidService';
import type { IosScanResult } from '../../../main/services/iosService';
import type { ScanControllerMethodDeps } from './scanControllerMethods';

export function createScanController(ctx: Pick<RendererContext, 'State' | 'ViewManager' | 'CustomUI'>, deps: {
    ResultsRenderer: ResultsRendererLike;
    Utils: {
        formatAppName(value: string): string;
        transformIosData(rawData: IosScanResult): IosScanResult;
        sleep(ms: number): Promise<unknown>;
    };
    authService: {
        getCurrentUser(): { uid?: string } | null;
    };
    getDoc: FirestoreService['getDoc'];
    doc: FirestoreService['doc'];
    updateDoc: FirestoreService['updateDoc'];
    collection: FirestoreService['collection'];
    addDoc: FirestoreService['addDoc'];
    serverTimestamp: FirestoreService['serverTimestamp'];
    increment: FirestoreService['increment'];
    androidDashboardController: AndroidDashboardControllerLike;
    bdResetAndroidDashboardUI(): void;
    IOS_TRUST_PROMPT_MESSAGE: string;
    getNormalizedScanApps(scanData: AndroidScanResult): Array<{ packageName: string }>;
    loggedInView: HTMLElement | null;
}) {
    const { State, ViewManager, CustomUI } = ctx;
    const {
        ResultsRenderer,
        Utils,
        authService,
        getDoc,
        doc,
        updateDoc,
        collection,
        addDoc,
        serverTimestamp,
        increment,
        androidDashboardController,
        bdResetAndroidDashboardUI,
        IOS_TRUST_PROMPT_MESSAGE,
        getNormalizedScanApps,
        loggedInView
    } = deps;

    const androidScanProgress: AndroidScanProgressHelpers = createAndroidScanProgressHelpers({ ViewManager, Utils });
    const iosScanProgress: IosScanProgressHelpers = createIosScanProgressHelpers({ Utils, IOS_TRUST_PROMPT_MESSAGE });
    const scanLifecycle: ScanLifecycleHelpers = createScanLifecycleHelpers({ State, ViewManager, ResultsRenderer, loggedInView });
    const scanLogQuota: ScanLogQuotaHelpers = createScanLogQuotaHelpers({
        State,
        CustomUI,
        authService,
        getDoc,
        doc,
        updateDoc,
        collection,
        addDoc,
        serverTimestamp,
        increment
    });
    const scanPostActions: ScanPostActions = createScanPostActions({ CustomUI });
    const scanStartUi: ScanStartUiHelpers = createScanStartUiHelpers({ State, document });
    const scanDeviceRuntime: ScanDeviceRuntimeHelpers = createScanDeviceRuntimeHelpers({ State, androidDashboardController, document });
    const scanLogSession: ScanLogSessionHelpers = createScanLogSessionHelpers({ scanLogQuota });
    const androidScanRunner: AndroidScanRunner = createAndroidScanRunner({
        State,
        ViewManager,
        Utils,
        getNormalizedScanApps,
        androidScanProgress,
        scanPostActions
    });
    const iosScanRunner: IosScanRunner = createIosScanRunner({
        State,
        Utils,
        scanPostActions
    });

    const controllerDeps: ScanControllerMethodDeps = {
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
    };

    return createScanControllerMethods(controllerDeps);
}
