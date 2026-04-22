import { Utils } from '../../shared/utils.js';
import { renderSuspiciousListView } from './scanView.js';
import { buildIosPrivacyThreatApps, renderApkList } from './appCollections.js';
import { renderIosInstalledApps } from './iosInstalledApps.js';
import { renderMvtAnalysis as renderMvtAnalysisPanel } from './mvtAnalysis.js';
import { initIosAppListControls as bindIosAppListControls, renderPrivacyThreatList as renderPrivacyThreatPanel, renderSuspiciousList as renderSuspiciousPanel } from './resultPanels.js';
import { getNormalizedScanApps, normalizeDeviceMode, normalizeLoadedScanData, renderScanInfo } from './scanInfo.js';
import { bindOpenScanFileButton, bindScanStartButton } from './scanEntryBindings.js';
import { createScanLayoutRuntimeHelpers } from './scanLayoutRuntime.js';
import { createScanMenuLifecycle } from './scanMenuLifecycle.js';
import { createScanDomHelpers, createScanFeatureBundle } from './scanBootstrapHelpers.js';

export function initializeScanRuntime(ctx) {
    const IOS_TRUST_PROMPT_MESSAGE = "검사를 위해 iPhone에서 PIN 입력 후 '이 컴퓨터 신뢰'를 승인해주세요.";
    const { State, ViewManager, CustomUI, dom, services } = ctx;
    const BD_DOM = createScanDomHelpers();
    const scanLayoutRuntime = createScanLayoutRuntimeHelpers({ BD_DOM, document });
    const scanMenuLifecycle = createScanMenuLifecycle({ State, ViewManager, document });

    ctx.helpers = ctx.helpers || {};
    ctx.helpers.renderScanInfo = (payload, fileMeta) => renderScanInfo(payload, fileMeta);
    ctx.helpers.setDashboardScrollLock = (on) => scanLayoutRuntime.setDashboardScrollLock(on);

    const { loggedInView } = dom;
    const authService = services.auth;
    const firestore = services.firestore;

    scanMenuLifecycle.attachShowScreenHook();
    try { scanMenuLifecycle.setMenuState('preScan'); } catch (_e) { }

    const {
        ResultsRenderer,
        ScanController,
        firestoreApi
    } = createScanFeatureBundle(ctx, {
        State,
        ViewManager,
        CustomUI,
        Utils,
        BD_DOM,
        renderSuspiciousListView,
        buildIosPrivacyThreatApps,
        renderApkList,
        renderIosInstalledApps,
        renderMvtAnalysisPanel,
        bindIosAppListControls,
        renderPrivacyThreatPanel,
        renderSuspiciousPanel,
        getNormalizedScanApps,
        normalizeLoadedScanData,
        normalizeDeviceMode,
        renderScanInfo,
        authService,
        firestore,
        loggedInView,
        IOS_TRUST_PROMPT_MESSAGE,
        resetAndroidDashboardUI: () => scanLayoutRuntime.resetAndroidDashboardUI()
    });

    const { doc, updateDoc, increment } = firestoreApi;

    ctx.helpers.forceRenderIosCoreAreas = () => {
        try { ResultsRenderer.forceRenderIosCoreAreas(); } catch (e) { }
    };
    ctx.helpers.resetAndroidDashboardUI = () => scanLayoutRuntime.resetAndroidDashboardUI();
    ctx.helpers.stopAndroidDashboardPolling = () => {
        try { ScanController.stopAndroidDashboardPolling && ScanController.stopAndroidDashboardPolling(); } catch (_) { }
    };

    bindScanStartButton({
        ctx,
        State,
        ViewManager,
        CustomUI,
        authService,
        doc,
        updateDoc,
        increment,
        loggedInView,
        ScanController,
        setDashboardScrollLock: (on) => scanLayoutRuntime.setDashboardScrollLock(on),
        resetAndroidDashboardUI: () => scanLayoutRuntime.resetAndroidDashboardUI()
    });
    bindOpenScanFileButton({
        ctx,
        State,
        ViewManager,
        CustomUI,
        loggedInView,
        ResultsRenderer,
        normalizeLoadedScanData,
        normalizeDeviceMode,
        setDashboardScrollLock: (on) => scanLayoutRuntime.setDashboardScrollLock(on)
    });

    return {
        IOS_TRUST_PROMPT_MESSAGE,
        ResultsRenderer,
        ScanController,
        BD_DOM
    };
}
