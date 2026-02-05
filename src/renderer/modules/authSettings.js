// Auto-split module: authSettings

import { checkUserRole as checkUserRoleService, fetchUserInfoAndSettings as fetchUserInfoAndSettingsService } from '../services/userSettingsService.js';

export function initAuthSettings(ctx) {
    const { State, ViewManager, CustomUI, dom, firebase, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    // Firebase deps (pass-through from renderer bootstrap)
    const { auth, db, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, getAuth,
        doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where, runTransaction, addDoc, serverTimestamp, deleteDoc, increment, limit, initializeApp
    } = firebase;

        // [3] 인증 및 설정 불러오기 (AUTH & SETTINGS)
        // =========================================================
    
        // --- Service wrappers: UI 모듈에서 DB 로직 분리 ---
        async function checkUserRole(uid) {
            return await checkUserRoleService(firebase, uid);
        }

        async function fetchUserInfoAndSettings() {
            const result = await fetchUserInfoAndSettingsService(firebase, constants);
            if (!result) return;
            State.androidTargetMinutes = result.androidTargetMinutes || 0;
            State.agencyName = result.agencyName || '업체명 없음';
            State.quota = (result.quota !== undefined) ? result.quota : 0;
            updateAgencyDisplay();
        }
    
        //회사 정보 UI 업데이트 함수
        function updateAgencyDisplay() {
            // ⚠️ 참고: index.html에 #agency-info-display, #agency-name, #agency-quota 요소가 있다고 가정
            const nameEl = document.getElementById('agency-name');
            const quotaEl = document.getElementById('agency-quota');
    
            if (nameEl && quotaEl) {
                // 관리자 계정은 쿼터 무제한으로 표시
                if (State.userRole === 'admin') {
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
                    // 1. Firebase 로그인
                    const userCredential = await signInWithEmailAndPassword(auth, email, password);

                    // ✅ Main 프로세스에서도 동일 계정으로 Firebase Auth 로그인(Firestore 권한용)
                    try {
                        if (window?.bdScanner?.auth?.login) {
                            await window.bdScanner.auth.login(email, password);
                        } else if (window?.electronAPI?.firebaseAuthLogin) {
                            await window.electronAPI.firebaseAuthLogin(email, password);
                        }
                    } catch (e) {
                        console.warn('Main Auth login failed (will likely cause permission errors):', e);
                    }

                    const user = userCredential.user;
    
                    // 2. 권한 확인 (DB 조회)
                    const role = await checkUserRole(user.uid);
                    await window.electronAPI.saveLoginInfo(loginData)
                    console.log(`로그인 성공! UID: ${user.uid}, Role: ${role}`);
    
                    // 3. 설정값 불러오기
                    await fetchUserInfoAndSettings();
    
                    // 4. 화면 전환 분기 처리
                    State.isLoggedIn = true;
                    State.userRole = role; // 상태에 저장
    
                    if (role === 'admin') {
                        // ★ 관리자 화면
                        ViewManager.showView('logged-in-view');
                        ViewManager.showScreen(loggedInView, 'create-scan-screen');
    
                        document.body.classList.add('is-admin');
                        await CustomUI.alert(`관리자 계정으로 접속했습니다.`);
    
                        setTimeout(() => {
                            AdminManager.init();
                        }, 500);
                    } else {
                        // ★ 일반 사용자
                        ViewManager.showView('logged-in-view');
                        ViewManager.showScreen(loggedInView, 'create-scan-screen');
                        document.body.classList.remove('is-admin');
                    }
    
                    document.getElementById('nav-create').classList.add('active');
                    errorMsg.textContent = "";
    
                } catch (error) {
                    console.error(error);
                    if (error.message === "LOCKED_ACCOUNT") {
                        errorMsg.textContent = "🚫 관리자에 의해 이용이 정지된 계정입니다. \n(문의: 031-778-8810)";
                        await signOut(auth); // Firebase 세션도 즉시 로그아웃
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
    
        // 로그아웃 처리
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                if (await CustomUI.confirm('로그아웃 하시겠습니까?')) {
                    try {
                        await signOut(auth);
                        ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);
                        State.isLoggedIn = false;
                        State.androidTargetMinutes = 0; // 설정값 초기화
                        State.agencyName = 'BD SCANNER'; // 회사 정보 상태 초기화
                        State.quota = -1;
    
                        ViewManager.showView('logged-out-view');
                        ViewManager.showScreen(loggedOutView, 'login-screen');
                        window.location.reload();
                    } catch (error) {
                        alert("로그아웃 실패: " + error.message);
                    }
                    const privacyNotice = document.getElementById('privacy-footer-notice');
                    if (privacyNotice) privacyNotice.style.display = 'none';
    
                    window.location.reload(); // 페이지 새로고침
                }
            });
        }
    
        document.querySelectorAll('.res-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const targetId = tab.dataset.target;
    
                document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
                // 1. 관리자 화면과 상세 화면을 완전히 닫기
                const screensToHide = ['admin-screen', 'admin-report-detail-screen', 'app-detail-view', 'create-scan-screen', 'open-scan-screen'];
                screensToHide.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.classList.add('hidden');
                        el.style.display = 'none';
                    }
                });
    
                // 2. 결과 대시보드 메인 컨테이너 켜기
                const dashboard = document.getElementById('results-dashboard-view');
                const resultsScreen = document.getElementById('scan-results-screen');
                if (resultsScreen) {
                    resultsScreen.classList.remove('hidden');
                    resultsScreen.style.display = 'block';
                }
                if (dashboard) {
                    dashboard.classList.remove('hidden');
                    dashboard.style.display = 'block';
                }
    
                // 3. 탭 버튼 활성화 상태 변경
                document.querySelectorAll('.res-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
    
                // 4. 오른쪽 콘텐츠 영역 전환 (매우 중요)
                document.querySelectorAll('.result-content-section').forEach(section => {
                    if (section.id === targetId) {
                        section.style.display = 'block';
                        section.classList.add('active');
                    } else {
                        section.style.display = 'none';
                        section.classList.remove('active');
                    }
                });
                const privacyNotice = document.getElementById('privacy-footer-notice');
                if (privacyNotice) {
                    privacyNotice.style.display = 'block';
                }
                console.log(`[Tab Switch] ${targetId} 전환 성공`);
            });
        });
    
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
    
        // 사이드바: 아이폰 전용 결과 보고서 복귀 메뉴
        const navResultBtn = document.getElementById('nav-result');
        if (navResultBtn) {
            navResultBtn.addEventListener('click', () => {
                if (window.lastScanData) {
                    ViewManager.activateMenu('nav-result');
                    ViewManager.showScreen(loggedInView, 'scan-results-screen');
                    ResultsRenderer.render(window.lastScanData);
                } else {
                    CustomUI.alert("표시할 검사 결과 데이터가 없습니다.");
                }
            });
        }
    
        // =========================================================
}
