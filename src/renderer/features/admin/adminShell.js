export function createAdminShell({
    State,
    ViewManager,
    CustomUI,
    services,
    constants,
    authService,
    firestore,
    buildQuotaHistoryGlobalEntry
}) {
    const { ID_DOMAIN } = constants;
    const {
        doc,
        setDoc,
        collection,
        addDoc,
        serverTimestamp
    } = firestore;

    return {
        init() {
            console.log('🚀 AdminManager.init() 시작됨!');

            const loggedInContainer = document.getElementById('logged-in-view');
            const navMenu = loggedInContainer?.querySelector('.nav-menu');

            if (!navMenu) return console.error('❌ nav-menu 없음');
            if (loggedInContainer.querySelector('#nav-admin')) return;

            const li = document.createElement('li');
            li.className = 'nav-item';
            li.id = 'nav-admin';
            li.innerHTML = '🛡️ 관리자 페이지';
            li.style.color = '#F0AD4E';
            li.style.fontWeight = 'bold';

            li.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
                li.classList.add('active');

                ViewManager.showScreen(document.getElementById('logged-in-view'), 'admin-screen');
                this.switchTab('admin-tab-register');
            });
            navMenu.insertBefore(li, navMenu.firstChild);

            const tabContainer = document.querySelector('.admin-tabs');
            if (tabContainer && !document.querySelector('.admin-tab-btn[data-target="admin-tab-abnormal"]')) {
                const abBtn = document.createElement('button');
                abBtn.className = 'admin-tab-btn';
                abBtn.id = 'btn-abnormal-logs';
                abBtn.dataset.target = 'admin-tab-abnormal';
                abBtn.innerText = '⚠️ 비정상 로그';
                tabContainer.appendChild(abBtn);
            }
            if (tabContainer && !document.querySelector('.admin-tab-btn[data-target="admin-tab-quota-history"]')) {
                const quotaBtn = document.createElement('button');
                quotaBtn.className = 'admin-tab-btn';
                quotaBtn.id = 'btn-quota-history';
                quotaBtn.dataset.target = 'admin-tab-quota-history';
                quotaBtn.innerText = '🕘 횟수 변경 이력';
                tabContainer.appendChild(quotaBtn);
            }

            document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
                if (btn.dataset.boundClick !== 'true') {
                    btn.dataset.boundClick = 'true';
                    btn.addEventListener('click', () => this.switchTab(btn.dataset.target));
                }
            });

            const createUserForm = document.getElementById('admin-create-user-form');
            if (createUserForm && createUserForm.dataset.boundSubmit !== 'true') {
                createUserForm.dataset.boundSubmit = 'true';
                createUserForm.addEventListener('submit', (e) => this.createUser(e));
            }

            const refreshBtn = document.getElementById('refresh-users-btn');
            if (refreshBtn && refreshBtn.dataset.boundClick !== 'true') {
                refreshBtn.dataset.boundClick = 'true';
                refreshBtn.addEventListener('click', () => this.loadUsers());
            }

            const refreshQuotaHistoryBtn = document.getElementById('refresh-quota-history-btn');
            if (refreshQuotaHistoryBtn && refreshQuotaHistoryBtn.dataset.boundClick !== 'true') {
                refreshQuotaHistoryBtn.dataset.boundClick = 'true';
                refreshQuotaHistoryBtn.addEventListener('click', () => this.loadQuotaHistory(1, { reset: true }));
            }

            const refreshReportsBtn = document.getElementById('refresh-reports-btn');
            if (refreshReportsBtn && refreshReportsBtn.dataset.boundClick !== 'true') {
                refreshReportsBtn.dataset.boundClick = 'true';
                refreshReportsBtn.addEventListener('click', () => this.loadReports(1, { reset: true }));
            }

            const quotaHistorySearchInput = document.getElementById('quota-history-search-input');
            const quotaHistorySearchBtn = document.getElementById('quota-history-search-btn');
            if (quotaHistorySearchBtn && quotaHistorySearchBtn.dataset.boundClick !== 'true') {
                quotaHistorySearchBtn.dataset.boundClick = 'true';
                quotaHistorySearchBtn.addEventListener('click', () => this.loadQuotaHistory(1, { reset: true }));
            }
            if (quotaHistorySearchInput && quotaHistorySearchInput.dataset.boundKeydown !== 'true') {
                quotaHistorySearchInput.dataset.boundKeydown = 'true';
                quotaHistorySearchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.loadQuotaHistory(1, { reset: true });
                    }
                });
            }

            const roleSelect = document.getElementById('user-role-select');
            if (roleSelect && roleSelect.dataset.boundChange !== 'true') {
                roleSelect.dataset.boundChange = 'true';
                roleSelect.addEventListener('change', () => this.updateCreateUserFormByRole());
            }
            this.updateCreateUserFormByRole();

            this.createDetailViewContainer();
        },

        updateCreateUserFormByRole() {
            const roleSelect = document.getElementById('user-role-select');
            const quotaRow = document.getElementById('new-user-quota-row');
            const quotaReasonRow = document.getElementById('new-user-quota-reason-row');
            const quotaInput = document.getElementById('new-user-quota');
            const quotaReasonInput = document.getElementById('new-user-quota-reason');

            const role = roleSelect?.value || 'user';
            const isAdmin = role === 'admin';

            if (quotaRow) quotaRow.style.display = isAdmin ? 'none' : '';
            if (quotaReasonRow) quotaReasonRow.style.display = isAdmin ? 'none' : '';

            if (quotaInput) {
                if (isAdmin) {
                    quotaInput.dataset.prevValue = quotaInput.value;
                    quotaInput.value = 0;
                } else if (quotaInput.value === '' && quotaInput.dataset.prevValue) {
                    quotaInput.value = quotaInput.dataset.prevValue;
                }
            }

            if (quotaReasonInput) {
                if (isAdmin) {
                    quotaReasonInput.dataset.prevValue = quotaReasonInput.value;
                    quotaReasonInput.value = '';
                } else if (!quotaReasonInput.value && quotaReasonInput.dataset.prevValue) {
                    quotaReasonInput.value = quotaReasonInput.dataset.prevValue;
                }
            }
        },

        createDetailViewContainer() {
            if (document.getElementById('admin-user-detail-view')) return;

            const screen = document.getElementById('admin-screen');
            if (!screen) return;

            const detailDiv = document.createElement('div');
            detailDiv.id = 'admin-user-detail-view';
            detailDiv.className = 'hidden';
            detailDiv.style.background = '#fff';
            detailDiv.style.padding = '20px';
            detailDiv.style.height = '100%';
            detailDiv.style.overflowY = 'auto';

            detailDiv.innerHTML = `
                <button id="detail-back-btn" class="admin-btn" style="background:#666; margin-bottom:15px;">⬅️ 목록으로 돌아가기</button>
                <div id="user-detail-content"></div>
                
                <h3 style="margin-top: 30px;">📅 검사 기록 조회</h3>
                <div style="display: flex; gap: 10px; margin-bottom: 20px; align-items: center;">
                    <label for="log-date-start" style="font-weight: 500;">기간 선택:</label>
                    <input type="date" id="log-date-start" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 150px;">
                    <span>~</span>
                    <input type="date" id="log-date-end" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 150px;">
                    <button id="filter-logs-btn" class="admin-btn btn-quota">조회</button>
                    <button id="reset-logs-btn" class="admin-btn secondary-button">전체 보기</button>
                </div>
                
                <table class="admin-table" style="table-layout:fixed; width:100%;">
                    <colgroup>
                        <col style="width:24%;">
                        <col style="width:12%;">
                        <col style="width:12%;">
                        <col style="width:12%;">
                        <col style="width:40%;">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>검사 일시 (시작)</th>
                            <th>기기</th>
                            <th>상태</th>
                            <th>소요 시간</th>
                            <th>에러 메시지</th>
                        </tr>
                    </thead>
                    <tbody id="user-scan-logs-body"></tbody>
                </table>
                <div id="detail-scan-logs-pagination"></div>
            `;
            screen.appendChild(detailDiv);

            document.getElementById('detail-back-btn')?.addEventListener('click', () => {
                document.getElementById('admin-user-detail-view')?.classList.add('hidden');
                const logStart = document.getElementById('log-date-start');
                const logEnd = document.getElementById('log-date-end');
                if (logStart) logStart.value = '';
                if (logEnd) logEnd.value = '';

                const listTab = document.getElementById('admin-tab-list');
                listTab?.classList.remove('hidden');
                listTab?.classList.add('active');

                this.currentUserUid = null;
                this.loadUsers();
            });

            const filterLogsBtn = document.getElementById('filter-logs-btn');
            if (filterLogsBtn && filterLogsBtn.dataset.boundClick !== 'true') {
                filterLogsBtn.dataset.boundClick = 'true';
                filterLogsBtn.addEventListener('click', () => {
                    const startDate = document.getElementById('log-date-start')?.value || null;
                    const endDate = document.getElementById('log-date-end')?.value || null;
                    this.loadScanLogs(this.currentUserUid, startDate, endDate, 1, { reset: true });
                });
            }

            const resetLogsBtn = document.getElementById('reset-logs-btn');
            if (resetLogsBtn && resetLogsBtn.dataset.boundClick !== 'true') {
                resetLogsBtn.dataset.boundClick = 'true';
                resetLogsBtn.addEventListener('click', () => {
                    const logStart = document.getElementById('log-date-start');
                    const logEnd = document.getElementById('log-date-end');
                    if (logStart) logStart.value = '';
                    if (logEnd) logEnd.value = '';
                    this.loadScanLogs(this.currentUserUid, null, null, 1, { reset: true });
                });
            }
        },

        switchTab(tabId) {
            const detailView = document.getElementById('admin-user-detail-view');
            if (detailView) detailView.classList.add('hidden');
            this.currentUserUid = null;

            document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
                if (btn.dataset.target === tabId) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            document.querySelectorAll('.admin-tab-content').forEach((content) => {
                content.classList.remove('active');
                if (content.id === tabId) {
                    content.classList.remove('hidden');
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                    content.classList.add('hidden');
                }
            });

            if (tabId === 'admin-tab-abnormal') this.loadAbnormalLogs(1, { reset: true });
            if (tabId === 'admin-tab-quota-history') this.loadQuotaHistory(1, { reset: true });
            if (tabId === 'admin-tab-list') this.loadUsers();
            if (tabId === 'admin-tab-reports') this.loadReports(1, { reset: true });
        },

        async createUser(e) {
            e.preventDefault();

            const nameInput = document.getElementById('new-user-name');
            const idInput = document.getElementById('new-user-id');
            const pwdInput = document.getElementById('new-user-pwd');
            const quotaInput = document.getElementById('new-user-quota');
            const quotaReasonInput = document.getElementById('new-user-quota-reason');
            const roleSelect = document.getElementById('user-role-select');

            const companyName = nameInput.value.trim();
            const inputId = idInput.value.trim();
            const password = pwdInput.value;
            const selectedRole = roleSelect.value;

            let quota = parseInt(quotaInput?.value, 10);
            if (isNaN(quota)) quota = 0;
            if (selectedRole === 'admin') quota = 0;

            const quotaReason = selectedRole === 'admin'
                ? ''
                : (quotaReasonInput?.value || '').trim();

            if (selectedRole !== 'admin' && quota > 0 && !quotaReason) {
                await CustomUI.alert('초기 지급 사유를 입력해주세요.');
                quotaReasonInput?.focus?.();
                return;
            }

            const fullEmail = inputId + ID_DOMAIN;

            const roleText = roleSelect.options[roleSelect.selectedIndex]?.text || selectedRole;
            const confirmLines = [
                '[생성 확인]',
                '',
                `업체명: ${companyName}`,
                `ID: ${inputId}`,
                `유형: ${roleText}`,
                `기본 횟수: ${quota}회`
            ];
            if (selectedRole !== 'admin' && quota > 0) {
                confirmLines.push(`초기 지급 사유: ${quotaReason || '업체 등록 초기 지급'}`);
            }
            if (!await CustomUI.confirm(confirmLines.join('\n'))) return;

            try {
                const created = await services.auth.createUser(fullEmail, password);
                const newUid = created?.uid;
                if (!newUid) throw new Error('계정 생성에 실패했습니다(uid 없음)');

                await setDoc(doc(null, 'users', newUid), {
                    companyName,
                    userId: inputId,
                    email: fullEmail,
                    role: selectedRole,
                    isLocked: false,
                    quota,
                    android_scan_duration: 0,
                    createdAt: serverTimestamp(),
                    lastScanDate: null
                });

                if (selectedRole !== 'admin' && quota !== 0) {
                    const actor = authService?.getCurrentUser?.() || null;
                    const historyEntry = buildQuotaHistoryGlobalEntry({
                        uid: newUid,
                        companyName,
                        userId: inputId,
                        change: quota,
                        beforeQuota: 0,
                        afterQuota: quota,
                        reason: quotaReason || '업체 등록 초기 지급',
                        actorUid: actor?.uid || null,
                        actorEmail: actor?.email || 'unknown',
                        actionType: 'create'
                    });

                    await addDoc(collection(null, 'users', newUid, 'quotaHistory'), historyEntry);
                    await addDoc(collection(null, 'quotaHistoryGlobal'), historyEntry);
                }

                await CustomUI.alert(`✅ 생성 완료!\n업체명: ${companyName}\n아이디: ${inputId}`);

                document.getElementById('admin-create-user-form')?.reset();
                if (quotaInput) quotaInput.value = 0;
                if (quotaReasonInput) quotaReasonInput.value = '';
                this.updateCreateUserFormByRole();
                this.loadUsers();
            } catch (error) {
                console.error(error);
                await CustomUI.alert('생성 실패: ' + (error?.message || error));
            }
        }
    };
}
