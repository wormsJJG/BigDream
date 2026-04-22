import type { BdScannerApi, ElectronApiCompat } from './preload-api';

export interface AuthUser {
  uid?: string;
  email?: string;
}

export interface AuthService {
  setCurrentUser(user: AuthUser | null): void;
  getCurrentUser(): AuthUser | null;
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  createUser(email: string, password: string): Promise<AuthUser>;
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
  constraints: unknown[];
}

export interface FirestoreService {
  doc(_db: unknown, ...segments: string[]): FirestoreDocRef;
  collection(_db: unknown, ...segments: string[]): FirestoreCollectionRef;
  where(field: string, op: string, value: unknown): unknown;
  orderBy(field: string, direction?: 'asc' | 'desc'): unknown;
  limit(n: number): unknown;
  startAfter(value: unknown): unknown;
  query(collectionRef: FirestoreCollectionRef, ...constraints: unknown[]): FirestoreQueryRef;
  increment(n: number): unknown;
  serverTimestamp(): unknown;
  getDoc(docRef: FirestoreDocRef): Promise<{ exists(): boolean; data(): any; id?: string }>;
  getDocs(queryRef: FirestoreQueryRef): Promise<{ size: number; empty: boolean; docs: Array<{ id: string; data(): any }>; forEach(fn: (doc: { id: string; data(): any }) => void): void }>;
  setDoc(docRef: FirestoreDocRef, data: unknown, options?: unknown): Promise<void>;
  updateDoc(docRef: FirestoreDocRef, data: unknown): Promise<void>;
  deleteDoc(docRef: FirestoreDocRef): Promise<void>;
  addDoc(collectionRef: FirestoreCollectionRef, data: unknown): Promise<{ id?: string }>;
  runTransaction(): Promise<never>;
}

export interface RendererState {
  isLoggedIn: boolean;
  currentDeviceMode: string | null;
  currentUdid: string | null;
  lastScanData: unknown;
  lastScanFileMeta?: unknown;
  isLoadedScan: boolean;
  androidTargetMinutes: number;
  iosProgressMode: string;
  agencyName: string;
  quota: number;
  userRole?: string;
  androidDashboardEnabled?: boolean;
  connectionCheckInterval: unknown;
  scrollPostion: number;
  scanRuntime: {
    inProgress: boolean;
    phase: string;
    androidListCleanup: Array<unknown>;
  };
}

export interface RendererHelpers {
  setupLoggedOutNav?: () => void;
  updateAgencyDisplay?: () => void;
  renderScanInfo?: (payload: unknown, fileMeta?: unknown) => void;
  forceRenderIosCoreAreas?: () => void;
  resetAndroidDashboardUI?: () => void;
  stopAndroidDashboardPolling?: () => void;
  setDashboardScrollLock?: (locked: boolean) => void;
  setAndroidDashboardNavVisible?: (visible: boolean) => void;
  setScanInfoNavVisible?: (visible: boolean) => void;
}

export interface RendererControllers {
  scanController?: {
    startAndroidDashboardPolling?: () => void;
  };
}

export interface RendererServicesBag {
  auth: AuthService;
  firestore: FirestoreService;
  deviceManager?: {
    startPolling(): void;
    stopPolling(): void;
  };
  appDetailManager?: {
    show(app: unknown, displayName: string): void;
  };
  adminManager?: {
    init?(): void;
  };
}

export interface RendererContext {
  State: RendererState;
  ViewManager: any;
  CustomUI: any;
  constants: {
    ID_DOMAIN: string;
  };
  dom: {
    loggedInView: HTMLElement | null;
    loggedOutView: HTMLElement | null;
  };
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
