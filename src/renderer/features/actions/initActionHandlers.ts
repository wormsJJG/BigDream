import type { RendererContext } from '../../../types/renderer-context';
import { Utils } from '../../shared/utils.actual.js';
import { createAdminActionHandlers } from '../admin/adminActions.js';
import { createAdminCommonHelpers } from '../admin/adminCommonHelpers.js';
import {
  formatDateKR,
  formatDateTimeKR,
  toDateSafe,
  normalizeCompanyName,
  normalizeCompanyNameLower,
  isExpectedFirestoreFallbackError,
  buildQuotaHistoryGlobalEntry,
  encodeActionValue
} from '../admin/adminHelpers.js';
import { bindAdminHiddenSettings } from '../admin/adminHiddenSettings.js';
import { createAdminHistoryLogs } from '../admin/adminHistoryLogs.js';
import { createAdminShell } from '../admin/adminShell.js';
import { createAdminUsersReports } from '../admin/adminUsersReports.js';
import { bindDetailActions } from './detailActions.js';
import { bindReportPrinting } from './reportPrinting.js';
import { bindResultReporting } from './reporting.js';
import { bindUpdateUi } from './updateUi.js';

export function initActionHandlers(ctx: RendererContext): void {
  const { State, ViewManager, CustomUI, services, constants } = ctx;
  const { ID_DOMAIN } = constants;
  void ID_DOMAIN;

  const authService = services.auth;
  const {
    doc, getDoc, updateDoc, collection, getDocs, setDoc,
    query, orderBy, where, runTransaction, addDoc,
    serverTimestamp, deleteDoc, increment, limit, startAfter
  } = services.firestore as any;
  void runTransaction;
  void increment;

  const createQuotaHistoryGlobalEntry = (payload: any) => buildQuotaHistoryGlobalEntry({
    ...payload,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now()
  } as any);

  bindDetailActions({ State, Utils, CustomUI } as any);
  bindReportPrinting({ State, CustomUI } as any);
  bindUpdateUi({ CustomUI } as any);
  bindResultReporting({
    State,
    CustomUI,
    services,
    firestore: { doc, getDoc, collection, getDocs, query, orderBy, addDoc, serverTimestamp },
    formatDateTimeKR
  } as any);

  bindAdminHiddenSettings({
    State,
    CustomUI,
    authService,
    firestore: { doc, updateDoc, serverTimestamp }
  } as any);

  const AdminManager: any = {
    currentUserUid: null,
    quotaHistoryState: {
      pageSize: 10,
      currentPage: 1,
      searchKeyword: '',
      loadedPages: [],
      pageCursors: [],
      hasMore: false,
      source: 'global'
    },
    reportsState: {
      pageSize: 10,
      currentPage: 1,
      loadedPages: [],
      pageCursors: [],
      hasMore: false
    },
    abnormalLogsState: {
      pageSize: 10,
      scanBatchSize: 30,
      currentPage: 1,
      loadedPages: [],
      pageCursors: [],
      hasMore: false
    },
    detailQuotaHistoryState: {
      pageSize: 10,
      currentPage: 1,
      loadedPages: [],
      pageCursors: [],
      hasMore: false,
      source: 'global',
      ownerUid: null,
      legacyRows: null
    },
    detailReportsState: {
      pageSize: 10,
      currentPage: 1,
      loadedPages: [],
      pageCursors: [],
      hasMore: false,
      ownerUid: null,
      allRows: null
    },
    detailScanLogsState: {
      pageSize: 10,
      currentPage: 1,
      loadedPages: [],
      pageCursors: [],
      hasMore: false,
      filterKey: '',
      ownerUid: null,
      allRows: null
    }
  };

  Object.assign(AdminManager, createAdminCommonHelpers({ toDateSafe } as any));
  Object.assign(AdminManager, createAdminUsersReports({
    firestore: { collection, getDocs, getDoc, query, where, orderBy, startAfter, limit, doc },
    formatDateKR,
    formatDateTimeKR,
    toDateSafe,
    isExpectedFirestoreFallbackError,
    encodeActionValue
  } as any));
  Object.assign(AdminManager, createAdminHistoryLogs({
    firestore: { collection, getDocs, query, orderBy, startAfter, limit, where, setDoc, doc },
    formatDateTimeKR,
    toDateSafe,
    normalizeCompanyName,
    normalizeCompanyNameLower,
    isExpectedFirestoreFallbackError
  } as any));
  Object.assign(AdminManager, createAdminShell({
    State,
    ViewManager,
    CustomUI,
    services,
    constants,
    authService,
    firestore: { doc, setDoc, collection, addDoc, serverTimestamp },
    buildQuotaHistoryGlobalEntry: createQuotaHistoryGlobalEntry
  } as any));

  ctx.services = ctx.services || ({} as any);
  ctx.services.adminManager = AdminManager;
  const adminActionHandlers = createAdminActionHandlers({
    AdminManager,
    ViewManager,
    CustomUI,
    authService,
    firestore: { doc, getDoc, updateDoc, addDoc, collection, deleteDoc },
    formatDateTimeKR,
    buildQuotaHistoryGlobalEntry: createQuotaHistoryGlobalEntry
  } as any);
  adminActionHandlers.bindAdminDetailBack();
  adminActionHandlers.bindAdminActionDelegation();
}
