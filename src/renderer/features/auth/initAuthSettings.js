// Synced from TypeScript preview output. Source of truth: initAuthSettings.ts
import { checkUserRole as checkUserRoleService, fetchUserInfoAndSettings as fetchUserInfoAndSettingsService } from '../../../shared/services/userSettingsService.js';
export function initAuthSettings(ctx) {
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;
    const authService = services.auth;
    async function checkUserRole(uid) {
        return await checkUserRoleService(services, uid);
    }
    async function fetchUserInfoAndSettings(uidOverride) {
        const result = await fetchUserInfoAndSettingsService(services, constants, uidOverride);
        if (!result)
            return;
        State.androidTargetMinutes = result.androidTargetMinutes || 0;
        State.iosProgressMode = result.iosProgressMode || 'real';
        State.agencyName = result.agencyName || '업체명 없음';
        State.quota = (result.quota !== undefined) ? result.quota : 0;
    }
    function isAdminRole(role) {
        return role === 'admin';
    }
    function updateAgencyDisplay() {
        const nameEl = document.getElementById('agency-name');
        const quotaEl = document.getElementById('agency-quota');
        if (nameEl && quotaEl) {
            const isAdmin = isAdminRole(State.userRole);
            if (isAdmin) {
                nameEl.textContent = `(주) 관리자 계정`;
                quotaEl.textContent = `남은 횟수 : 무제한`;
                quotaEl.style.color = 'var(--warning-color)';
            }
            else {
                nameEl.textContent = State.agencyName;
                quotaEl.textContent = `남은 횟수 : ${State.quota} 회`;
                if (State.quota === 0) {
                    quotaEl.style.color = 'var(--danger-color)';
                }
                else if (State.quota < 10) {
                    quotaEl.style.color = 'var(--warning-color)';
                }
                else {
                    quotaEl.style.color = 'var(--text-color)';
                }
            }
        }
    }
    ctx.helpers = ctx.helpers || {};
    ctx.helpers.updateAgencyDisplay = updateAgencyDisplay;
    if (ctx.helpers && typeof ctx.helpers.setupLoggedOutNav === 'function') {
        ctx.helpers.setupLoggedOutNav();
    }
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginBtn = loginForm.querySelector('.primary-button');
            const loginLoader = document.getElementById('login-loader');
            const usernameEl = document.getElementById('username');
            const passwordEl = document.getElementById('password');
            const sidebar = document.querySelector('#logged-out-view .sidebar');
            const errorMsg = document.getElementById('login-error');
            const rememberEl = document.getElementById('remember-me');
            if (!loginBtn || !loginLoader || !usernameEl || !passwordEl || !errorMsg || !rememberEl) {
                return;
            }
            const inputId = usernameEl.value.trim();
            const email = inputId + ID_DOMAIN;
            const password = passwordEl.value.trim();
            const remember = rememberEl.checked;
            const loginData = { id: inputId, pw: password, remember };
            errorMsg.textContent = '로그인 중...';
            loginBtn.style.display = 'none';
            loginLoader.style.display = 'flex';
            errorMsg.textContent = '';
            usernameEl.disabled = true;
            passwordEl.disabled = true;
            if (sidebar)
                sidebar.classList.add('ui-lock');
            try {
                const user = await authService.login(email, password);
                const roleRaw = await checkUserRole(user.uid || '');
                const role = String(roleRaw || '').trim().toLowerCase();
                const savedLoginInfo = await window.electronAPI.saveLoginInfo(loginData);
                console.log(`로그인 성공! UID: ${user.uid}, Role: ${role}`);
                await fetchUserInfoAndSettings(user.uid);
                State.isLoggedIn = true;
                State.userRole = role;
                const isAdmin = isAdminRole(role);
                ViewManager.showView('logged-in-view');
                ViewManager.showScreen(loggedInView, 'create-scan-screen');
                updateAgencyDisplay();
                if (isAdmin) {
                    document.body.classList.add('is-admin');
                    await CustomUI.alert(`관리자 계정으로 접속했습니다.`);
                    setTimeout(() => {
                        ctx.services?.adminManager?.init?.();
                    }, 500);
                }
                else {
                    document.body.classList.remove('is-admin');
                }
                if (savedLoginInfo && savedLoginInfo.success && remember && savedLoginInfo.passwordStored === false) {
                    await CustomUI.alert('이 환경에서는 비밀번호를 안전하게 저장할 수 없어 아이디만 유지합니다.');
                }
                document.getElementById('nav-create')?.classList.add('active');
                errorMsg.textContent = '';
            }
            catch (error) {
                console.error(error);
                if (error?.message === 'LOCKED_ACCOUNT') {
                    errorMsg.textContent = '🚫 관리자에 의해 이용이 정지된 계정입니다. \n(문의: 031-778-8810)';
                    await authService.logout();
                    return;
                }
                if (error?.code === 'auth/invalid-credential') {
                    errorMsg.textContent = '아이디 또는 비밀번호가 잘못되었습니다.';
                }
                else {
                    errorMsg.textContent = '로그인 오류: ' + error?.code;
                }
            }
            finally {
                loginLoader.style.display = 'none';
                loginBtn.style.display = 'block';
                usernameEl.disabled = false;
                passwordEl.disabled = false;
                if (sidebar)
                    sidebar.classList.remove('ui-lock');
            }
        });
    }
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (await CustomUI.confirm('로그아웃 하시겠습니까?')) {
                try {
                    await authService.logout();
                    ctx.services?.deviceManager?.stopPolling();
                    State.isLoggedIn = false;
                    State.androidTargetMinutes = 0;
                    State.iosProgressMode = 'real';
                    State.agencyName = 'BD SCANNER';
                    State.quota = -1;
                    ViewManager.showView('logged-out-view');
                    ViewManager.showScreen(loggedOutView, 'login-screen');
                    window.location.reload();
                }
                catch (error) {
                    alert('로그아웃 실패: ' + error?.message);
                }
                const privacyNotice = document.getElementById('privacy-footer-notice');
                if (privacyNotice)
                    privacyNotice.style.display = 'none';
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
            const resultsDash = document.getElementById('results-dashboard-view');
            if (resultsDash) {
                resultsDash.classList.remove('hidden');
                resultsDash.style.display = 'block';
            }
            const resultsHeader2 = document.querySelector('.results-header');
            if (resultsHeader2)
                resultsHeader2.style.display = 'flex';
            const privacyNotice2 = document.getElementById('privacy-footer-notice');
            if (privacyNotice2)
                privacyNotice2.style.display = 'block';
            if (targetId === 'scan-dashboard-screen') {
                const resultsScreen = document.getElementById('scan-results-screen');
                if (resultsScreen) {
                    resultsScreen.classList.add('hidden');
                    resultsScreen.style.display = 'none';
                }
                ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');
                if (ctx.controllers?.scanController?.startAndroidDashboardPolling) {
                    ctx.controllers.scanController.startAndroidDashboardPolling();
                }
            }
            else {
                const dashboardScreen = document.getElementById('scan-dashboard-screen');
                if (dashboardScreen) {
                    dashboardScreen.classList.add('hidden');
                    dashboardScreen.style.display = 'none';
                }
                ViewManager.showScreen(loggedInView, 'scan-results-screen');
                document.querySelectorAll('.result-content-section').forEach(section => {
                    const el = section;
                    if (el.id === targetId) {
                        el.style.display = 'block';
                        el.classList.add('active');
                    }
                    else {
                        el.style.display = 'none';
                        el.classList.remove('active');
                    }
                });
                const mainContent = document.querySelector('.main-content');
                if (mainContent)
                    mainContent.scrollTop = 0;
                const resultsView = document.getElementById('results-dashboard-view');
                if (resultsView) {
                    resultsView.scrollTop = 0;
                    resultsView.scrollLeft = 0;
                }
                const privacyNotice = document.getElementById('privacy-footer-notice');
                if (privacyNotice) {
                    privacyNotice.style.display = 'block';
                }
                console.log(`[Tab Switch] ${targetId} 전환 성공`);
                if (String(targetId || '').startsWith('res-ios-') && typeof ctx.helpers?.forceRenderIosCoreAreas === 'function') {
                    ctx.helpers.forceRenderIosCoreAreas();
                }
            }
        });
    });
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            ViewManager.activateMenu('nav-create');
            ViewManager.showScreen(loggedInView, 'create-scan-screen');
            ctx.services?.deviceManager?.stopPolling();
        });
    }
    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            ViewManager.activateMenu('nav-open');
            ViewManager.showScreen(loggedInView, 'open-scan-screen');
            ctx.services?.deviceManager?.stopPolling();
        });
    }
    const navAndroidDash = document.getElementById('nav-android-dashboard');
    if (navAndroidDash) {
        navAndroidDash.addEventListener('click', () => {
            ViewManager.activateMenu('nav-android-dashboard');
            ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');
            if (ctx.controllers?.scanController?.startAndroidDashboardPolling) {
                ctx.controllers.scanController.startAndroidDashboardPolling();
            }
        });
    }
    const navScanInfo = document.getElementById('nav-scan-info');
    if (navScanInfo) {
        navScanInfo.addEventListener('click', () => {
            ViewManager.activateMenu('nav-scan-info');
            ViewManager.showScreen(loggedInView, 'scan-info-screen');
            try {
                ctx.helpers?.renderScanInfo?.(State.lastScanData, State.lastScanFileMeta);
            }
            catch (e) {
                console.warn('[BD-Scanner] scan-info render failed:', e);
            }
            try {
                const subMenu = document.getElementById('result-sub-menu');
                const iosSub = document.getElementById('ios-sub-menu');
                const dash = document.getElementById('nav-android-dashboard');
                const navResult = document.getElementById('nav-result');
                const navCreateEl = document.getElementById('nav-create');
                const navOpenEl = document.getElementById('nav-open');
                const mode = String(State.currentDeviceMode || '').toLowerCase();
                if (navCreateEl) {
                    navCreateEl.classList.add('hidden');
                    navCreateEl.style.display = 'none';
                }
                if (navOpenEl) {
                    navOpenEl.classList.add('hidden');
                    navOpenEl.style.display = 'none';
                }
                if (navResult) {
                    navResult.classList.remove('hidden');
                    navResult.style.display = 'block';
                }
                if (mode === 'ios') {
                    if (subMenu) {
                        subMenu.classList.add('hidden');
                        subMenu.style.display = 'none';
                    }
                    if (iosSub) {
                        iosSub.classList.remove('hidden');
                        iosSub.style.display = 'block';
                    }
                }
                else {
                    if (subMenu) {
                        subMenu.classList.remove('hidden');
                        subMenu.style.display = 'block';
                    }
                    if (iosSub) {
                        iosSub.classList.add('hidden');
                        iosSub.style.display = 'none';
                    }
                }
                if (dash) {
                    dash.classList.add('hidden');
                    dash.style.display = 'none';
                }
            }
            catch (_e) {
                /* noop */
            }
            try {
                const data = (State.lastScanData || {});
                const deviceInfo = data.deviceInfo || {};
                const pick = (...candidates) => {
                    for (const v of candidates) {
                        if (v === null || v === undefined)
                            continue;
                        const s = String(v).trim();
                        if (!s)
                            continue;
                        if (s.includes('익명'))
                            return '-';
                        if (s === '000-0000-0000' || s === '0000-00-00' || s === '0001-01-01')
                            return '-';
                        return s;
                    }
                    return '-';
                };
                const examinerName = pick(data.meta?.targetName, data.meta?.targetUserName, data.meta?.subjectName, data.meta?.personName, data.meta?.clientName, data.targetInfo?.name, data.target?.name, data.subject?.name, data.clientInfo?.name, data.client?.name, data.clientName, data.examinerName, data.examiner?.name, data.meta?.examinerName);
                const examinerPhone = pick(data.meta?.targetPhone, data.meta?.targetMobile, data.meta?.subjectPhone, data.meta?.subjectMobile, data.meta?.personPhone, data.meta?.clientPhone, data.targetInfo?.phone, data.targetInfo?.mobile, data.target?.phone, data.target?.mobile, data.subject?.phone, data.subject?.mobile, data.clientInfo?.phone, data.client?.phone, data.clientPhone, data.examinerPhone, data.examiner?.phone, data.meta?.examinerPhone);
                const model = pick(deviceInfo.model);
                const os = pick(deviceInfo.os, deviceInfo.osVersion, deviceInfo.version);
                const serial = pick(deviceInfo.serial);
                const root = (typeof deviceInfo.isRooted === 'boolean')
                    ? (deviceInfo.isRooted ? '발견됨 (위험)' : '안전함')
                    : pick(deviceInfo.root, deviceInfo.rootStatus, deviceInfo.isRooted);
                const setText = (id, value) => {
                    const el = document.getElementById(id);
                    if (el)
                        el.textContent = value;
                };
                setText('scan-info-examiner-name', examinerName);
                setText('scan-info-examiner-phone', examinerPhone);
                setText('scan-info-model', model);
                setText('scan-info-os', os);
                setText('scan-info-serial', serial);
                setText('scan-info-root', root);
            }
            catch (e) {
                console.warn('scan-info render failed:', e);
            }
        });
    }
    ctx.helpers = ctx.helpers || {};
    ctx.helpers.setAndroidDashboardNavVisible = (visible) => {
        const el = document.getElementById('nav-android-dashboard');
        if (!el)
            return;
        el.style.display = visible ? 'block' : 'none';
        el.classList.toggle('hidden', !visible);
    };
    ctx.helpers.setScanInfoNavVisible = (visible) => {
        const el = document.getElementById('nav-scan-info');
        if (!el)
            return;
        el.style.display = visible ? 'block' : 'none';
        el.classList.toggle('hidden', !visible);
    };
    const navResultBtn = document.getElementById('nav-result');
    if (navResultBtn) {
        navResultBtn.addEventListener('click', () => {
            if (State.lastScanData) {
                ViewManager.activateMenu('nav-result');
                ViewManager.showScreen(loggedInView, 'scan-results-screen');
                const resultsDash = document.getElementById('results-dashboard-view');
                if (resultsDash) {
                    resultsDash.classList.remove('hidden');
                    resultsDash.style.display = 'block';
                }
                const resultsHeader2 = document.querySelector('.results-header');
                if (resultsHeader2)
                    resultsHeader2.style.display = 'flex';
                const privacyNotice2 = document.getElementById('privacy-footer-notice');
                if (privacyNotice2)
                    privacyNotice2.style.display = 'block';
                ResultsRenderer.render(State.lastScanData);
            }
            else {
                CustomUI.alert('표시할 검사 결과 데이터가 없습니다.');
            }
        });
    }
}
