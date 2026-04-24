import type { BdScannerApi, ElectronApiCompat } from './preload-api';
import type { DeviceMode, SavedScanPayload } from './scan-result';
import type { AndroidAppRecord } from '../main/services/androidService';
import type { IosInstalledApp, IosSuspiciousItem } from '../main/services/iosService';
import type { FirestoreSetOptions } from '../main/services/firestoreService';

export interface AuthUser {
  uid?: string;
  email?: string;
}

export interface AuthCreateUserResult extends AuthUser {
  uid: string;
}

export interface AuthService {
  setCurrentUser(user: AuthUser | null): void;
  getCurrentUser(): AuthUser | null;
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  createUser(email: string, password: string): Promise<AuthCreateUserResult>;
}

export interface FirestoreDocRef {
  __type: 'doc';
  path: string[];
}

export interface FirestoreCollectionRef {
  __type: 'collection';
  path: string[];
}

export interface FirestoreQueryRef {
  __type: 'query';
  path: string[];
  constraints: FirestoreQueryConstraint[];
}

export interface FirestoreWhereConstraint {
  __type: 'where';
  field: string;
  op: string;
  value: FirestoreDataValue;
}

export interface FirestoreOrderByConstraint {
  __type: 'orderBy';
  field: string;
  direction: 'asc' | 'desc';
}

export interface FirestoreLimitConstraint {
  __type: 'limit';
  n: number;
}

export interface FirestoreStartAfterConstraint {
  __type: 'startAfter';
  value: FirestoreDataValue;
}

export type FirestoreQueryConstraint =
  | FirestoreWhereConstraint
  | FirestoreOrderByConstraint
  | FirestoreLimitConstraint
  | FirestoreStartAfterConstraint;

export interface FirestoreIncrementOp {
  __op: 'increment';
  n: number;
}

export interface FirestoreServerTimestampOp {
  __op: 'serverTimestamp';
}

export type FirestoreFieldValue = FirestoreIncrementOp | FirestoreServerTimestampOp;

export type FirestorePrimitive = string | number | boolean | null;
export type FirestoreDataValue =
  | FirestorePrimitive
  | FirestoreFieldValue
  | Date
  | FirestoreDataRecord
  | FirestoreDataValue[];

export interface FirestoreDataRecord {
  [key: string]: FirestoreDataValue;
}

export interface FirestoreDocSnapshot<TData = FirestoreDataRecord> {
  exists(): boolean;
  data(): TData | null;
  id?: string;
}

export interface FirestoreQueryDocument<TData = FirestoreDataRecord> {
  id: string;
  data(): TData;
}

export interface FirestoreQuerySnapshot<TData = FirestoreDataRecord> {
  size: number;
  empty: boolean;
  docs: Array<FirestoreQueryDocument<TData>>;
  forEach(fn: (doc: FirestoreQueryDocument<TData>) => void): void;
}

export interface FirestoreDbRefLike {
  type?: 'firestore';
}

export interface FirestoreService {
  doc(_db: FirestoreDbRefLike | null, ...segments: string[]): FirestoreDocRef;
  collection(_db: FirestoreDbRefLike | null, ...segments: string[]): FirestoreCollectionRef;
  where(field: string, op: string, value: FirestoreDataValue): FirestoreWhereConstraint;
  orderBy(field: string, direction?: 'asc' | 'desc'): FirestoreOrderByConstraint;
  limit(n: number): FirestoreLimitConstraint;
  startAfter(value: FirestoreDataValue): FirestoreStartAfterConstraint;
  query(collectionRef: FirestoreCollectionRef, ...constraints: FirestoreQueryConstraint[]): FirestoreQueryRef;
  increment(n: number): FirestoreIncrementOp;
  serverTimestamp(): FirestoreServerTimestampOp;
  getDoc<TData = FirestoreDataRecord>(docRef: FirestoreDocRef): Promise<FirestoreDocSnapshot<TData>>;
  getDocs<TData = FirestoreDataRecord>(queryRef: FirestoreQueryRef): Promise<FirestoreQuerySnapshot<TData>>;
  setDoc(docRef: FirestoreDocRef, data: FirestoreDataRecord, options?: FirestoreSetOptions): Promise<void>;
  updateDoc(docRef: FirestoreDocRef, data: FirestoreDataRecord): Promise<void>;
  deleteDoc(docRef: FirestoreDocRef): Promise<void>;
  addDoc(collectionRef: FirestoreCollectionRef, data: FirestoreDataRecord): Promise<{ id?: string }>;
  runTransaction(): Promise<never>;
}

export interface SavedScanFileMeta {
  filePath?: string;
  mtimeMs?: number;
  savedAt?: number;
}

export type RendererIntervalHandle = ReturnType<typeof setInterval> | null;
export type CleanupCallback = () => void;
export type ScanRuntimePhase = 'idle' | 'starting' | 'completed' | 'error';
export type IosProgressMode = 'real' | 'random_20_30';
export type RendererUserRole = 'admin' | 'distributor' | 'user';

export interface RendererState {
  isLoggedIn: boolean;
  currentDeviceMode: DeviceMode | null;
  currentUdid: string | null;
  lastScanData: SavedScanPayload | null;
  lastScanFileMeta?: SavedScanFileMeta | null;
  isLoadedScan: boolean;
  androidTargetMinutes: number;
  iosProgressMode: IosProgressMode;
  agencyName: string;
  quota: number;
  userRole?: RendererUserRole;
  androidDashboardEnabled?: boolean;
  connectionCheckInterval: RendererIntervalHandle;
  scrollPostion: number;
  scanRuntime: {
    inProgress: boolean;
    phase: ScanRuntimePhase;
    androidListCleanup: CleanupCallback[];
  };
}

export interface RendererHelpers {
  setupLoggedOutNav?: () => void;
  updateAgencyDisplay?: () => void;
  renderScanInfo?: (payload: SavedScanPayload | null | undefined, fileMeta?: SavedScanFileMeta | null) => void;
  forceRenderIosCoreAreas?: () => void;
  resetAndroidDashboardUI?: () => void;
  stopAndroidDashboardPolling?: () => void;
  setDashboardScrollLock?: (locked: boolean) => void;
  setAndroidDashboardNavVisible?: (visible: boolean) => void;
  setScanInfoNavVisible?: (visible: boolean) => void;
}

export interface ScanControllerRuntime {
  startAndroidDashboardPolling?: () => void;
  stopAndroidDashboardPolling?: () => void;
}

export interface PromptChoice {
  value: string;
  label: string;
  description?: string;
}

export interface ViewManagerLike {
  showView(viewId: string): void;
  showScreen(parentView: HTMLElement | null, screenId: string): void;
  activateMenu(targetId: string): void;
  updateIosStageProgress(stage: string, text?: string): void;
  updateProgress(percent: number, text: string, isIos?: boolean): void;
}

export interface CustomUiLike {
  alert(message: string): Promise<void>;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  choose(message: string, choices?: PromptChoice[]): Promise<string | null>;
}

export interface RendererControllers {
  scanController?: ScanControllerRuntime;
}

export interface RendererConstants {
  ID_DOMAIN: string;
}

export interface RendererDomRefs {
  loggedInView: HTMLElement | null;
  loggedOutView: HTMLElement | null;
}

export interface DeviceManagerService {
  startPolling(): void;
  stopPolling(): void;
  checkDevice?(): Promise<void>;
  setUI?(status: string, titleText: string, descText: string, color: string, showBtn?: boolean): void;
}

export type AppDetailTarget = Partial<AndroidAppRecord> & Partial<IosInstalledApp> & Partial<IosSuspiciousItem>;

export interface AppDetailManagerService {
  lastScrollY?: number;
  show(app: AppDetailTarget, displayName: string): void;
  setupActionButton?(btnId: string, text: string, app: AppDetailTarget, appName: string): void;
}

export interface AdminManagerService {
  init?(): void | Promise<void>;
}

export interface RendererServicesBag {
  auth: AuthService;
  firestore: FirestoreService;
  deviceManager?: DeviceManagerService;
  appDetailManager?: AppDetailManagerService;
  adminManager?: AdminManagerService;
}

export interface RendererContext {
  State: RendererState;
  ViewManager: ViewManagerLike;
  CustomUI: CustomUiLike;
  constants: RendererConstants;
  dom: RendererDomRefs;
  helpers: RendererHelpers;
  controllers?: RendererControllers;
  services: RendererServicesBag;
}

declare global {
  interface Window {
    bdScanner: BdScannerApi;
    electronAPI: ElectronApiCompat;
  }
}

export {};
