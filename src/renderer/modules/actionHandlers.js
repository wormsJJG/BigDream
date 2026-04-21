// Auto-split module: actionHandlers

import { Utils } from '../core/utils.js';
import { createAdminActionHandlers } from '../features/admin/adminActions.js';
import { createAdminCommonHelpers } from '../features/admin/adminCommonHelpers.js';
import { formatDateKR, formatDateTimeKR, toDateSafe, normalizeCompanyName, normalizeCompanyNameLower, isExpectedFirestoreFallbackError, buildQuotaHistoryGlobalEntry, encodeActionValue } from '../features/admin/adminHelpers.js';
import { bindAdminHiddenSettings } from '../features/admin/adminHiddenSettings.js';
import { createAdminHistoryLogs } from '../features/admin/adminHistoryLogs.js';
import { createAdminShell } from '../features/admin/adminShell.js';
import { createAdminUsersReports } from '../features/admin/adminUsersReports.js';
import { bindDetailActions } from '../features/actions/detailActions.js';
import { bindReportPrinting } from '../features/actions/reportPrinting.js';
import { bindResultReporting } from '../features/actions/reporting.js';
import { bindUpdateUi } from '../features/actions/updateUi.js';
export function initActionHandlers(ctx) {
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    // Firebase deps (pass-through from renderer bootstrap)
    const authService = services.auth;
    const { doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where, runTransaction, addDoc, serverTimestamp, deleteDoc, increment, limit, startAfter } = services.firestore;

    const createQuotaHistoryGlobalEntry = (payload) => buildQuotaHistoryGlobalEntry({
        ...payload,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
    });

    bindDetailActions({ State, Utils, CustomUI });
    bindReportPrinting({ State, CustomUI });
    bindUpdateUi({ CustomUI });
    bindResultReporting({
        State,
        CustomUI,
        services,
        firestore: { doc, getDoc, collection, getDocs, query, orderBy, addDoc, serverTimestamp },
        formatDateTimeKR
    });

    bindAdminHiddenSettings({
        State,
        CustomUI,
        authService,
        firestore: { doc, updateDoc, serverTimestamp }
    });
    // =========================================================
    // [11] 유틸리티 (UTILS)
    // =========================================================
    // Utils moved to ../core/utils.js
    // =========================================================
    // [12] 관리자 시스템 (ADMIN MANAGER) - 신규 추가
    // =========================================================
    const AdminManager = {

        currentUserUid: null, // 현재 보고 있는 상세 페이지의 업체 UID
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
    Object.assign(AdminManager, createAdminCommonHelpers({ toDateSafe }));
    Object.assign(AdminManager, createAdminUsersReports({
        firestore: { collection, getDocs, getDoc, query, where, orderBy, startAfter, limit, doc },
        formatDateKR,
        formatDateTimeKR,
        toDateSafe,
        isExpectedFirestoreFallbackError,
        encodeActionValue
    }));
    Object.assign(AdminManager, createAdminHistoryLogs({
        firestore: { collection, getDocs, query, orderBy, startAfter, limit, where, setDoc, doc },
        formatDateTimeKR,
        toDateSafe,
        normalizeCompanyName,
        normalizeCompanyNameLower,
        isExpectedFirestoreFallbackError
    }));
    Object.assign(AdminManager, createAdminShell({
        State,
        ViewManager,
        CustomUI,
        services,
        constants,
        authService,
        firestore: { doc, setDoc, collection, addDoc, serverTimestamp },
        buildQuotaHistoryGlobalEntry: createQuotaHistoryGlobalEntry
    }));

    ctx.services = ctx.services || {};
    ctx.services.adminManager = AdminManager;
    const adminActionHandlers = createAdminActionHandlers({
        AdminManager,
        ViewManager,
        CustomUI,
        authService,
        firestore: { doc, getDoc, updateDoc, addDoc, collection, deleteDoc },
        formatDateTimeKR,
        buildQuotaHistoryGlobalEntry: createQuotaHistoryGlobalEntry
    });
    adminActionHandlers.bindAdminDetailBack();
    adminActionHandlers.bindAdminActionDelegation();
}
