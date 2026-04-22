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

export function createScanController(ctx, deps) {
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

    const androidScanProgress = createAndroidScanProgressHelpers({ ViewManager, Utils });
    const iosScanProgress = createIosScanProgressHelpers({ Utils, IOS_TRUST_PROMPT_MESSAGE });
    const scanLifecycle = createScanLifecycleHelpers({ State, ViewManager, ResultsRenderer, loggedInView });
    const scanLogQuota = createScanLogQuotaHelpers({
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
    const scanPostActions = createScanPostActions({ CustomUI });
    const scanStartUi = createScanStartUiHelpers({ State, document });
    const scanDeviceRuntime = createScanDeviceRuntimeHelpers({ State, androidDashboardController, document });
    const scanLogSession = createScanLogSessionHelpers({ scanLogQuota });
    const androidScanRunner = createAndroidScanRunner({
        State,
        ViewManager,
        Utils,
        getNormalizedScanApps,
        androidScanProgress,
        scanPostActions
    });
    const iosScanRunner = createIosScanRunner({
        State,
        Utils,
        scanPostActions
    });

    return createScanControllerMethods({
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
    });
}
