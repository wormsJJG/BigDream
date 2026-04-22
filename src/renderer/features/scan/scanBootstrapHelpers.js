import { createAndroidDashboardController } from './androidDashboardController.js';
import { createAndroidAppListController } from './androidAppListController.js';
import { createDeviceSecurityStatusController } from './deviceSecurityStatus.js';
import { createIosCoreAreasRenderer } from './iosCoreAreas.js';
import { createResultsRenderer } from './resultsRenderer.js';
import { createScanController } from './scanControllerCore.js';

export function createScanDomHelpers() {
  return {
    clear(el) { if (el) el.replaceChildren(); },
    text(el, value) { if (el) el.textContent = value == null ? '' : String(value); },
    el(tag, opts = {}, children = []) {
      const node = document.createElement(tag);
      if (opts.className) node.className = opts.className;
      if (opts.id) node.id = opts.id;
      if (opts.attrs) {
        Object.entries(opts.attrs).forEach(([key, value]) => {
          if (value === undefined || value === null) return;
          node.setAttribute(key, String(value));
        });
      }
      if (!Array.isArray(children)) children = [children];
      children.forEach((child) => {
        if (child === undefined || child === null) return;
        if (typeof child === 'string') node.appendChild(document.createTextNode(child));
        else node.appendChild(child);
      });
      return node;
    },
    setBoldText(el, textWithBTags) {
      if (!el) return;
      el.replaceChildren();
      const source = String(textWithBTags ?? '');
      const reBold = /<b>(.*?)<\/b>/g;
      let last = 0;
      let match;
      while ((match = reBold.exec(source)) !== null) {
        const index = match.index;
        if (index > last) el.appendChild(document.createTextNode(source.slice(last, index)));
        const bold = document.createElement('b');
        bold.textContent = match[1];
        el.appendChild(bold);
        last = index + match[0].length;
      }
      if (last < source.length) el.appendChild(document.createTextNode(source.slice(last)));
    },
    emptyMessage(text, className = 'sc-empty-center') {
      const paragraph = document.createElement('p');
      paragraph.className = className;
      paragraph.textContent = text;
      return paragraph;
    }
  };
}

export function createShowAppDetail(ctx) {
  return function showAppDetail(appData, displayName) {
    const mgr = ctx.services && ctx.services.appDetailManager;
    if (!mgr || typeof mgr.show !== 'function') {
      console.error('[BD-Scanner] AppDetailManager is not available yet.');
      return;
    }
    mgr.show(appData, displayName);
  };
}

export function createScanFeatureBundle(ctx, deps) {
  const {
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
    authService,
    firestore,
    loggedInView,
    IOS_TRUST_PROMPT_MESSAGE,
    resetAndroidDashboardUI
  } = deps;

  const { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, increment } = firestore;
  const showAppDetail = createShowAppDetail(ctx);

  const androidDashboardController = createAndroidDashboardController({
    State,
    CustomUI,
    clear: (el) => BD_DOM.clear(el)
  });
  const androidAppListController = createAndroidAppListController({
    State,
    Utils,
    clear: (el) => BD_DOM.clear(el),
    showAppDetail,
    getAppData: (packageName) => window.electronAPI.getAppData(packageName)
  });
  const deviceSecurityStatusController = createDeviceSecurityStatusController();
  const iosCoreAreasRenderer = createIosCoreAreasRenderer();

  const ResultsRenderer = createResultsRenderer(ctx, {
    BD_DOM,
    Utils,
    renderSuspiciousListView,
    buildIosPrivacyThreatApps,
    renderApkList,
    deviceSecurityStatusController,
    iosCoreAreasRenderer,
    renderIosInstalledApps,
    renderMvtAnalysisPanel,
    bindIosAppListControls,
    renderPrivacyThreatPanel,
    renderSuspiciousPanel,
    getNormalizedScanApps,
    androidAppListController,
    showAppDetail
  });

  const ScanController = createScanController(ctx, {
    ResultsRenderer,
    BD_DOM,
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
    bdResetAndroidDashboardUI: resetAndroidDashboardUI,
    IOS_TRUST_PROMPT_MESSAGE,
    getNormalizedScanApps,
    loggedInView
  });

  return {
    showAppDetail,
    androidDashboardController,
    androidAppListController,
    deviceSecurityStatusController,
    iosCoreAreasRenderer,
    ResultsRenderer,
    ScanController,
    firestoreApi: { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, increment }
  };
}
