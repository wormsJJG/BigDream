import { bindOpenScanFileButton as bindOpenScanFileButtonJs, bindScanStartButton as bindScanStartButtonJs } from './scanEntryBindings.js';
import type { AuthService, CustomUiLike, RendererContext, RendererState, ViewManagerLike } from '../../../types/renderer-context';
import type { SavedScanPayload } from '../../../types/scan-result';
import type { ResultsRendererLike } from './scanBootstrapHelpers';

export interface ScanStartControllerLike {
  checkQuota(): Promise<boolean>;
  startLogTransaction(deviceMode: string | null): Promise<boolean>;
  startAndroidScan(): Promise<void>;
  startIosScan(): Promise<void>;
}

export interface BindScanStartButtonDeps {
  ctx: RendererContext;
  State: RendererState;
  ViewManager: ViewManagerLike;
  CustomUI: CustomUiLike;
  authService: AuthService;
  doc: RendererContext['services']['firestore']['doc'];
  updateDoc: RendererContext['services']['firestore']['updateDoc'];
  increment: RendererContext['services']['firestore']['increment'];
  loggedInView: HTMLElement | null;
  ScanController: ScanStartControllerLike;
  setDashboardScrollLock(on: boolean): void;
  resetAndroidDashboardUI(): void;
}

export interface BindOpenScanFileButtonDeps {
  ctx: RendererContext;
  State: RendererState;
  ViewManager: ViewManagerLike;
  CustomUI: CustomUiLike;
  loggedInView: HTMLElement | null;
  ResultsRenderer: ResultsRendererLike;
  normalizeLoadedScanData(data: SavedScanPayload, osMode?: string | number | boolean | null | undefined): SavedScanPayload;
  normalizeDeviceMode(modeValue: string | number | boolean | null | undefined): '' | 'android' | 'ios';
  setDashboardScrollLock(on: boolean): void;
}

export const bindScanStartButton = bindScanStartButtonJs as (deps: BindScanStartButtonDeps) => void;
export const bindOpenScanFileButton = bindOpenScanFileButtonJs as (deps: BindOpenScanFileButtonDeps) => void;
