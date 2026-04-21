export function createAdminHistoryLogs({
    firestore,
    formatDateTimeKR,
    toDateSafe,
    normalizeCompanyName,
    normalizeCompanyNameLower,
    isExpectedFirestoreFallbackError
}) {
    const {
        collection,
        getDocs,
        query,
        orderBy,
        startAfter,
        limit,
        where,
        setDoc,
        doc
    } = firestore;

    return {
        classifyAbnormalLog(log) {
            let type = null;
            if (log.status === 'error') {
                type = 'ERROR';
            } else if (log.status === 'started' && !log.endTime) {
                const startTime = toDateSafe(log.startTime) || new Date();
                const diff = (new Date() - startTime) / 1000 / 60;
                if (diff > 60) type = 'INCOMPLETE';
            }
            if (!type) return null;
            return {
                loggedAt: log.startTime || null,
                cursorValue: toDateSafe(log.startTime),
                companyLabel: `${log.companyName || 'Unknown'} (${log.userId || '-'})`,
                deviceMode: log.deviceMode || '-',
                type,
                message: type === 'ERROR' ? (log.errorMessage || '원인 불명 에러') : '종료 기록 없음(강제종료 의심)'
            };
        },

        renderAbnormalLogRows(items = []) {
            const tbody = document.getElementById('abnormal-log-body');
            if (!tbody) return;
            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:green;">🎉 최근 발견된 비정상 로그가 없습니다.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map((item) => {
                const badgeClass = item.type === 'ERROR' ? 'badge-error' : 'badge-incomplete';
                return `
                    <tr>
                        <td>${formatDateTimeKR(item.loggedAt)}</td>
                        <td>${item.companyLabel}</td>
                        <td>${item.deviceMode}</td>
                        <td><span class="abnormal-badge ${badgeClass}">${item.type}</span></td>
                        <td style="color:#d9534f; font-size:13px;">${item.message}</td>
                    </tr>
                `;
            }).join('');
        },

        renderAbnormalPagination() {
            this.renderPageButtons({
                containerId: 'abnormal-log-pagination',
                state: this.abnormalLogsState,
                buttonClass: 'abnormal-log-page-btn',
                onClick: (page) => this.loadAbnormalLogs(page)
            });
        },

        async ensureAbnormalLogPage(page) {
            const state = this.abnormalLogsState;
            let cursor = state.pageCursors[state.loadedPages.length - 1] ?? null;
            let exhausted = false;

            while (state.loadedPages.length < page && !exhausted) {
                let pageItems = [];
                while (pageItems.length < state.pageSize && !exhausted) {
                    const constraints = [orderBy('startTime', 'desc')];
                    if (cursor) constraints.push(startAfter(cursor));
                    constraints.push(limit(state.scanBatchSize));

                    const snapshot = await getDocs(query(collection(null, 'scan_logs'), ...constraints));
                    const docs = snapshot.docs.map((docSnap) => docSnap.data() || {});
                    if (docs.length === 0) {
                        exhausted = true;
                        break;
                    }
                    docs.forEach((log) => {
                        const abnormalItem = this.classifyAbnormalLog(log);
                        if (abnormalItem && pageItems.length < state.pageSize) {
                            pageItems.push(abnormalItem);
                        }
                    });
                    cursor = toDateSafe(docs[docs.length - 1]?.startTime);
                    if (docs.length < state.scanBatchSize || !cursor) exhausted = true;
                }
                if (pageItems.length === 0) break;
                state.loadedPages.push(pageItems);
                state.pageCursors.push(cursor);
            }

            state.hasMore = !exhausted;
        },

        async loadAbnormalLogs(page = 1, options = {}) {
            const tbody = document.getElementById('abnormal-log-body');
            if (!tbody) return;

            const state = this.abnormalLogsState;
            if (options.reset) this.resetPagedState(state);
            if (page < 1) page = 1;
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">로그 검색 중...</td></tr>';

            try {
                if (page <= state.loadedPages.length) {
                    state.currentPage = page;
                    this.renderAbnormalLogRows(state.loadedPages[page - 1] || []);
                    this.renderAbnormalPagination();
                    return;
                }
                await this.ensureAbnormalLogPage(page);
                state.currentPage = Math.min(page, Math.max(1, state.loadedPages.length || 1));
                this.renderAbnormalLogRows(state.loadedPages[state.currentPage - 1] || []);
                this.renderAbnormalPagination();
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로그 로드 실패: ${e.message}</td></tr>`;
                document.getElementById('abnormal-log-pagination').innerHTML = '';
            }
        },

        async loadLegacyQuotaHistory() {
            const historyRows = [];
            const usersSnap = await getDocs(query(collection(null, 'users'), orderBy('createdAt', 'desc')));
            for (const userDoc of usersSnap.docs) {
                const userData = userDoc.data() || {};
                if (userData.role === 'admin') continue;
                const historySnap = await getDocs(
                    query(collection(null, 'users', userDoc.id, 'quotaHistory'), orderBy('createdAt', 'desc'), limit(30))
                );
                historySnap.forEach((historyDoc) => {
                    const item = historyDoc.data() || {};
                    historyRows.push({
                        uid: userDoc.id,
                        companyName: item.companyName || userData.companyName || '미등록 업체',
                        companyNameLower: normalizeCompanyNameLower(item.companyName || userData.companyName || ''),
                        userId: userData.userId || userData.email || userDoc.id,
                        change: Number(item.change || 0),
                        beforeQuota: Number(item.beforeQuota || 0),
                        afterQuota: Number(item.afterQuota || 0),
                        reason: item.reason || '-',
                        actorEmail: item.actorEmail || '-',
                        createdAt: item.createdAt || null,
                        createdAtMs: Number(item.createdAtMs || toDateSafe(item.createdAt)?.getTime() || 0),
                        actionType: item.actionType || 'adjust'
                    });
                });
            }
            historyRows.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
            return historyRows;
        },

        buildQuotaHistoryDocId(item) {
            const base = [
                item.uid || 'nouid',
                item.createdAtMs || 0,
                item.actionType || 'adjust',
                item.change || 0,
                item.afterQuota || 0,
                (item.reason || '-').slice(0, 30)
            ].join('_');
            return base.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
        },

        async backfillQuotaHistoryGlobal(items = []) {
            if (!Array.isArray(items) || items.length === 0) return;
            const jobs = items.map(async (item) => {
                try {
                    const id = this.buildQuotaHistoryDocId(item);
                    await setDoc(doc(null, 'quotaHistoryGlobal', id), {
                        uid: item.uid || null,
                        companyName: item.companyName || '미등록 업체',
                        companyNameLower: normalizeCompanyNameLower(item.companyName),
                        userId: item.userId || item.uid || '-',
                        change: Number(item.change || 0),
                        beforeQuota: Number(item.beforeQuota || 0),
                        afterQuota: Number(item.afterQuota || 0),
                        reason: item.reason || '-',
                        actorEmail: item.actorEmail || '-',
                        actorUid: item.actorUid || null,
                        createdAt: item.createdAt || null,
                        createdAtMs: Number(item.createdAtMs || 0),
                        actionType: item.actionType || 'adjust'
                    }, { merge: true });
                } catch (e) {
                    console.warn('quotaHistoryGlobal backfill skip:', e?.message || e);
                }
            });
            await Promise.all(jobs);
        },

        paginateQuotaHistoryItems(items = []) {
            const pages = [];
            for (let i = 0; i < items.length; i += this.quotaHistoryState.pageSize) {
                pages.push(items.slice(i, i + this.quotaHistoryState.pageSize));
            }
            return pages;
        },

        async activateLegacyQuotaHistory(normalizedSearch = '') {
            const state = this.quotaHistoryState;
            const allLegacy = await this.loadLegacyQuotaHistory();
            const filteredLegacy = normalizedSearch
                ? allLegacy.filter((item) => normalizeCompanyNameLower(item.companyName).includes(normalizedSearch))
                : allLegacy;
            state.source = 'legacy';
            state.currentPage = 1;
            state.loadedPages = this.paginateQuotaHistoryItems(filteredLegacy);
            state.pageCursors = [];
            state.hasMore = false;
            if (filteredLegacy.length > 0) {
                this.backfillQuotaHistoryGlobal(filteredLegacy.slice(0, 300)).catch((e) => {
                    console.warn('quotaHistoryGlobal background backfill failed:', e?.message || e);
                });
            }
        },

        async fetchGlobalQuotaHistoryBatch(cursorValue = null, batchSize = 100) {
            const constraints = [orderBy('createdAtMs', 'desc')];
            if (cursorValue !== null && cursorValue !== undefined) constraints.push(startAfter(cursorValue));
            constraints.push(limit(batchSize));
            const snap = await getDocs(query(collection(null, 'quotaHistoryGlobal'), ...constraints));
            const rows = snap.docs.map((docSnap) => {
                const item = docSnap.data() || {};
                return {
                    ...item,
                    id: docSnap.id,
                    createdAtMs: Number(item.createdAtMs || toDateSafe(item.createdAt)?.getTime() || 0)
                };
            });
            return {
                rows,
                cursor: rows.length ? rows[rows.length - 1].createdAtMs : null,
                hasMore: rows.length === batchSize
            };
        },

        async ensureQuotaHistorySearchPage(page, normalizedSearch) {
            const state = this.quotaHistoryState;
            if (!state.searchScan) {
                state.searchScan = { cursor: null, exhausted: false, matchedRows: [] };
            }
            while (state.loadedPages.length < page && !state.searchScan.exhausted) {
                const batch = await this.fetchGlobalQuotaHistoryBatch(state.searchScan.cursor, 100);
                const matched = batch.rows.filter((item) => {
                    const company = normalizeCompanyNameLower(item.companyName);
                    const userId = normalizeCompanyNameLower(item.userId);
                    return company.includes(normalizedSearch) || userId.includes(normalizedSearch);
                });
                if (matched.length > 0) {
                    state.searchScan.matchedRows.push(...matched);
                    state.loadedPages = this.paginateQuotaHistoryItems(state.searchScan.matchedRows);
                }
                state.searchScan.cursor = batch.cursor;
                state.searchScan.exhausted = !batch.hasMore;
                if (batch.rows.length === 0) state.searchScan.exhausted = true;
            }
            state.hasMore = !state.searchScan.exhausted;
        },

        renderQuotaHistoryRows(items) {
            const tbody = document.getElementById('admin-quota-history-body');
            if (!tbody) return;
            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888; padding:20px;">등록된 횟수 변경 이력이 없습니다.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map((item) => {
                const changeText = item.change > 0 ? `+${item.change}회` : `${item.change}회`;
                const changeColor = item.change > 0 ? '#1e7e34' : '#c0392b';
                const reasonPrefix = item.actionType === 'create' ? '초기 지급' : '변경 사유';
                return `
                    <tr>
                        <td>${formatDateTimeKR(item.createdAtMs || item.createdAt)}</td>
                        <td><div style="font-weight:700;">${item.companyName || '미등록 업체'}</div><div style="font-size:12px; color:#888;">${item.userId || '-'}</div></td>
                        <td style="font-weight:700; color:${changeColor};">${changeText}</td>
                        <td>${Number(item.beforeQuota || 0)} → ${Number(item.afterQuota || 0)}</td>
                        <td>${reasonPrefix}: ${item.reason || '-'}</td>
                        <td>${item.actorEmail || '-'}</td>
                    </tr>
                `;
            }).join('');
        },

        renderQuotaHistoryPagination() {
            this.renderPageButtons({
                containerId: 'quota-history-pagination',
                state: this.quotaHistoryState,
                buttonClass: 'quota-history-page-btn',
                onClick: (page) => this.loadQuotaHistory(page)
            });
        },

        renderDetailQuotaHistoryRows(items) {
            const tbody = document.getElementById('detail-quota-history-body');
            if (!tbody) return;
            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888; padding:20px;">등록된 횟수 변경 이력이 없습니다.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map((item) => {
                const changeText = item.change > 0 ? `+${item.change}회` : `${item.change}회`;
                const changeColor = item.change > 0 ? '#1e7e34' : '#c0392b';
                const reasonPrefix = item.actionType === 'create' ? '초기 지급' : '변경 사유';
                return `
                    <tr>
                        <td>${formatDateTimeKR(item.createdAtMs || item.createdAt)}</td>
                        <td style="font-weight:700; color:${changeColor};">${changeText}</td>
                        <td>${item.beforeQuota} → ${item.afterQuota}</td>
                        <td>${reasonPrefix}: ${item.reason}</td>
                        <td>${item.actorEmail}</td>
                    </tr>
                `;
            }).join('');
        },

        renderDetailQuotaHistoryPagination() {
            this.renderPageButtons({
                containerId: 'detail-quota-history-pagination',
                state: this.detailQuotaHistoryState,
                buttonClass: 'detail-quota-history-page-btn',
                onClick: (page) => this.loadUserDetailQuotaHistory(this.currentUserUid, page)
            });
        },

        async loadUserDetailQuotaHistory(uid, page = 1, options = {}) {
            const tbody = document.getElementById('detail-quota-history-body');
            if (!tbody || !uid) return;

            const state = this.detailQuotaHistoryState;
            if (options.reset || state.ownerUid !== uid) {
                state.ownerUid = uid;
                state.source = 'global';
                this.resetPagedState(state);
            }

            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888; padding:20px;">변경 이력을 불러오는 중...</td></tr>';

            try {
                if (page <= state.loadedPages.length) {
                    state.currentPage = page;
                    this.renderDetailQuotaHistoryRows(state.loadedPages[page - 1] || []);
                    this.renderDetailQuotaHistoryPagination();
                    return;
                }

                let rows = [];
                let lastCursor = null;

                if (state.source === 'global') {
                    try {
                        const constraints = [
                            where('uid', '==', uid),
                            orderBy('createdAtMs', 'desc')
                        ];
                        if (page > 1) {
                            const prevCursor = state.pageCursors[page - 2];
                            if (!prevCursor) {
                                state.currentPage = Math.max(1, state.loadedPages.length);
                                this.renderDetailQuotaHistoryRows(state.loadedPages[state.currentPage - 1] || []);
                                this.renderDetailQuotaHistoryPagination();
                                return;
                            }
                            constraints.push(startAfter(prevCursor));
                        }
                        constraints.push(limit(state.pageSize + 1));

                        const globalSnap = await getDocs(query(
                            collection(null, 'quotaHistoryGlobal'),
                            ...constraints
                        ));

                        rows = globalSnap.docs.map((docSnap) => {
                            const item = docSnap.data() || {};
                            return {
                                change: Number(item.change || 0),
                                beforeQuota: Number(item.beforeQuota || 0),
                                afterQuota: Number(item.afterQuota || 0),
                                reason: item.reason || '-',
                                actorEmail: item.actorEmail || '-',
                                createdAt: item.createdAt || null,
                                createdAtMs: Number(item.createdAtMs || toDateSafe(item.createdAt)?.getTime() || 0),
                                actionType: item.actionType || 'adjust'
                            };
                        });
                        state.hasMore = rows.length > state.pageSize;
                        rows = rows.slice(0, state.pageSize);
                        lastCursor = rows.length ? (rows[rows.length - 1]?.createdAtMs ?? null) : null;
                    } catch (globalError) {
                        if (!isExpectedFirestoreFallbackError(globalError)) {
                            console.warn('detail quotaHistoryGlobal load fallback:', globalError);
                        }
                        state.source = 'legacy';
                        this.resetPagedState(state);
                    }
                }

                if (!rows.length && state.source === 'legacy') {
                    if (!Array.isArray(state.legacyRows)) {
                        const legacySnap = await getDocs(query(
                            collection(null, 'users', uid, 'quotaHistory'),
                            orderBy('createdAt', 'desc')
                        ));

                        state.legacyRows = legacySnap.docs.map((docSnap) => {
                            const item = docSnap.data() || {};
                            return {
                                change: Number(item.change || 0),
                                beforeQuota: Number(item.beforeQuota || 0),
                                afterQuota: Number(item.afterQuota || 0),
                                reason: item.reason || '-',
                                actorEmail: item.actorEmail || '-',
                                createdAt: item.createdAt || null,
                                createdAtMs: Number(toDateSafe(item.createdAt)?.getTime() || 0),
                                actionType: item.actionType || 'adjust'
                            };
                        });
                    }

                    const startIndex = (page - 1) * state.pageSize;
                    rows = (state.legacyRows || []).slice(startIndex, startIndex + state.pageSize);
                    state.hasMore = startIndex + state.pageSize < (state.legacyRows || []).length;
                    lastCursor = null;
                }

                if (!rows.length) {
                    state.hasMore = false;
                    this.renderDetailQuotaHistoryRows([]);
                    this.renderDetailQuotaHistoryPagination();
                    return;
                }

                state.loadedPages[page - 1] = rows;
                state.pageCursors[page - 1] = lastCursor;
                state.currentPage = page;
                this.renderDetailQuotaHistoryRows(rows);
                this.renderDetailQuotaHistoryPagination();
            } catch (e) {
                console.error(e);
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red; padding:20px;">이력 로드 실패: ${e.message}</td></tr>`;
                const container = document.getElementById('detail-quota-history-pagination');
                if (container) container.innerHTML = '';
            }
        },

        renderDetailScanLogRows(items) {
            const tbody = document.getElementById('user-scan-logs-body');
            if (!tbody) return;

            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">검사 기록이 없습니다.</td></tr>';
                return;
            }

            tbody.innerHTML = items.map((log) => {
                const startTime = toDateSafe(log.startTime);
                const endTime = toDateSafe(log.endTime);
                const dateStr = startTime ? startTime.toLocaleString('ko-KR') : '-';
                const statusClass = log.status === 'completed' ? 'color:green' : (log.status === 'error' ? 'color:red' : 'color:orange');

                let durationStr = '-';
                if (startTime && endTime) {
                    const diffMs = endTime - startTime;
                    const seconds = Math.floor(diffMs / 1000);
                    durationStr = seconds > 60
                        ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초`
                        : `${seconds}초`;
                }

                return `
                    <tr>
                        <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${dateStr}</td>
                        <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${log.deviceMode || '-'}</td>
                        <td style="${statusClass}; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${String(log.status || '-').toUpperCase()}</td>
                        <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${durationStr}</td>
                        <td style="font-size:12px; color:#d9534f; white-space:normal; word-break:break-word; overflow-wrap:anywhere; line-height:1.4;">${log.errorMessage || '-'}</td>
                    </tr>
                `;
            }).join('');
        },

        renderDetailScanLogsPagination() {
            this.renderPageButtons({
                containerId: 'detail-scan-logs-pagination',
                state: this.detailScanLogsState,
                buttonClass: 'detail-scan-log-page-btn',
                onClick: (page) => {
                    const startDate = document.getElementById('log-date-start')?.value || null;
                    const endDate = document.getElementById('log-date-end')?.value || null;
                    this.loadScanLogs(this.currentUserUid, startDate, endDate, page);
                }
            });
        },

        async loadScanLogs(uid, startDate = null, endDate = null, page = 1, options = {}) {
            const tbody = document.getElementById('user-scan-logs-body');
            if (!tbody || !uid) return;

            const state = this.detailScanLogsState;
            const filterKey = `${startDate || ''}__${endDate || ''}`;
            if (options.reset || state.filterKey !== filterKey || state.ownerUid !== uid) {
                this.resetPagedState(state);
                state.filterKey = filterKey;
                state.ownerUid = uid;
            }

            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">로그를 불러오는 중...</td></tr>';

            try {
                if (page <= state.loadedPages.length) {
                    state.currentPage = page;
                    this.renderDetailScanLogRows(state.loadedPages[page - 1] || []);
                    this.renderDetailScanLogsPagination();
                    return;
                }

                if (!Array.isArray(state.allRows)) {
                    const constraints = [
                        where('userId', '==', uid)
                    ];

                    if (startDate && endDate) {
                        const startTimestamp = new Date(startDate);
                        const endTimestamp = new Date(endDate);
                        endTimestamp.setDate(endTimestamp.getDate() + 1);

                        if (startTimestamp.getTime() >= endTimestamp.getTime()) {
                            throw new Error('검색 시작일은 종료일보다 이전이어야 합니다.');
                        }
                        constraints.push(where('startTime', '>=', startTimestamp));
                        constraints.push(where('startTime', '<', endTimestamp));
                    } else if (startDate || endDate) {
                        throw new Error('기간 검색을 위해 시작일과 종료일을 모두 입력해야 합니다.');
                    }

                    constraints.push(orderBy('startTime', 'desc'));

                    try {
                        const logsSnap = await getDocs(query(
                            collection(null, 'scan_logs'),
                            ...constraints
                        ));
                        state.allRows = logsSnap.docs.map((docSnap) => docSnap.data() || {});
                    } catch (queryError) {
                        if (!isExpectedFirestoreFallbackError(queryError)) {
                            console.warn('detail scan_logs load fallback:', queryError);
                        }
                        const fallbackSnap = await getDocs(query(
                            collection(null, 'scan_logs'),
                            orderBy('startTime', 'desc')
                        ));

                        const startTimestamp = startDate && endDate ? new Date(startDate) : null;
                        const endTimestamp = startDate && endDate ? new Date(endDate) : null;
                        if (endTimestamp) endTimestamp.setDate(endTimestamp.getDate() + 1);

                        state.allRows = fallbackSnap.docs
                            .map((docSnap) => docSnap.data() || {})
                            .filter((item) => {
                                if (item.userId !== uid) return false;
                                if (!startTimestamp || !endTimestamp) return true;
                                const startedAt = toDateSafe(item.startTime);
                                return Boolean(startedAt && startedAt >= startTimestamp && startedAt < endTimestamp);
                            });
                    }
                }

                const startIndex = (page - 1) * state.pageSize;
                const docs = (state.allRows || []).slice(startIndex, startIndex + state.pageSize);

                if (docs.length === 0) {
                    state.hasMore = false;
                    this.renderDetailScanLogRows([]);
                    this.renderDetailScanLogsPagination();
                    return;
                }

                state.loadedPages[page - 1] = docs;
                state.currentPage = page;
                state.hasMore = startIndex + state.pageSize < (state.allRows || []).length;
                this.renderDetailScanLogRows(docs);
                this.renderDetailScanLogsPagination();
            } catch (e) {
                if (e.message.includes('시작일')) {
                    alert(e.message);
                }
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">로그 로드 실패: ${e.message}</td></tr>`;
                const container = document.getElementById('detail-scan-logs-pagination');
                if (container) container.innerHTML = '';
            }
        },

        async loadQuotaHistory(page = 1, options = {}) {
            const tbody = document.getElementById('admin-quota-history-body');
            if (!tbody) return;

            const state = this.quotaHistoryState;
            const searchInput = document.getElementById('quota-history-search-input');
            const searchKeyword = normalizeCompanyName(searchInput?.value || '');
            const normalizedSearch = normalizeCompanyNameLower(searchKeyword);

            if (options.reset || state.searchKeyword !== normalizedSearch) {
                state.currentPage = 1;
                state.searchKeyword = normalizedSearch;
                state.loadedPages = [];
                state.pageCursors = [];
                state.hasMore = false;
                state.source = 'global';
                state.searchScan = null;
            }

            if (page < 1) page = 1;
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">변경 이력을 불러오는 중...</td></tr>';

            try {
                if (state.source === 'legacy') {
                    state.currentPage = page;
                    this.renderQuotaHistoryRows(state.loadedPages[page - 1] || []);
                    this.renderQuotaHistoryPagination();
                    return;
                }
                if (page <= state.loadedPages.length) {
                    state.currentPage = page;
                    this.renderQuotaHistoryRows(state.loadedPages[page - 1] || []);
                    this.renderQuotaHistoryPagination();
                    return;
                }
                if (normalizedSearch) {
                    await this.ensureQuotaHistorySearchPage(page, normalizedSearch);
                    if (state.loadedPages.length === 0 && state.searchScan?.exhausted) {
                        await this.activateLegacyQuotaHistory(normalizedSearch);
                    }
                    state.currentPage = Math.min(page, Math.max(1, state.loadedPages.length || 1));
                    this.renderQuotaHistoryRows(state.loadedPages[state.currentPage - 1] || []);
                    this.renderQuotaHistoryPagination();
                    return;
                }

                const constraints = [orderBy('createdAtMs', 'desc')];
                if (page > 1) {
                    const prevCursor = state.pageCursors[page - 2];
                    if (prevCursor === undefined || prevCursor === null) {
                        state.currentPage = Math.max(1, state.loadedPages.length);
                        this.renderQuotaHistoryRows(state.loadedPages[state.currentPage - 1] || []);
                        this.renderQuotaHistoryPagination();
                        return;
                    }
                    constraints.push(startAfter(prevCursor));
                }
                constraints.push(limit(state.pageSize));

                const snap = await getDocs(query(collection(null, 'quotaHistoryGlobal'), ...constraints));
                const docs = snap.docs.map((docSnap) => {
                    const item = docSnap.data() || {};
                    return {
                        ...item,
                        id: docSnap.id,
                        createdAtMs: Number(item.createdAtMs || toDateSafe(item.createdAt)?.getTime() || 0)
                    };
                });

                if (docs.length === 0 && page === 1) {
                    await this.activateLegacyQuotaHistory('');
                    this.renderQuotaHistoryRows(state.loadedPages[0] || []);
                    this.renderQuotaHistoryPagination();
                    return;
                }
                if (docs.length === 0) {
                    state.hasMore = false;
                    this.renderQuotaHistoryPagination();
                    return;
                }

                state.loadedPages[page - 1] = docs;
                state.pageCursors[page - 1] = docs[docs.length - 1]?.createdAtMs ?? null;
                state.currentPage = page;
                state.hasMore = docs.length === state.pageSize;
                this.renderQuotaHistoryRows(docs);
                this.renderQuotaHistoryPagination();
            } catch (e) {
                console.error(e);
                tbody.innerHTML = `<tr><td colspan="6" style="color:red;">이력 로드 실패: ${e.message}</td></tr>`;
            }
        }
    };
}
