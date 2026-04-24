import {
  createScanDomHelpers as createScanDomHelpersJs,
  createShowAppDetail as createShowAppDetailJs,
  createScanFeatureBundle as createScanFeatureBundleJs
} from './scanBootstrapHelpers.js';
import type { AppDetailTarget, CustomUiLike, FirestoreService, RendererContext, ScanControllerRuntime, ViewManagerLike } from '../../../types/renderer-context';
import type { ApkFileRecord, SavedScanMvtResults, SavedScanPayload } from '../../../types/scan-result';
import type { AndroidDashboardControllerLike } from './scanDeviceRuntime';
import type { AndroidAppRecord } from '../../../main/services/androidService';
import type { GenericPayload } from './scanInfo';
import type { IosPrivacyThreatCard } from '../../../main/services/iosMvtParser';
import type { IosInstalledApp } from '../../../main/services/iosService';

export interface ScanDomHelpers {
  clear(el: Element | null | undefined): void;
  text(el: Element | null | undefined, value: string | number | boolean | null | undefined): void;
  el(
    tag: string,
    opts?: {
      className?: string;
      id?: string;
      attrs?: Record<string, string | number | boolean | null | undefined>;
    },
    children?: Array<Node | string | null | undefined> | Node | string | null | undefined
  ): HTMLElement;
  setBoldText(el: Element | null | undefined, textWithBTags: string): void;
  emptyMessage(text: string, className?: string): HTMLParagraphElement;
}

export interface ResultsRendererLike {
  render(data: SavedScanPayload): void;
  forceRenderIosCoreAreas(): void;
}

export interface AndroidAppListControllerLike {
  createAppIcon(app: Partial<AndroidAppRecord>, container: HTMLElement | null, listKey?: string): void;
  initAndroidAppListControls(allAndroidApps: Partial<AndroidAppRecord>[]): void;
}

export interface DeviceSecurityStatusControllerLike {
  load(container: HTMLElement | null): void | Promise<void>;
}

export interface IosCoreAreasRendererLike {
  render(mvtResults: Partial<SavedScanMvtResults>): void;
}

export interface ScanFeatureBundle {
  showAppDetail(appData: AppDetailTarget, displayName: string): void;
  androidDashboardController: AndroidDashboardControllerLike;
  androidAppListController: AndroidAppListControllerLike;
  deviceSecurityStatusController: DeviceSecurityStatusControllerLike;
  iosCoreAreasRenderer: IosCoreAreasRendererLike;
  ResultsRenderer: ResultsRendererLike;
  ScanController: ScanControllerRuntime & {
    startAndroidScan(): Promise<void>;
    startIosScan(): Promise<void>;
    checkQuota(): Promise<boolean>;
    startLogTransaction(deviceMode: string | null): Promise<boolean>;
    stopAndroidDashboardPolling?(): void;
  };
  firestoreApi: Pick<
    FirestoreService,
    'doc' | 'getDoc' | 'updateDoc' | 'collection' | 'addDoc' | 'serverTimestamp' | 'increment'
  >;
}

export interface ScanFeatureBundleDeps {
  State: RendererContext['State'];
  ViewManager: ViewManagerLike;
  CustomUI: CustomUiLike;
  Utils: {
    escapeHtml?(value: string): string;
    formatAppName?(value: string): string;
  };
  BD_DOM: ScanDomHelpers;
  renderSuspiciousListView: (args: {
    suspiciousApps?: AppDetailTarget[];
    isIos?: boolean;
    Utils?: {
      escapeHtml?(value: string): string;
      formatAppName?(value: string): string;
    };
  }) => void;
  buildIosPrivacyThreatApps: (
    allApps: Array<AppDetailTarget & Partial<IosInstalledApp> & Partial<AndroidAppRecord>>,
    incomingPrivacyApps: IosPrivacyThreatCard[],
  ) => IosPrivacyThreatCard[];
  renderApkList: (args: {
    apkFiles: ApkFileRecord[];
    container: HTMLElement | null;
    clear(target: Element): void;
    showAppDetail(app: ApkFileRecord, displayName: string): void;
  }) => void;
  renderIosInstalledApps: (args: {
    apps: Array<AppDetailTarget & Partial<IosInstalledApp> & Partial<AndroidAppRecord>>;
    container: HTMLElement | null;
    clear(target: Element): void;
    formatAppName(name: string): string;
  }) => void;
  renderMvtAnalysisPanel: (args: { mvtResults: Partial<SavedScanMvtResults>; isIos: boolean }) => void;
  bindIosAppListControls: (args: {
    State: RendererContext['State'];
    Utils: { formatAppName(name: string): string };
    apps: Array<AppDetailTarget & Partial<IosInstalledApp> & Partial<AndroidAppRecord>>;
    container: HTMLElement | null;
  }) => void;
  renderPrivacyThreatPanel: (args: { privacyApps: IosPrivacyThreatCard[]; clear(target: Element): void; formatAppName(name: string): string }) => void;
  renderSuspiciousPanel: (args: {
    suspiciousApps: AppDetailTarget[];
    isIos: boolean;
    formatAppName(name: string): string;
  }) => void;
  getNormalizedScanApps: (payload?: GenericPayload) => Array<Partial<AndroidAppRecord>>;
  normalizeLoadedScanData?: (
    payload: SavedScanPayload,
    osMode?: string | number | boolean | null | undefined,
  ) => GenericPayload;
  normalizeDeviceMode?: (modeValue: string | number | boolean | null | undefined) => '' | 'android' | 'ios';
  renderScanInfo?: (
    payload: SavedScanPayload | null | undefined,
    fileMeta?: { savedAt?: string | number | Date | null | undefined; mtimeMs?: number | null } | null,
  ) => void;
  authService: RendererContext['services']['auth'];
  firestore: FirestoreService;
  loggedInView: HTMLElement | null | undefined;
  IOS_TRUST_PROMPT_MESSAGE: string;
  resetAndroidDashboardUI: () => void;
}

export const createScanDomHelpers = createScanDomHelpersJs as () => ScanDomHelpers;
export const createShowAppDetail = createShowAppDetailJs as (
  ctx: RendererContext
) => (appData: AppDetailTarget, displayName: string) => void;
export const createScanFeatureBundle = createScanFeatureBundleJs as (
  ctx: RendererContext,
  deps: ScanFeatureBundleDeps
) => ScanFeatureBundle;
