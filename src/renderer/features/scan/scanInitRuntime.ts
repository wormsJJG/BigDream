import { Utils } from '../../shared/utils.actual.js';
import { renderSuspiciousListView } from './scanView.js';
import { buildIosPrivacyThreatApps, renderApkList } from './appCollections.js';
import { renderIosInstalledApps } from './iosInstalledApps.js';
import { renderMvtAnalysis as renderMvtAnalysisPanel } from './mvtAnalysis.js';
import {
    initIosAppListControls as bindIosAppListControls,
    renderPrivacyThreatList as renderPrivacyThreatPanel,
    renderSuspiciousList as renderSuspiciousPanel
} from './resultPanels.js';
import {
    getNormalizedScanApps,
    normalizeDeviceMode,
    normalizeLoadedScanData,
    renderScanInfo
} from './scanInfo.js';
import { bindOpenScanFileButton, bindScanStartButton } from './scanEntryBindings.js';
import { createScanLayoutRuntimeHelpers } from './scanLayoutRuntime.js';
import { createScanMenuLifecycle } from './scanMenuLifecycle.js';
import { createScanDomHelpers, createScanFeatureBundle, type ScanFeatureBundle } from './scanBootstrapHelpers.js';
import type { RendererContext, SavedScanFileMeta } from '../../../types/renderer-context';
import type { SavedScanPayload } from '../../../types/scan-result';

export function initializeScanRuntime(ctx: RendererContext) {
    const IOS_TRUST_PROMPT_MESSAGE = "검사를 위해 iPhone에서 PIN 입력 후 '이 컴퓨터 신뢰'를 승인해주세요.";
    const { State, ViewManager, CustomUI, dom, services } = ctx;
    const BD_DOM = createScanDomHelpers();
    const scanLayoutRuntime = createScanLayoutRuntimeHelpers({ BD_DOM, document });
    const scanMenuLifecycle = createScanMenuLifecycle({ State, ViewManager, document });

    ctx.helpers = ctx.helpers || {};
    ctx.helpers.renderScanInfo = (payload: SavedScanPayload | null | undefined, fileMeta?: SavedScanFileMeta | null) =>
        renderScanInfo(payload, fileMeta);
    ctx.helpers.setDashboardScrollLock = (on: boolean) => scanLayoutRuntime.setDashboardScrollLock(on);

    const { loggedInView } = dom;
    const authService = services.auth;
    const firestore = services.firestore;

    scanMenuLifecycle.attachShowScreenHook();
    try { scanMenuLifecycle.setMenuState('preScan'); } catch (_e) { /* noop */ }

    const {
        ResultsRenderer,
        ScanController,
        firestoreApi
    }: ScanFeatureBundle = createScanFeatureBundle(ctx, {
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
        try { ResultsRenderer.forceRenderIosCoreAreas(); } catch (_e) { /* noop */ }
    };
    ctx.helpers.resetAndroidDashboardUI = () => scanLayoutRuntime.resetAndroidDashboardUI();
    ctx.helpers.stopAndroidDashboardPolling = () => {
        try { ScanController.stopAndroidDashboardPolling && ScanController.stopAndroidDashboardPolling(); } catch (_) { /* noop */ }
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
        setDashboardScrollLock: (on: boolean) => scanLayoutRuntime.setDashboardScrollLock(on),
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
        setDashboardScrollLock: (on: boolean) => scanLayoutRuntime.setDashboardScrollLock(on)
    });

    return {
        IOS_TRUST_PROMPT_MESSAGE,
        ResultsRenderer,
        ScanController,
        BD_DOM
    };
}
