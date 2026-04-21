export function createAdminUsersReports({
    firestore,
    formatDateKR,
    formatDateTimeKR,
    toDateSafe,
    isExpectedFirestoreFallbackError,
    encodeActionValue
}) {
    const { collection, getDocs, getDoc, query, where, orderBy, startAfter, limit, doc } = firestore;

    return {
        async loadUsers() {
            const tbody = document.getElementById('admin-user-list-body');
            const thead = document.querySelector('#admin-tab-list thead tr');
            if (thead) {
                thead.innerHTML = `
                    <th>업체명 (ID)</th>
                    <th>상태</th>
                    <th>잔여 횟수</th>
                    <th>기능 제어</th>
                `;
            }
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">로딩 중...</td></tr>';
            try {
                const q = query(collection(null, 'users'), orderBy('createdAt', 'desc'));
                const snapshot = await getDocs(q);
                tbody.innerHTML = '';
                if (snapshot.empty) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">등록된 업체가 없습니다.</td></tr>';
                    return;
                }
                snapshot.forEach((docSnap) => {
                    const user = docSnap.data();
                    if (user.role === 'admin') return;
                    const row = document.createElement('tr');
                    const userId = user.userId || user.email.split('@')[0];
                    const companyName = user.companyName || '미등록 업체';
                    const statusBadge = user.isLocked
                        ? '<span class="admin-badge badge-locked">🔒 잠김</span>'
                        : '<span class="admin-badge badge-active">✅ 활성</span>';
                    const quota = user.quota || 0;
                    row.innerHTML = `
                        <td>
                            <div class="user-link" style="cursor:pointer; color:#337ab7; font-weight:bold;" data-admin-action="view-user-detail" data-uid="${encodeActionValue(docSnap.id)}">
                                ${companyName} <span style="font-weight:normal; color:#888; font-size:12px;">(${userId})</span>
                            </div>
                        </td>
                        <td>${statusBadge}</td>
                        <td><strong style="font-size:15px;">${quota}</strong> 회</td>
                        <td>
                            <button class="admin-btn btn-quota" title="횟수 조정" data-admin-action="change-quota" data-uid="${encodeActionValue(docSnap.id)}" data-quota="${quota}">🔢 횟수</button>
                            ${user.isLocked
                                ? `<button class="admin-btn btn-unlock" title="차단 해제" data-admin-action="toggle-lock" data-uid="${encodeActionValue(docSnap.id)}" data-locked="false">🔓 해제</button>`
                                : `<button class="admin-btn btn-lock" title="접속 차단" data-admin-action="toggle-lock" data-uid="${encodeActionValue(docSnap.id)}" data-locked="true">🔒 잠금</button>`
                            }
                            <button class="admin-btn btn-delete" title="업체 삭제" data-admin-action="delete-user" data-uid="${encodeActionValue(docSnap.id)}" data-name="${encodeActionValue(companyName)}">🗑️ 삭제</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            } catch (e) {
                console.error(e);
                tbody.innerHTML = `<tr><td colspan="4" style="color:red;">로드 에러: ${e.message}</td></tr>`;
            }
        },

        async viewUserDetail(uid) {
            this.currentUserUid = uid;
            this.detailQuotaHistoryState.source = 'global';
            this.detailQuotaHistoryState.ownerUid = uid;
            this.detailScanLogsState.filterKey = '';
            this.resetPagedState(this.detailQuotaHistoryState);
            this.resetPagedState(this.detailReportsState);
            this.resetPagedState(this.detailScanLogsState);

            document.getElementById('admin-tab-list').classList.remove('active');
            document.getElementById('admin-tab-list').classList.add('hidden');

            const detailView = document.getElementById('admin-user-detail-view');
            detailView.classList.remove('hidden');
            const contentDiv = document.getElementById('user-detail-content');
            contentDiv.innerHTML = '<p>데이터 분석 중...</p>';

            try {
                const userDoc = await getDoc(doc(null, 'users', uid));
                if (!userDoc.exists()) throw new Error('유저 정보 없음');
                const userData = userDoc.data();
                const logsQ = query(collection(null, 'scan_logs'), where('userId', '==', uid), orderBy('startTime', 'desc'));
                const logsSnap = await getDocs(logsQ);
                const stats = this.calculateScanStats(logsSnap.docs);

                contentDiv.innerHTML = `
                    <div class="user-detail-header">
                        <div>
                            <h2 style="margin:0;">${userData.companyName || '업체명 없음'}</h2>
                            <div style="color:#666; margin-top:5px;">ID: ${userData.userId} | 가입: ${formatDateKR(userData.createdAt)}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:24px; font-weight:bold; color:#3A539B;">${userData.quota || 0}회</div>
                            <div style="font-size:12px; color:#888;">잔여 횟수</div>
                        </div>
                    </div>
                    <h3>📊 검사 통계</h3>
                    <div class="stat-container">
                        <div class="stat-box"><span>금일 검사</span><span class="stat-number">${stats.today}</span></div>
                        <div class="stat-box"><span>이번 달 검사</span><span class="stat-number">${stats.month}</span></div>
                        <div class="stat-box"><span>올해 검사</span><span class="stat-number">${stats.year}</span></div>
                        <div class="stat-box"><span>누적 총 검사</span><span class="stat-number">${stats.total}</span></div>
                    </div>
                    <h3>🛠️ 업체 관리</h3>
                    <div style="background:#eee; padding:15px; border-radius:8px; margin-bottom:30px;">
                        <button class="admin-btn btn-quota" data-admin-action="change-quota" data-uid="${encodeActionValue(uid)}" data-quota="${userData.quota || 0}">➕/➖ 횟수 조정</button>
                        ${userData.isLocked
                            ? `<button class="admin-btn btn-unlock" data-admin-action="toggle-lock" data-uid="${encodeActionValue(uid)}" data-locked="false">🔓 차단 해제</button>`
                            : `<button class="admin-btn btn-lock" data-admin-action="toggle-lock" data-uid="${encodeActionValue(uid)}" data-locked="true">🚫 접속 차단(잠금)</button>`
                        }
                        <button class="admin-btn btn-delete" style="float:right;" data-admin-action="delete-user" data-uid="${encodeActionValue(uid)}" data-name="${encodeActionValue(userData.companyName || '')}">⚠️ 업체 영구 삭제</button>
                    </div>
                    <h3>🕘 최근 횟수 변경 이력</h3>
                    <table class="admin-table">
                        <thead><tr><th>변경 시간</th><th>변경 수량</th><th>변경 전 → 후</th><th>사유</th><th>관리자 이메일</th></tr></thead>
                        <tbody id="detail-quota-history-body"><tr><td colspan="5" style="text-align:center; color:#888; padding:20px;">변경 이력을 불러오는 중...</td></tr></tbody>
                    </table>
                    <div id="detail-quota-history-pagination"></div>
                    <h3>📨 제출된 결과 리포트</h3>
                    <table class="admin-table">
                        <thead><tr><th>제출일시</th><th>메시지</th><th>탐지결과</th><th>상세</th></tr></thead>
                        <tbody id="detail-report-body"><tr><td colspan="4" style="text-align:center; color:#888; padding:20px;">리포트를 불러오는 중...</td></tr></tbody>
                    </table>
                    <div id="detail-report-pagination"></div>
                `;

                await this.loadUserDetailQuotaHistory(uid, 1, { reset: true });
                await this.loadUserDetailReports(uid, 1, { reset: true });
                await this.loadScanLogs(uid, null, null, 1, { reset: true });
            } catch (e) {
                console.error(e);
                contentDiv.innerHTML = `<p style="color:red;">정보 로드 실패: ${e.message}</p>`;
            }
        },

        renderDetailReports(snapshot) {
            if (snapshot.empty) return '<tr><td colspan="4" style="text-align:center;">제출된 리포트가 없습니다.</td></tr>';
            let html = '';
            snapshot.forEach(docSnap => {
                const r = docSnap.data();
                const dateStr = formatDateTimeKR(r.reportedAt);
                const threat = r.threatCount > 0 ? `<b style="color:red;">위협 ${r.threatCount}건</b>` : '<span style="color:green;">안전</span>';
                html += `<tr><td>${dateStr}</td><td>${r.message || '-'}</td><td>${threat}</td><td><button class="control-btn" style="background:#555; color:white; border:none; padding: 5px 10px; border-radius: 4px;" data-admin-action="view-report-detail" data-report-id="${encodeActionValue(docSnap.id)}">상세보기</button></td></tr>`;
            });
            return html;
        },

        renderDetailReportRows(items) {
            const tbody = document.getElementById('detail-report-body');
            if (!tbody) return;
            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">제출된 리포트가 없습니다.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map((item) => {
                const dateStr = formatDateTimeKR(item.reportedAt);
                const threat = Number(item.threatCount || 0) > 0 ? `<b style="color:red;">위협 ${item.threatCount}건</b>` : '<span style="color:green;">안전</span>';
                return `<tr><td>${dateStr}</td><td>${item.message || '-'}</td><td>${threat}</td><td><button class="control-btn" style="background:#555; color:white; border:none; padding: 5px 10px; border-radius: 4px;" data-admin-action="view-report-detail" data-report-id="${encodeActionValue(item.id)}">상세보기</button></td></tr>`;
            }).join('');
        },

        renderDetailReportsPagination() {
            this.renderPageButtons({
                containerId: 'detail-report-pagination',
                state: this.detailReportsState,
                buttonClass: 'detail-report-page-btn',
                onClick: (page) => this.loadUserDetailReports(this.currentUserUid, page)
            });
        },

        renderReportRows(items = []) {
            const tbody = document.getElementById('admin-reports-body');
            if (!tbody) return;
            if (!Array.isArray(items) || items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">전송된 기록이 없습니다.</td></tr>';
                return;
            }
            tbody.innerHTML = items.map(({ id, report }) => {
                const date = formatDateTimeKR(report.reportedAt);
                const displayName = report.agencyName || report.agencyId;
                return `<tr><td>${date}</td><td><b>${displayName}</b><br>${report.agencyName ? `<span style="font-size:11px; color:#888;">(${report.agencyId})</span>` : ''}</td><td>${report.message || '내용 없음'}</td><td>위협: <b style="color:red;">${report.threatCount}</b>건<br><span style="font-size:11px; color:#666;">${report.deviceModel || '-'}</span></td><td><button class="control-btn" data-admin-action="view-report-detail" data-report-id="${encodeActionValue(id)}">상세보기</button></td></tr>`;
            }).join('');
        },

        renderReportsPagination() {
            this.renderPageButtons({
                containerId: 'admin-reports-pagination',
                state: this.reportsState,
                buttonClass: 'admin-reports-page-btn',
                onClick: (page) => this.loadReports(page)
            });
        },

        async loadReports(page = 1, options = {}) {
            const tbody = document.getElementById('admin-reports-body');
            if (!tbody) return;
            const state = this.reportsState;
            if (options.reset) this.resetPagedState(state);
            if (page < 1) page = 1;
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">데이터 조회 중...</td></tr>';
            try {
                if (page <= state.loadedPages.length) {
                    state.currentPage = page;
                    this.renderReportRows(state.loadedPages[page - 1] || []);
                    this.renderReportsPagination();
                    return;
                }
                const constraints = [orderBy('reportedAt', 'desc')];
                if (page > 1) {
                    const prevCursor = state.pageCursors[page - 2];
                    if (!prevCursor) {
                        state.currentPage = Math.max(1, state.loadedPages.length);
                        this.renderReportRows(state.loadedPages[state.currentPage - 1] || []);
                        this.renderReportsPagination();
                        return;
                    }
                    constraints.push(startAfter(prevCursor));
                }
                constraints.push(limit(state.pageSize));
                const querySnapshot = await getDocs(query(collection(null, 'reported_logs'), ...constraints));
                const docs = querySnapshot.docs.map((docSnap) => ({ id: docSnap.id, report: docSnap.data() || {} }));
                if (docs.length === 0) {
                    state.hasMore = false;
                    if (page === 1) this.renderReportRows([]);
                    this.renderReportsPagination();
                    return;
                }
                state.loadedPages[page - 1] = docs;
                state.pageCursors[page - 1] = toDateSafe(docs[docs.length - 1]?.report?.reportedAt);
                state.currentPage = page;
                state.hasMore = docs.length === state.pageSize;
                this.renderReportRows(docs);
                this.renderReportsPagination();
            } catch (error) {
                console.error(error);
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로드 실패: ${error.message}</td></tr>`;
                document.getElementById('admin-reports-pagination').innerHTML = '';
            }
        },

        async loadUserDetailReports(uid, page = 1, options = {}) {
            const tbody = document.getElementById('detail-report-body');
            if (!tbody || !uid) return;
            const state = this.detailReportsState;
            if (options.reset || state.ownerUid !== uid) {
                this.resetPagedState(state);
                state.ownerUid = uid;
            }
            if (page < 1) page = 1;
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888; padding:20px;">리포트를 불러오는 중...</td></tr>';
            try {
                if (page <= state.loadedPages.length) {
                    state.currentPage = page;
                    this.renderDetailReportRows(state.loadedPages[page - 1] || []);
                    this.renderDetailReportsPagination();
                    return;
                }
                if (!Array.isArray(state.allRows)) {
                    try {
                        const snap = await getDocs(query(collection(null, 'reported_logs'), where('agencyId', '==', uid), orderBy('reportedAt', 'desc')));
                        state.allRows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
                    } catch (queryError) {
                        if (!isExpectedFirestoreFallbackError(queryError)) console.warn('detail reported_logs load fallback:', queryError);
                        const fallbackSnap = await getDocs(query(collection(null, 'reported_logs'), orderBy('reportedAt', 'desc')));
                        state.allRows = fallbackSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) })).filter((item) => item.agencyId === uid);
                    }
                }
                const startIndex = (page - 1) * state.pageSize;
                const docs = (state.allRows || []).slice(startIndex, startIndex + state.pageSize);
                if (docs.length === 0) {
                    state.hasMore = false;
                    if (page === 1) this.renderDetailReportRows([]);
                    this.renderDetailReportsPagination();
                    return;
                }
                state.loadedPages[page - 1] = docs;
                state.currentPage = page;
                state.hasMore = startIndex + state.pageSize < (state.allRows || []).length;
                this.renderDetailReportRows(docs);
                this.renderDetailReportsPagination();
            } catch (e) {
                console.error(e);
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red; padding:20px;">리포트 로드 실패: ${e.message}</td></tr>`;
                const container = document.getElementById('detail-report-pagination');
                if (container) container.innerHTML = '';
            }
        }
    };
}
