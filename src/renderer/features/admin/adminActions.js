import { getScreenTemplateCandidates } from '../../app/screenPaths.js';

export function createAdminActionHandlers({
    AdminManager,
    ViewManager,
    CustomUI,
    authService,
    firestore,
    formatDateTimeKR,
    buildQuotaHistoryGlobalEntry
}) {
    const {
        doc,
        getDoc,
        updateDoc,
        addDoc,
        collection,
        deleteDoc
    } = firestore;

    const handleViewReportDetail = async (reportId) => {
        try {
            document.querySelectorAll('#logged-in-view .nav-item').forEach(item => item.classList.remove('active'));
            const navAdmin = document.getElementById('nav-admin');
            if (navAdmin) navAdmin.classList.add('active');
        } catch (_e) { }

        const loggedInView = document.getElementById('logged-in-view');
        const detailScreen = document.getElementById('admin-report-detail-screen');
        if (!loggedInView || !detailScreen) return;

        const waitFrame = () => new Promise(r => requestAnimationFrame(r));

        const ensureDetailTemplateLoaded = async () => {
            if (detailScreen.innerHTML && detailScreen.innerHTML.trim().length > 0) return;
            try {
                if (window?.bdScanner?.app?.readTextFile) {
                    for (const candidatePath of getScreenTemplateCandidates('admin-report-detail-screen')) {
                        try {
                            const html = await window.bdScanner.app.readTextFile(candidatePath);
                            if (html) {
                                detailScreen.innerHTML = html;
                                return;
                            }
                        } catch (_innerError) { }
                    }
                }
            } catch (e) {
                console.warn('[viewReportDetail] template load failed:', e);
            }
        };

        try {
            if (ViewManager?.showScreen) {
                ViewManager.showScreen(loggedInView, 'admin-report-detail-screen');
            } else {
                detailScreen.classList.remove('hidden');
                detailScreen.classList.add('active');
                detailScreen.style.display = 'block';
            }

            await ensureDetailTemplateLoaded();
            await waitFrame();
            await waitFrame();

            const docRef = doc(null, 'reported_logs', reportId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                alert('삭제된 리포트입니다.');
                return;
            }

            const data = docSnap.data();
            const dateStr = data.reportedAt ? formatDateTimeKR(data.reportedAt) : '-';

            const elDocId = document.getElementById('view-doc-id');
            const elReportTime = document.getElementById('view-report-time');
            if (elDocId) elDocId.textContent = reportId.substring(0, 8).toUpperCase();
            if (elReportTime) elReportTime.textContent = dateStr;

            const elAgencyName = document.getElementById('view-agency-name');
            const elAgencyId = document.getElementById('view-agency-id');
            const elAgencyEmail = document.getElementById('view-agency-email');
            if (elAgencyName) elAgencyName.textContent = data.agencyName || '-';
            if (elAgencyId) elAgencyId.textContent = data.agencyId || '-';
            if (elAgencyEmail) elAgencyEmail.textContent = data.agencyEmail || '-';

            const client = data.clientInfo || {};
            const elClientName = document.getElementById('view-client-name');
            const elClientPhone = document.getElementById('view-client-phone');
            const elClientDob = document.getElementById('view-client-dob');
            if (elClientName) elClientName.textContent = client.name || '익명';
            if (elClientPhone) elClientPhone.textContent = client.phone || '-';
            if (elClientDob) elClientDob.textContent = client.dob || '-';

            const device = data.deviceInfo || {};
            const elDevModel = document.getElementById('view-device-model');
            const elDevOs = document.getElementById('view-device-os');
            const elDevSerial = document.getElementById('view-device-serial');
            if (elDevModel) elDevModel.textContent = device.model || '-';
            if (elDevOs) elDevOs.textContent = (device.os || '-').toUpperCase();
            if (elDevSerial) elDevSerial.textContent = device.serial || '-';

            const elMsg = document.getElementById('view-message-text');
            if (elMsg) elMsg.textContent = data.message || '특이사항 없음';

            const apps = data.suspiciousApps || [];
            const threatListEl = document.getElementById('view-threat-list');
            const elThreatCount = document.getElementById('view-threat-count');
            if (elThreatCount) elThreatCount.textContent = apps.length;
            if (threatListEl) threatListEl.innerHTML = '';

            if (!threatListEl) {
                console.warn('[viewReportDetail] threat list element missing - template may not be loaded');
            } else if (apps.length === 0) {
                threatListEl.innerHTML = '<div style="text-align:center; padding:30px; color:#28a745; background:white; border-radius:8px;">✅ 탐지된 위협이 없습니다. (Clean Device)</div>';
            } else {
                apps.forEach((app, index) => {
                    let appName = 'Unknown App';
                    if (app.packageName) {
                        const parts = app.packageName.split('.');
                        appName = parts.length > 1 ? parts[parts.length - 1] : app.packageName;
                        appName = appName.charAt(0).toUpperCase() + appName.slice(1);
                    }

                    const permissionList = Array.isArray(app.grantedList) && app.grantedList.length > 0
                        ? app.grantedList
                        : (Array.isArray(app.requestedList) && app.requestedList.length > 0
                            ? app.requestedList
                            : (Array.isArray(app.permissions) ? app.permissions : []));

                    let permissionHtml = '';
                    if (permissionList.length > 0) {
                        permissionHtml = permissionList.map(perm => {
                            const shortPerm = String(perm || '').replace('android.permission.', '');
                            return `<span class="perm-badge granted">✔ ${shortPerm}</span>`;
                        }).join('');
                    } else {
                        permissionHtml = '<span style="font-size:11px; color:#999;">허용된 중요 권한 없음</span>';
                    }

                    const card = document.createElement('div');
                    card.className = 'threat-card';
                    card.innerHTML = `
                            <div class="threat-header">
                                <div>
                                    <span style="font-weight:bold; color:#555;">#${index + 1}</span>
                                    <span class="app-title-lg">${appName}</span>
                                    <span class="pkg-name">${app.packageName}</span>
                                    <br>
                                    <div class="threat-reason">${app.reason || '사유 불명'}</div>
                                </div>
                                <div style="text-align:right;">
                                    ${app.isSideloaded ? '<span style="background:#fff3e0; color:#e65100; font-size:11px; padding:3px 6px; border-radius:4px; font-weight:bold;">⚠️ 외부설치(Sideload)</span>' : ''}
                                    ${app.isRunningBg ? '<span style="background:#e3f2fd; color:#1565c0; font-size:11px; padding:3px 6px; border-radius:4px; font-weight:bold; margin-left:5px;">🚀 실행중</span>' : ''}
                                </div>
                            </div>

                            <div class="threat-details-grid">
                                <div class="detail-box">
                                    <label>📂 설치 경로 (APK Path)</label>
                                    <div class="path-box">${app.apkPath || '경로 정보 없음'}</div>
                                    <div style="margin-top:10px;">
                                        <label>📦 설치 관리자 (Installer)</label>
                                        <span style="font-size:12px;">${app.installer || '알 수 없음'}</span>
                                    </div>
                                </div>

                                <div class="detail-box">
                                    <label>🔑 허용된 주요 권한 (${app.grantedCount || permissionList.length || 0}개)</label>
                                    <div class="perm-container">
                                        ${permissionHtml}
                                    </div>
                                </div>
                            </div>
                        `;
                    threatListEl.appendChild(card);
                });
            }

            detailScreen.scrollTop = 0;
        } catch (e) {
            console.error('상세보기 오류:', e);
            alert('정보를 불러오는 중 오류가 발생했습니다: ' + e.message);
        }
    };

    const handleToggleLock = async (uid, shouldLock) => {
        if (!await CustomUI.confirm(shouldLock ? '🚫 이 업체의 사용을 막으시겠습니까?' : '✅ 차단을 해제하시겠습니까?')) return;
        try {
            await updateDoc(doc(null, 'users', uid), { isLocked: shouldLock });
            if (AdminManager.currentUserUid === uid) AdminManager.viewUserDetail(uid);
            else AdminManager.loadUsers();
        } catch (e) {
            await CustomUI.alert('처리 실패: ' + e.message);
        }
    };

    const handleChangeQuota = async (uid, currentQuota) => {
        console.log(`횟수 변경 클릭됨: ${uid}, 현재: ${currentQuota}`);

        if (typeof CustomUI === 'undefined') {
            alert('시스템 로딩 중입니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        const input = await CustomUI.prompt(`[횟수 조정]
현재 횟수: ${currentQuota}회

추가(+)하거나 차감(-)할 수량을 입력하세요.
(예: 10 또는 -5)`, '0');

        if (input === null) return;
        const change = parseInt(input, 10);

        if (isNaN(change)) {
            await CustomUI.alert('❌ 숫자만 입력해주세요.');
            return;
        }
        if (change === 0) return;

        const reason = await CustomUI.prompt(`[사유 입력]
${change > 0 ? '추가' : '차감'} 사유를 입력하세요.`, '');
        if (reason === null) return;

        const trimmedReason = String(reason || '').trim();
        if (!trimmedReason) {
            await CustomUI.alert('❌ 횟수 변경 사유를 입력해주세요.');
            return;
        }

        try {
            const userRef = doc(null, 'users', uid);
            const userSnap = await getDoc(userRef);
            if (!userSnap.exists()) throw new Error('업체 정보를 찾을 수 없습니다.');

            const userData = userSnap.data() || {};
            const safeCurrentQuota = Number(userData.quota ?? currentQuota ?? 0);
            const newQuota = safeCurrentQuota + change;

            if (newQuota < 0) {
                await CustomUI.alert('❌ 횟수는 0보다 작을 수 없습니다.');
                return;
            }

            await updateDoc(userRef, { quota: newQuota });

            const actor = authService?.getCurrentUser?.() || null;
            const historyEntry = buildQuotaHistoryGlobalEntry({
                uid,
                companyName: userData.companyName || '미등록 업체',
                userId: userData.userId || userData.email || uid,
                change,
                beforeQuota: safeCurrentQuota,
                afterQuota: newQuota,
                reason: trimmedReason,
                actorUid: actor?.uid || null,
                actorEmail: actor?.email || 'unknown',
                actionType: 'adjust'
            });

            await addDoc(collection(null, 'users', uid, 'quotaHistory'), historyEntry);
            await addDoc(collection(null, 'quotaHistoryGlobal'), historyEntry);

            await CustomUI.alert(`✅ 변경 완료!
${safeCurrentQuota}회 -> ${newQuota}회
사유: ${trimmedReason}`);

            if (AdminManager.currentUserUid === uid) {
                AdminManager.viewUserDetail(uid);
            } else {
                AdminManager.loadUsers();
            }

            const quotaTab = document.getElementById('admin-tab-quota-history');
            if (quotaTab && quotaTab.classList.contains('active')) {
                AdminManager.loadQuotaHistory(1, { reset: true });
            }
        } catch (e) {
            console.error(e);
            await CustomUI.alert('변경 실패: ' + e.message);
        }
    };

    const handleDeleteUser = async (uid, name) => {
        const msg = `⚠️ [삭제 경고]\n\n업체명: ${name}\n\n정말로 삭제하시겠습니까?\n삭제된 업체는 더 이상 로그인할 수 없으며, 모든 데이터가 제거됩니다.`;

        if (!await CustomUI.confirm(msg)) return;

        try {
            await deleteDoc(doc(null, 'users', uid));
            await CustomUI.alert('🗑️ 업체가 삭제되었습니다.');
            document.getElementById('admin-user-detail-view').classList.add('hidden');
            document.getElementById('admin-tab-list').classList.remove('hidden');
            AdminManager.loadUsers();
        } catch (e) {
            console.error('삭제 실패:', e);
            await CustomUI.alert('삭제 실패: ' + e.message);
        }
    };

    const bindAdminDetailBack = () => {
        document.addEventListener('click', (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('#admin-detail-back-btn') : null;
            if (!btn) return;

            const loggedInView = document.getElementById('logged-in-view');
            if (ViewManager?.showScreen && loggedInView) {
                ViewManager.showScreen(loggedInView, 'admin-screen');
            } else {
                const detailScreen = document.getElementById('admin-report-detail-screen');
                const adminScreen = document.getElementById('admin-screen');
                if (detailScreen) {
                    detailScreen.style.display = 'none';
                    detailScreen.classList.remove('active');
                }
                if (adminScreen) {
                    adminScreen.style.display = 'block';
                    adminScreen.classList.add('active');
                    adminScreen.classList.remove('hidden');
                }
            }
        });
    };

    const bindAdminActionDelegation = () => {
        document.addEventListener('click', async (ev) => {
            const actionEl = ev.target && ev.target.closest ? ev.target.closest('[data-admin-action]') : null;
            if (!actionEl) return;

            const action = actionEl.dataset.adminAction;
            const uid = decodeURIComponent(actionEl.dataset.uid || '');
            const reportId = decodeURIComponent(actionEl.dataset.reportId || '');
            const name = decodeURIComponent(actionEl.dataset.name || '');
            const quota = Number(actionEl.dataset.quota || 0);
            const shouldLock = actionEl.dataset.locked === 'true';

            if (action === 'view-user-detail' && uid) {
                await AdminManager.viewUserDetail(uid);
                return;
            }
            if (action === 'change-quota' && uid) {
                await handleChangeQuota(uid, quota);
                return;
            }
            if (action === 'toggle-lock' && uid) {
                await handleToggleLock(uid, shouldLock);
                return;
            }
            if (action === 'delete-user' && uid) {
                await handleDeleteUser(uid, name);
                return;
            }
            if (action === 'view-report-detail' && reportId) {
                await handleViewReportDetail(reportId);
            }
        });
    };

    return {
        bindAdminActionDelegation,
        bindAdminDetailBack,
        handleViewReportDetail,
        handleToggleLock,
        handleChangeQuota,
        handleDeleteUser
    };
}
