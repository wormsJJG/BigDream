// Auto-split module: authSettings

import { checkUserRole as checkUserRoleService, fetchUserInfoAndSettings as fetchUserInfoAndSettingsService } from '../services/userSettingsService.js';

export function initAuthSettings(ctx) {
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    // Role-separated deps
    // - auth: IPC 기반 authService (firebase SDK 직접 사용 금지)
    // - firestore: IPC 기반 firestoreProxy wrapper
    const authService = services.auth;
    const firestore = services.firestore;
    const { doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where, runTransaction, addDoc, serverTimestamp, deleteDoc, increment, limit } = firestore;

    // [3] 인증 및 설정 불러오기 (AUTH & SETTINGS)
    // =========================================================

    // --- Service wrappers: UI 모듈에서 DB 로직 분리 ---
    async function checkUserRole(uid) {
        return await checkUserRoleService(services, uid);
    }

    async function fetchUserInfoAndSettings(uidOverride) {
        const result = await fetchUserInfoAndSettingsService(services, constants, uidOverride);
        if (!result) return;
        State.androidTargetMinutes = result.androidTargetMinutes || 0;
        State.agencyName = result.agencyName || '업체명 없음';
        State.quota = (result.quota !== undefined) ? result.quota : 0;
    }

    function isAdminRole(role) {
        // 관리자만 '무제한/관리자 페이지' 권한을 가짐
        return role === 'admin';
    }

    //회사 정보 UI 업데이트 함수
    function updateAgencyDisplay() {
        const nameEl = document.getElementById('agency-name');
        const quotaEl = document.getElementById('agency-quota');

        if (nameEl && quotaEl) {
            // 관리자 계정은 쿼터 무제한으로 표시
            const isAdmin = isAdminRole(State.userRole);
            if (isAdmin) {
                nameEl.textContent = `(주) 관리자 계정`;
                quotaEl.textContent = `남은 횟수 : 무제한`;
                quotaEl.style.color = 'var(--warning-color)';
            } else {
                nameEl.textContent = State.agencyName;
                quotaEl.textContent = `남은 횟수 : ${State.quota} 회`;

                // 쿼터 경고 색상 설정
                if (State.quota === 0) {
                    quotaEl.style.color = 'var(--danger-color)';
                } else if (State.quota < 10) {
                    quotaEl.style.color = 'var(--warning-color)';
                } else {
                    quotaEl.style.color = 'var(--text-color)';
                }
            }
        }
    }

    // 다른 모듈(예: scanController)에서 회사/쿼터 UI를 갱신할 수 있도록 helper로 노출
    // - 전역 함수 의존을 제거하고, 모듈 분리 이후에도 기능이 깨지지 않게 하기 위함
    ctx.helpers = ctx.helpers || {};
    ctx.helpers.updateAgencyDisplay = updateAgencyDisplay;

    // 로그인 전 사이드바(nav-login/nav-support) 이벤트 바인딩
    if (ctx.helpers && typeof ctx.helpers.setupLoggedOutNav === 'function') {
        ctx.helpers.setupLoggedOutNav();
    }

    // 로그인 처리
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginBtn = loginForm.querySelector('.primary-button');
            const loginLoader = document.getElementById('login-loader');
            const usernameEl = document.getElementById('username');
            const passwordEl = document.getElementById('password');
            const sidebar = document.querySelector('#logged-out-view .sidebar');

            const inputId = usernameEl.value.trim();
            const email = inputId + ID_DOMAIN;
            const password = passwordEl.value.trim();
            const errorMsg = document.getElementById('login-error');
            const remember = document.getElementById('remember-me').checked;

            const loginData = { id: inputId, pw: password, remember: remember };

            errorMsg.textContent = "로그인 중...";

            // --- 로딩 시작 상태로 전환 ---
            loginBtn.style.display = 'none';
            loginLoader.style.display = 'flex';
            errorMsg.textContent = "";

            // --- 클릭 차단 ---
            usernameEl.disabled = true;
            passwordEl.disabled = true;
            if (sidebar) sidebar.classList.add('ui-lock');

            try {
                // 1) Auth (Main IPC) 로그인
                const user = await authService.login(email, password);

                // 2. 권한 확인 (DB 조회)
                // - DB에 'User', 'USER ', 'admin ' 등으로 저장된 케이스를 방지하기 위해 정규화
                const roleRaw = await checkUserRole(user.uid);
                const role = String(roleRaw || '').trim().toLowerCase();
                await window.electronAPI.saveLoginInfo(loginData)
                console.log(`로그인 성공! UID: ${user.uid}, Role: ${role}`);

                // 3. 설정값 불러오기
                await fetchUserInfoAndSettings(user.uid);

                // 4. 화면 전환 분기 처리
                State.isLoggedIn = true;
                State.userRole = role;

                const isAdmin = isAdminRole(role);

                // 로그인 직후 '검사 생성' 화면의 헤더(업체명/남은횟수)가 갱신되지 않는 버그 방지:
                // - create-scan-screen(view.html)에 기본값이 박혀있어도, 여기서 즉시 State 기반으로 바인딩
                ViewManager.showView('logged-in-view');
                ViewManager.showScreen(loggedInView, 'create-scan-screen');
                updateAgencyDisplay();

                if (isAdmin) {
                    document.body.classList.add('is-admin');
                    await CustomUI.alert(`관리자 계정으로 접속했습니다.`);
                    setTimeout(() => {
                        AdminManager.init();
                    }, 500);
                } else {
                    document.body.classList.remove('is-admin');
                }

                document.getElementById('nav-create').classList.add('active');
                errorMsg.textContent = "";

            } catch (error) {
                console.error(error);
                if (error.message === "LOCKED_ACCOUNT") {
                    errorMsg.textContent = "🚫 관리자에 의해 이용이 정지된 계정입니다. \n(문의: 031-778-8810)";
                    await authService.logout();
                    return;
                }

                // 기존 에러 처리
                if (error.code === 'auth/invalid-credential') {
                    errorMsg.textContent = "아이디 또는 비밀번호가 잘못되었습니다.";
                } else {
                    errorMsg.textContent = "로그인 오류: " + error.code;
                }
            }

            finally {
                loginLoader.style.display = 'none';
                loginBtn.style.display = 'block';

                usernameEl.disabled = false;
                passwordEl.disabled = false;
                if (sidebar) sidebar.classList.remove('ui-lock');
            }
        });
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (await CustomUI.confirm('로그아웃 하시겠습니까?')) {
                try {
                    await authService.logout();
                    ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);
                    State.isLoggedIn = false;
                    State.androidTargetMinutes = 0;
                    State.agencyName = 'BD SCANNER';
                    State.quota = -1;

                    ViewManager.showView('logged-out-view');
                    ViewManager.showScreen(loggedOutView, 'login-screen');
                    window.location.reload();
                } catch (error) {
                    alert("로그아웃 실패: " + error.message);
                }
                const privacyNotice = document.getElementById('privacy-footer-notice');
                if (privacyNotice) privacyNotice.style.display = 'none';

                window.location.reload();
            }
        });
    }

    document.querySelectorAll('.res-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.target;

            document.querySelectorAll('.nav-item, .res-tab').forEach(item => {
                item.classList.remove('active');
            });
            tab.classList.add('active');

            // 2. 다른 특수 화면들(관리자, 상세뷰 등)을 확실히 숨김
            const screensToHide = [
                'admin-screen',
                'admin-report-detail-screen',
                'app-detail-view',
                'create-scan-screen',
                'open-scan-screen'
            ];
            screensToHide.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.classList.add('hidden');
                    el.style.display = 'none';
                }
            });

            
            // ✅ 상세보기(app-detail)에서 바로 탭 이동 시:
            // AppDetailManager.show()가 results-dashboard-view/results-header를 display:none으로 숨기므로,
            // 탭 전환 시 결과 컨테이너를 반드시 복구해야 "오른쪽 화면 공백"이 발생하지 않습니다.
            const resultsDash = document.getElementById('results-dashboard-view');
            if (resultsDash) {
                resultsDash.classList.remove('hidden');
                resultsDash.style.display = 'block';
            }
            const resultsHeader2 = document.querySelector('.results-header');
            if (resultsHeader2) resultsHeader2.style.display = 'flex';
            const privacyNotice2 = document.getElementById('privacy-footer-notice');
            if (privacyNotice2) privacyNotice2.style.display = 'block';
// 3. 화면 전환 로직 분기
            if (targetId === 'scan-dashboard-screen') {
                // [Case A] 대시보드 탭 클릭
                const resultsScreen = document.getElementById('scan-results-screen');
                if (resultsScreen) {
                    resultsScreen.classList.add('hidden');
                    resultsScreen.style.display = 'none';
                }

                // 대시보드 화면 표시
                ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');

                // 실시간 데이터 폴링 재개
                if (ctx.controllers?.scanController?.startAndroidDashboardPolling) {
                    ctx.controllers.scanController.startAndroidDashboardPolling();
                }
            }
            else {
                // [Case B] 일반 결과 탭(요약, 앱목록 등) 클릭
                const dashboardScreen = document.getElementById('scan-dashboard-screen');
                if (dashboardScreen) {
                    dashboardScreen.classList.add('hidden');
                    dashboardScreen.style.display = 'none';
                }

                // 결과 메인 화면 표시
                ViewManager.showScreen(loggedInView, 'scan-results-screen');

                document.querySelectorAll('.result-content-section').forEach(section => {
                    if (section.id === targetId) {
                        section.style.display = 'block';
                        section.classList.add('active');
                    } else {
                        section.style.display = 'none';
                        section.classList.remove('active');
                    }
                });

                // ✅ 탭 전환 시 스크롤 위치를 맨 위로 (main-content는 내부 스크롤 컨테이너)
                const mainContent = document.querySelector('.main-content');
                if (mainContent) mainContent.scrollTop = 0;
                const resultsView = document.getElementById('results-dashboard-view');
                if (resultsView) { resultsView.scrollTop = 0; resultsView.scrollLeft = 0; }

                const privacyNotice = document.getElementById('privacy-footer-notice');
                if (privacyNotice) {
                    privacyNotice.style.display = 'block';
                }
                console.log(`[Tab Switch] ${targetId} 전환 성공`);

                if (String(targetId || '').startsWith('res-ios-') && typeof window.__bd_forceRenderIosCoreAreas === 'function') {
                    window.__bd_forceRenderIosCoreAreas();
                }
            };
        });
    })

    // 사이드바: 검사 생성
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            ViewManager.activateMenu('nav-create');
            // showScreen이 이제 admin-screen을 자동으로 숨겨줍니다.
            ViewManager.showScreen(loggedInView, 'create-scan-screen');
            ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);
        });
    }

    // 사이드바: 검사 열기
    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            ViewManager.activateMenu('nav-open');
            ViewManager.showScreen(loggedInView, 'open-scan-screen');
            ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);
        });
    }

    // 사이드바: 안드로이드 대시보드 (Android 전용)
    const navAndroidDash = document.getElementById('nav-android-dashboard');
    if (navAndroidDash) {
        navAndroidDash.addEventListener('click', () => {
            ViewManager.activateMenu('nav-android-dashboard');
            ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');
            // 대시보드는 계속 실시간 갱신 (scanController 내부 polling 사용)
            if (ctx.controllers?.scanController?.startAndroidDashboardPolling) {
                ctx.controllers.scanController.startAndroidDashboardPolling();
            }
        });
    }

    // 사이드바: 검사 정보 (Android "검사 열기" 전용)
    const navScanInfo = document.getElementById('nav-scan-info');
    if (navScanInfo) {
        navScanInfo.addEventListener('click', () => {
            ViewManager.activateMenu('nav-scan-info');
            ViewManager.showScreen(loggedInView, 'scan-info-screen');

            try {
                if (typeof window.__bd_renderScanInfo === 'function') {
                    window.__bd_renderScanInfo(State.lastScanData, State.lastScanFileMeta);
                }
            } catch (e) {
                console.warn('[BD-Scanner] scan-info render failed:', e);
            }

            // [Patch] '검사 열기'에서 결과 탭은 유지하고, 실시간 대시보드는 숨김
            // - Android: result-sub-menu 유지
            // - iOS: ios-sub-menu 유지
            try {
                const subMenu = document.getElementById('result-sub-menu');
                const iosSub = document.getElementById('ios-sub-menu');
                const dash = document.getElementById('nav-android-dashboard');
                const navResult = document.getElementById('nav-result');
                const navCreate = document.getElementById('nav-create');
                const navOpen = document.getElementById('nav-open');

                const mode = String(State.currentDeviceMode || '').toLowerCase();

                if (navCreate) { navCreate.classList.add('hidden'); navCreate.style.display = 'none'; }
                if (navOpen) { navOpen.classList.add('hidden'); navOpen.style.display = 'none'; }
                if (navResult) { navResult.classList.remove('hidden'); navResult.style.display = 'block'; }

                if (mode === 'ios') {
                    // iOS 결과 파일을 '검사 열기'로 보는 경우: iOS 탭 유지
                    if (subMenu) { subMenu.classList.add('hidden'); subMenu.style.display = 'none'; }
                    if (iosSub) { iosSub.classList.remove('hidden'); iosSub.style.display = 'block'; }
                } else {
                    // Android 결과 파일을 '검사 열기'로 보는 경우: Android 탭 유지
                    if (subMenu) { subMenu.classList.remove('hidden'); subMenu.style.display = 'block'; }
                    if (iosSub) { iosSub.classList.add('hidden'); iosSub.style.display = 'none'; }
                }

                if (dash) { dash.classList.add('hidden'); dash.style.display = 'none'; }
            } catch (_e) { }

            // Fill info from loaded scan data
            try {
                const data = window.lastScanData || State.lastScanData || {};
                const deviceInfo = data.deviceInfo || {};

                const pick = (...candidates) => {
                    for (const v of candidates) {
                        if (v === null || v === undefined) continue;
                        const s = String(v).trim();
                        if (!s) continue;

                        // 익명/placeholder 값은 표시에서 '-'로 처리
                        if (s.includes('익명')) return '-';
                        if (s === '000-0000-0000' || s === '0000-00-00' || s === '0001-01-01') return '-';

                        return s;
                    }
                    return '-';
                };

                // Examiner/client info (best-effort, supports multiple legacy schemas)
                const examinerName = pick(
                    data.meta?.targetName,
                    data.meta?.targetUserName,
                    data.meta?.subjectName,
                    data.meta?.personName,
                    data.meta?.clientName,
                    data.targetInfo?.name,
                    data.target?.name,
                    data.subject?.name,
                    data.clientInfo?.name,
                    data.client?.name,
                    data.clientName,
                    data.examinerName,
                    data.examiner?.name,
                    data.meta?.examinerName
                );
                const examinerPhone = pick(
                    data.meta?.targetPhone,
                    data.meta?.targetMobile,
                    data.meta?.subjectPhone,
                    data.meta?.subjectMobile,
                    data.meta?.personPhone,
                    data.meta?.clientPhone,
                    data.targetInfo?.phone,
                    data.targetInfo?.mobile,
                    data.target?.phone,
                    data.target?.mobile,
                    data.subject?.phone,
                    data.subject?.mobile,
                    data.clientInfo?.phone,
                    data.client?.phone,
                    data.clientPhone,
                    data.examinerPhone,
                    data.examiner?.phone,
                    data.meta?.examinerPhone
                );

                const model = pick(deviceInfo.model);
                const os = pick(deviceInfo.os, deviceInfo.osVersion, deviceInfo.version);
                const serial = pick(deviceInfo.serial);
                const root = (typeof deviceInfo.isRooted === 'boolean')
                    ? (deviceInfo.isRooted ? '발견됨 (위험)' : '안전함')
                    : pick(deviceInfo.root, deviceInfo.rootStatus, deviceInfo.isRooted);

                const setText = (id, value) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = value;
                };

                setText('scan-info-examiner-name', examinerName);
                setText('scan-info-examiner-phone', examinerPhone);
                setText('scan-info-model', model);
                setText('scan-info-os', os);
                setText('scan-info-serial', serial);
                setText('scan-info-root', root);
            } catch (e) {
                console.warn('scan-info render failed:', e);
            }
        });
    }

    // 다른 모듈에서 대시보드 메뉴를 켜고 끌 수 있도록 helper 제공
    ctx.helpers = ctx.helpers || {};
    ctx.helpers.setAndroidDashboardNavVisible = (visible) => {
        const el = document.getElementById('nav-android-dashboard');
        if (!el) return;
        el.style.display = visible ? 'block' : 'none';
        el.classList.toggle('hidden', !visible);
    };

    ctx.helpers.setScanInfoNavVisible = (visible) => {
        const el = document.getElementById('nav-scan-info');
        if (!el) return;
        el.style.display = visible ? 'block' : 'none';
        el.classList.toggle('hidden', !visible);
    };

    // 사이드바: 아이폰 전용 결과 보고서 복귀 메뉴
    const navResultBtn = document.getElementById('nav-result');
    if (navResultBtn) {
        navResultBtn.addEventListener('click', () => {
            if (window.lastScanData) {
                ViewManager.activateMenu('nav-result');
                ViewManager.showScreen(loggedInView, 'scan-results-screen');
                
                // ✅ 상세보기에서 바로 '검사 결과'로 돌아올 때도 결과 컨테이너 복구
                const resultsDash = document.getElementById('results-dashboard-view');
                if (resultsDash) {
                    resultsDash.classList.remove('hidden');
                    resultsDash.style.display = 'block';
                }
                const resultsHeader2 = document.querySelector('.results-header');
                if (resultsHeader2) resultsHeader2.style.display = 'flex';
                const privacyNotice2 = document.getElementById('privacy-footer-notice');
                if (privacyNotice2) privacyNotice2.style.display = 'block';

                ResultsRenderer.render(window.lastScanData);
            } else {
                CustomUI.alert("표시할 검사 결과 데이터가 없습니다.");
            }
        });
    }

    // =========================================================
}
