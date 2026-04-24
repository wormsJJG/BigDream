import { createScanLogQuotaHelpers as createScanLogQuotaHelpersJs } from './scanLogQuota.js';

import type { CustomUiLike, RendererState, FirestoreService } from '../../../types/renderer-context';

export interface ScanLogQuotaDeps {
  State: RendererState;
  CustomUI: CustomUiLike;
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
}

export interface ScanLogQuotaHelpers {
  checkQuota(): Promise<boolean>;
  startLogTransaction(deviceMode: string | null): Promise<{ ok: boolean; logId: string | null }>;
  endLogTransaction(logId: string | null, status: string, errorMessage?: string | null): Promise<string | null>;
}

export const createScanLogQuotaHelpers = createScanLogQuotaHelpersJs as (
  deps: ScanLogQuotaDeps
) => ScanLogQuotaHelpers;
