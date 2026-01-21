// renderer.js
// BD (Big Dream) Security Solution - Renderer Process
import { auth, db } from './firebaseConfig.js';
import { signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    doc,
    getDoc,
    updateDoc,
    collection,
    getDocs,
    setDoc,
    query,
    orderBy,
    where,
    runTransaction,
    addDoc,
    serverTimestamp,
    deleteDoc,
    increment,
    limit  // ★ [수정 1] 비정상 로그 불러올 때 필요한 limit 추가
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
const CURRENT_APP_VERSION = '1.0.1'

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', () => {
    console.log('--- renderer.js: DOM 로드 완료 ---');

    getSaveInfo();

    const ID_DOMAIN = "@bd.com";

    // [추가] 로그인 전 사이드바 메뉴 (로그인 / 고객센터)
    // =========================================================
    const setupLoggedOutNav = () => {
        const navLogin = document.getElementById('nav-login');
        const navSupport = document.getElementById('nav-support');

        if (navLogin) {
            navLogin.addEventListener('click', () => {
                // 사이드바 active 클래스 관리
                document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
                navLogin.classList.add('active');
                // 화면 전환
                ViewManager.showScreen(loggedOutView, 'login-screen');
            });
        }

        if (navSupport) {
            navSupport.addEventListener('click', () => {
                // 사이드바 active 클래스 관리
                document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
                navSupport.classList.add('active');
                // 화면 전환
                ViewManager.showScreen(loggedOutView, 'support-screen');
            });
        }
    };

    async function getSaveInfo() {

        const saveInfo = await window.electronAPI.getLoginInfo();


        if (saveInfo && saveInfo.remember) {

            document.getElementById('username').value = saveInfo.id;
            document.getElementById('password').value = saveInfo.pw;
            document.getElementById('remember-me').checked = saveInfo.remember;
        } else {
            // 기억하기가 체크 안 된 상태라면 입력창을 비움
            document.getElementById('user-id').value = '';
            document.getElementById('user-pw').value = '';
            document.getElementById('remember-me').checked = false;
        }
    };
    // =========================================================
    // [1] 상태 관리 (STATE MANAGEMENT)
    // =========================================================
    const State = {
        isLoggedIn: false,
        connectionCheckInterval: null,
        currentDeviceMode: null, // 'android' or 'ios'
        currentUdid: null,       // iOS UDID
        lastScanData: null,      // 인쇄용 데이터 백업
        androidTargetMinutes: 0, // 기본값 0 (즉시 완료), 히든 메뉴로 변경 가능
        agencyName: 'BD SCANNER', // 회사 정보 상태
        quota: -1, // -1은 로딩 중 또는 알 수 없음
        scrollPostion: 0
    };

    // =========================================================
    // [2] 뷰 관리자 (VIEW MANAGER)
    // =========================================================
    const ViewManager = {
        // 큰 뷰 전환 (로그인 전/후)
        showView(viewId) {
            document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
            const viewToShow = document.getElementById(viewId);
            if (viewToShow) viewToShow.classList.add('active');
        },

        // 내부 스크린 전환 (로그인 후 콘텐츠)
        showScreen(parentView, screenId) {
            if (!parentView) return;

            // 1. 모든 스크린 숨김
            document.querySelectorAll('.screen').forEach(s => {
                s.classList.remove('active');
                s.classList.add('hidden');
            });

            // 2. 선택된 스크린 표시
            const screenToShow = document.getElementById(screenId);
            if (screenToShow) {
                screenToShow.classList.remove('hidden');
                screenToShow.classList.add('active');
            }

            // 3. [추가] 개인정보 안내 문구 노출 제어
            const privacyNotice = document.getElementById('privacy-footer-notice');
            if (privacyNotice) {
                // 문구를 보여줄 화면 ID 목록
                const allowedScreens = ['create-scan-screen', 'device-connection-screen', 'scan-progress-screen', 'scan-results-screen'];

                if (allowedScreens.includes(screenId)) {
                    privacyNotice.style.display = 'block';
                } else {
                    // 검사 진행 중, 결과 보고서, 관리자 화면 등에서는 숨김
                    privacyNotice.style.display = 'none';
                }
            }
        },

        // 사이드바 메뉴 활성화
        activateMenu(targetId) {
            document.querySelectorAll('#logged-in-view .nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const target = document.getElementById(targetId);
            if (target) {
                target.classList.add('active');
                console.log(`메뉴 활성화됨: ${targetId}`);
            }
        },

        // 진행바 업데이트
        updateProgress(percent, text) {
            const statusBar = document.getElementById('progress-bar');
            const statusText = document.getElementById('scan-status-text');
            if (statusBar) statusBar.style.width = `${percent}%`;
            if (statusText) statusText.textContent = text;
            if (statusBar) statusBar.style.backgroundColor = '#5CB85C'; // 초기화
        }
    };

    // DOM 참조 캐싱 (자주 쓰는 뷰)
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');

    // 재사용 가능한 custom Alert
    const CustomUI = {
        // 알림창 (Alert)
        alert(message) {
            return new Promise((resolve) => {

                const modal = document.getElementById('custom-alert-modal');
                const msgEl = document.getElementById('custom-alert-msg');
                const btn = document.getElementById('custom-alert-ok-btn');

                msgEl.textContent = message;
                modal.classList.remove('hidden');

                // 엔터키 처리 및 클릭 처리
                const close = () => {
                    modal.classList.add('hidden');
                    btn.removeEventListener('click', close);
                    resolve(); // 창이 닫혀야 다음 코드 실행
                };

                btn.addEventListener('click', close);
                btn.focus(); // 버튼에 포커스 (접근성)
            });
        },

        // 확인창 (Confirm) - 중요: await와 함께 써야 함
        confirm(message) {
            return new Promise((resolve) => {
                const modal = document.getElementById('custom-confirm-modal');
                const msgEl = document.getElementById('custom-confirm-msg');
                const okBtn = document.getElementById('custom-confirm-ok-btn');
                const cancelBtn = document.getElementById('custom-confirm-cancel-btn');

                msgEl.textContent = message;
                modal.classList.remove('hidden');

                const handleOk = () => {
                    cleanup();
                    resolve(true); // true 반환
                };

                const handleCancel = () => {
                    cleanup();
                    resolve(false); // false 반환
                };

                const cleanup = () => {
                    modal.classList.add('hidden');
                    okBtn.removeEventListener('click', handleOk);
                    cancelBtn.removeEventListener('click', handleCancel);
                };

                okBtn.addEventListener('click', handleOk);
                cancelBtn.addEventListener('click', handleCancel);
                cancelBtn.focus(); // 실수 방지를 위해 취소에 포커스
            });
        },

        prompt(message, defaultValue = '') {
            return new Promise((resolve) => {
                // 1. 모달 배경 생성
                const modalOverlay = document.createElement('div');
                modalOverlay.style.cssText = `
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background-color: rgba(0,0,0,0.5); display: flex;
                    justify-content: center; align-items: center; z-index: 10000;
                `;

                // 2. 모달 박스 생성
                const modalBox = document.createElement('div');
                modalBox.style.cssText = `
                    background: white; padding: 20px; border-radius: 8px;
                    width: 350px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    text-align: center; font-family: sans-serif;
                `;

                // 3. 내용물 (텍스트, 입력창, 버튼)
                modalBox.innerHTML = `
                    <h3 style="margin-top:0; color:#333; font-size:16px;">${message.replace(/\n/g, '<br>')}</h3>
                    <input type="text" id="custom-prompt-input" value="${defaultValue}" 
                        style="width: 100%; padding: 10px; margin: 15px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 14px;">
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button id="prompt-cancel-btn" style="padding: 8px 16px; border: none; background: #f5f5f5; border-radius: 4px; cursor: pointer;">취소</button>
                        <button id="prompt-ok-btn" style="padding: 8px 16px; border: none; background: #337ab7; color: white; border-radius: 4px; cursor: pointer;">확인</button>
                    </div>
                `;

                modalOverlay.appendChild(modalBox);
                document.body.appendChild(modalOverlay);

                const input = modalBox.querySelector('#custom-prompt-input');
                const okBtn = modalBox.querySelector('#prompt-ok-btn');
                const cancelBtn = modalBox.querySelector('#prompt-cancel-btn');

                // 포커스 자동 지정
                input.focus();
                input.select();

                // 4. 이벤트 핸들러
                const handleOk = () => {
                    const val = input.value;
                    modalOverlay.remove();
                    resolve(val); // 입력값 반환
                };

                const handleCancel = () => {
                    modalOverlay.remove();
                    resolve(null); // 취소 시 null 반환
                };

                okBtn.addEventListener('click', handleOk);
                cancelBtn.addEventListener('click', handleCancel);

                // 엔터키 누르면 확인, ESC 누르면 취소
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handleOk();
                    if (e.key === 'Escape') handleCancel();
                });
            });
        }
    };

    // =========================================================
    // [3] 인증 및 설정 불러오기 (AUTH & SETTINGS)
    // =========================================================

    //사용자 권한 확인 함수
    async function checkUserRole(uid) {
        try {
            const userDocRef = doc(db, "users", uid);
            const userSnap = await getDoc(userDocRef);

            if (userSnap.exists()) {
                const userData = userSnap.data();

                if (userData.isLocked) {
                    throw new Error("LOCKED_ACCOUNT"); // 에러 발생시킴
                }

                return userData.role || 'user'; // role이 없으면 기본 'user'
            } else {
                return 'user';
            }
        } catch (e) {
            if (e.message === "LOCKED_ACCOUNT") {
                console.log("잡았다! 잠긴 계정임.")
                throw e;
            }
            console.error("권한 확인 실패:", e);
            return 'user'; // 에러 나면 안전하게 일반 유저로
        }
    }

    //  Firestore에서 시간 설정 가져오기 함수
    async function fetchUserInfoAndSettings() {
        try {
            // 1. 현재 로그인한 유저 정보 가져오기
            const user = auth.currentUser;

            if (!user) {
                console.log("⚠️ 로그인 정보가 없어 설정을 불러올 수 없습니다.");
                return;
            }

            console.log(`📥 [${user.uid}] 계정의 설정값 불러오는 중...`);

            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                State.androidTargetMinutes = data.android_scan_duration || 0;
                State.agencyName = data.companyName || (data.userId ? `(주) ${data.userId}` : "업체명 없음");
                State.quota = data.quota !== undefined ? data.quota : 0;
                console.log(`✅ 설정 로드 완료: 안드로이드 검사 시간 [${State.androidTargetMinutes}분]`);

                updateAgencyDisplay();

            } else {
                console.log("⚠️ 유저 문서가 존재하지 않습니다. (기본값 0분 사용)");
                State.androidTargetMinutes = 0;
            }
        } catch (error) {
            console.error("❌ 설정 불러오기 실패:", error);
            State.androidTargetMinutes = 0;
        }
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
    setupLoggedOutNav();

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
                    errorMsg.textContent = "🚫 관리자에 의해 이용이 정지된 계정입니다. \n(문의: 010-8119-1837)";
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
                    DeviceManager.stopPolling();
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

    // 사이드바: 검사 생성
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            ViewManager.activateMenu('nav-create');
            ViewManager.showScreen(loggedInView, 'create-scan-screen');
            DeviceManager.stopPolling();
        });
    }

    // 사이드바: 검사 열기
    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            ViewManager.activateMenu('nav-open');
            ViewManager.showScreen(loggedInView, 'open-scan-screen');
            DeviceManager.stopPolling();
        });
    }

    // =========================================================
    // [4] 고객 정보 및 기기 연결 (CLIENT INFO & DEVICE)
    // =========================================================

    // 고객 정보 입력 폼
    const clientInfoForm = document.getElementById('client-info-form');
    const toConnectionScreenBtn = document.getElementById('to-connection-screen-btn');
    const clientInputs = {
        name: document.getElementById('client-name'),
        dob: document.getElementById('client-dob'),
        phone: document.getElementById('client-phone')
    };

    // DOM 참조 캐싱 (익명 기능 추가)
    const anonChecks = {
        name: document.getElementById('anon-name'),
        dob: document.getElementById('anon-dob'),
        phone: document.getElementById('anon-phone')
    };

    const anonValues = {
        name: '익명 사용자',
        dob: '0001-01-01',
        phone: '000-0000-0000'
    };

    // 개별 익명 처리 함수
    function setupAnonToggle(key) {
        const inputEl = clientInputs[key];
        const checkEl = anonChecks[key];
        const anonValue = anonValues[key];

        if (!checkEl || !inputEl) return;

        checkEl.addEventListener('change', () => {
            const isAnonymous = checkEl.checked;

            if (isAnonymous) {
                // 익명 모드: 값 채우고, 비활성화 (disabled)
                inputEl.value = anonValue;
                inputEl.disabled = true;
            } else {
                // 일반 모드: 값 비우고, 활성화
                inputEl.value = '';
                inputEl.disabled = false;
            }

            // 익명 상태 변경 시마다 전체 폼 유효성 재검사
            checkFormValidity();
        });
    }

    // 모든 필드에 익명 처리 로직 적용
    setupAnonToggle('name');
    setupAnonToggle('dob');
    setupAnonToggle('phone');


    // 유효성 검사 함수 (새로 정의)
    function checkFormValidity() {
        const isNameAnon = anonChecks.name && anonChecks.name.checked;
        const isDobAnon = anonChecks.dob && anonChecks.dob.checked;
        const isPhoneAnon = anonChecks.phone && anonChecks.phone.checked;

        // 익명이 아니면서(isAnon=false) 값이 채워지지 않은 필드가 있는지 검사
        const isNameValid = isNameAnon || !!clientInputs.name.value.trim();
        const isDobValid = isDobAnon || !!clientInputs.dob.value.trim();
        const isPhoneValid = isPhoneAnon || !!clientInputs.phone.value.trim();

        // 모든 필드가 유효해야 버튼 활성화
        const isValid = isNameValid && isPhoneValid;
        toConnectionScreenBtn.disabled = !isValid;
    }

    if (clientInfoForm) {
        // 입력 감지 (버튼 활성화) - 익명 기능을 고려하여 checkFormValidity 함수 사용
        clientInfoForm.addEventListener('input', checkFormValidity);

        // 초기화 버튼
        document.getElementById('reset-client-info-btn').addEventListener('click', () => {
            // 1. 모든 입력 필드 초기화 및 활성화
            Object.values(clientInputs).forEach(input => {
                input.value = '';
                input.disabled = false; // 익명 체크로 비활성화되었을 경우를 위해 활성화
            });

            // 2. ★★★익명 체크박스 해제★★★
            Object.values(anonChecks).forEach(check => {
                if (check) check.checked = false;
            });

            // 3. 유효성 검사 함수 호출 (버튼 비활성화 상태 업데이트)
            checkFormValidity();
        });

        // 폼 제출 -> 연결 화면 이동
        clientInfoForm.addEventListener('submit', (e) => {

            e.preventDefault();
            ViewManager.showScreen(loggedInView, 'device-connection-screen');
            DeviceManager.startPolling();
        });
    }

    // 뒤로가기 (연결 화면 -> 정보 입력)
    const backToInfoBtn = document.getElementById('back-to-info-btn');
    if (backToInfoBtn) {
        backToInfoBtn.addEventListener('click', () => {
            DeviceManager.stopPolling();
            ViewManager.showScreen(loggedInView, 'create-scan-screen');
        });
    }

    // 연결 끊기 (결과 화면 -> 정보 입력)
    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', async () => {
            if (await CustomUI.confirm('기기 연결을 끊고 초기 화면으로 돌아가시겠습니까?')) {
                // UI 초기화
                document.getElementById('nav-create').classList.remove('hidden');
                document.getElementById('nav-open').classList.remove('hidden');
                const navResult = document.getElementById('nav-result');
                if (navResult) {
                    navResult.classList.add('hidden');
                    navResult.classList.remove('active');
                }

                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'create-scan-screen');

                // 기기 연결 화면 버튼 초기화
                const realStartScanBtn = document.getElementById('real-start-scan-btn');
                if (realStartScanBtn) {
                    realStartScanBtn.disabled = false;
                    realStartScanBtn.textContent = '검사 시작하기';
                }

                // 폼 리셋 및 윈도우 리프레시 효과
                const resetBtn = document.getElementById('reset-client-info-btn');
                if (resetBtn) resetBtn.click();
            }
        });
    }

    // =========================================================
    // [5] 기기 감지 로직 (DEVICE MANAGER)
    // =========================================================
    const DeviceManager = {
        startPolling() {
            if (State.connectionCheckInterval) clearInterval(State.connectionCheckInterval);
            this.checkDevice();
            State.connectionCheckInterval = setInterval(() => this.checkDevice(), 1500);
        },

        stopPolling() {
            if (State.connectionCheckInterval) clearInterval(State.connectionCheckInterval);
            State.connectionCheckInterval = null;
        },

        async checkDevice() {
            const screen = document.getElementById('device-connection-screen');
            if (!screen.classList.contains('active')) {
                this.stopPolling();
                return;
            }

            // 1. Android 확인
            try {
                const android = await window.electronAPI.checkDeviceConnection();

                if (android.status === 'connected') {
                    State.currentDeviceMode = 'android';
                    // 상태('connected'), 제목, 모델명, 색상, 버튼 표시 순서입니다.
                    this.setUI('connected', 'Android 연결됨', android.model, '#5CB85C', true);
                    return;
                } else if (android.status === 'unauthorized') {
                    State.currentDeviceMode = null;
                    this.setUI('unauthorized', '승인 대기 중', '휴대폰에서 USB 디버깅을 허용해주세요.', '#F0AD4E', false);
                    return;
                } else if (android.status === 'error' || android.status === 'offline') {
                    State.currentDeviceMode = null;
                    const errorMessage = android.error || 'ADB 도구 실행 오류. 프로그램 재시작 필요.';
                    this.setUI('disconnected', 'Android 도구 오류', errorMessage, '#D9534F', false);
                    return;
                }
            } catch (e) {
                this.setUI('disconnected', '통신 오류', 'Android 도구 연결 중 알 수 없는 오류 발생.', '#D9534F', false);
                return;
            }

            // 2. iOS 확인
            try {
                const ios = await window.electronAPI.checkIosConnection();
                if (ios.status === 'connected') {
                    State.currentDeviceMode = 'ios';
                    State.currentUdid = ios.udid;
                    this.setUI('connected', 'iPhone 연결됨', ios.model, '#5CB85C', true);
                    return;
                } else if (ios.status === 'error') {
                    State.currentDeviceMode = null;
                    const errorMessage = ios.error || 'iOS 도구 실행 오류. iTunes 설치 상태 확인 필요.';
                    this.setUI('disconnected', 'iOS 도구 오류', errorMessage, '#D9534F', false);
                    return;
                }
            } catch (e) {
                this.setUI('disconnected', '통신 오류', 'iOS 도구 연결 중 알 수 없는 오류 발생.', '#D9534F', false);
                return;
            }

            // 3. 연결 없음 (기존 로직 유지)
            State.currentDeviceMode = null;
            this.setUI('disconnected', '기기를 연결해주세요', 'Android 또는 iOS 기기를 USB로 연결하세요.', '#333', false);
        },

        // ★★★ [중요] 비주얼 연출을 위해 완전히 새로워진 setUI 함수 ★★★
        setUI(status, titleText, descText, color, showBtn = true) {
            // 1. 제어할 엘리먼트들 확보
            const wrapper = document.getElementById('connection-visual-wrapper'); // 폰+케이블 래퍼
            // const icon = document.getElementById('connection-device-icon'); <-- 이 줄 삭제! (더 이상 필요 없음)
            const alertTitle = document.getElementById('connection-device-title'); // 폰 내부 텍스트
            const title = document.getElementById('connection-status-title');      // 하단 큰 제목
            const desc = document.getElementById('connection-status-desc');        // 하단 작은 설명
            const btnContainer = document.getElementById('start-scan-container');  // 버튼 컨테이너

            // 2. 하단 텍스트 및 버튼 업데이트 (공통 작업)
            title.textContent = titleText;
            title.style.color = color;
            // 모델명이 있을 때만 굵게 표시하는 로직 유지
            desc.innerHTML = descText.includes('모델') ? descText : `<span>${descText}</span>`;
            btnContainer.style.display = showBtn ? 'block' : 'none';

            // 3. 스마트폰 프레임 상태 클래스 초기화 (깨끗하게 비우기)
            wrapper.classList.remove('state-disconnected', 'state-unauthorized', 'state-connected');

            // 4. 상태별 비주얼 분기 처리 (아이콘 변경 코드 삭제됨!)
            if (status === 'connected') {
                // ★ 핵심: 부모에게 '연결됨' 명찰만 달아줍니다.
                // 그러면 CSS가 알아서 녹색 체크 SVG를 보여줍니다.
                wrapper.classList.add('state-connected');
                
                alertTitle.innerHTML = 'DEVICE<br>READY'; // 폰 화면 멘트 변경
            } 
            else if (status === 'unauthorized') {
                // ★ 핵심: 부모에게 '인증 대기' 명찰을 달아줍니다.
                // CSS가 자물쇠 SVG를 보여줍니다.
                wrapper.classList.add('state-unauthorized');
                
                alertTitle.innerHTML = 'WAITING<br>AUTH';
            } 
            else {
                // 여기가 바로 이사님이 찾으시던 '연결 전(disconnected)' 상태입니다.
                // ★ 핵심: 부모에게 '연결 끊김' 명찰을 달아줍니다.
                // CSS가 플러그 SVG를 보여줍니다.
                wrapper.classList.add('state-disconnected');
                
                alertTitle.innerHTML = 'CONNECT<br>DEVICE';
            }
        }
    };

    // =========================================================
    // [6] 검사 실행 (SCAN CONTROLLER)
    // =========================================================

    // 검사 시작 버튼 클릭
    const realStartScanBtn = document.getElementById('real-start-scan-btn');
    if (realStartScanBtn) {
        realStartScanBtn.addEventListener('click', async () => {

            // 버튼을 즉시 비활성화하여 중복 클릭 방지
            realStartScanBtn.disabled = true;
            realStartScanBtn.textContent = '검사 준비 중...';

            const hasQuota = await ScanController.checkQuota();

            if (!hasQuota) {
                // 횟수 부족 시: 기기 연결 화면 유지 및 폴링 중단
                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'device-connection-screen');
                // 횟수 부족 시 버튼 상태 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return; // ★ 절대 넘어가지 않음
            }

            //횟수 차감 및 UI 업데이트 로직
            try {
                // 1. Firebase에서 Quota 차감 요청 (increment(-1) 사용)
                const user = auth.currentUser;
                if (user) {
                    await updateDoc(doc(db, "users", user.uid), {
                        quota: increment(-1) // 1회 차감
                    });

                    // 2. 로컬 상태와 UI 즉시 업데이트
                    State.quota -= 1;
                    updateAgencyDisplay();
                }

            } catch (quotaError) {
                console.error("❌ Quota 차감 중 오류 발생:", quotaError);
                CustomUI.alert('검사 횟수 차감에 실패했습니다. (서버 오류)');
                // 횟수 차감 실패 시, 검사 진행을 막고 버튼 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return;
            }

            const isLogged = await ScanController.startLogTransaction(State.currentDeviceMode);

            if (!isLogged) {

                CustomUI.alert('서버 통신 오류로 검사를 시작할 수 없습니다. 네트워크를 연결해주세요.');
                // 로그 기록 실패 시 버튼 상태 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return;
            }

            DeviceManager.stopPolling();

            document.getElementById('nav-create').classList.add('hidden');
            document.getElementById('nav-open').classList.add('hidden');
            const navResult = document.getElementById('nav-result');
            navResult.classList.remove('hidden');
            navResult.classList.add('active');

            ViewManager.showScreen(loggedInView, 'scan-progress-screen');

            if (State.currentDeviceMode === 'android') {

                await ScanController.startAndroidScan();
            } else if (State.currentDeviceMode === 'ios') {
                await ScanController.startIosScan();
            } else {
                await CustomUI.alert("연결된 기기가 없습니다.");
                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'device-connection-screen');
            }
        });
    }

    // 파일열기
    const openScanFileBtn = document.getElementById('select-file-btn');
    if (openScanFileBtn) {
        openScanFileBtn.addEventListener('click', async () => {

            openScanFileBtn.disabled = true;
            openScanFileBtn.textContent = "파일 여는 중...";

            try {
                const result = await window.electronAPI.openScanFile();

                if (result.success) {
                    const data = result.data;
                    const osMode = result.osMode; // 저장된 데이터에서 OS 모드를 가져옴

                    // 1. 상태 업데이트 (렌더링에 OS 모드가 필요하므로)
                    State.currentDeviceMode = osMode;
                    State.lastScanData = data;
                    window.lastScanData = data;

                    // 2. UI 전환
                    ViewManager.activateMenu('nav-result');
                    ResultsRenderer.render(data);
                    ViewManager.showScreen(loggedInView, 'scan-results-screen');

                    // 3. 네비게이션 버튼 표시
                    document.getElementById('nav-create').classList.add('hidden');
                    document.getElementById('nav-open').classList.add('hidden');
                    document.getElementById('nav-result').classList.remove('hidden');

                    await CustomUI.alert(`✅ 검사 결과 로드 완료!\n모델: ${data.deviceInfo.model}`);

                } else if (result.message !== '열기 취소') {
                    await CustomUI.alert(`❌ 파일 열기 실패: ${result.error || result.message}`);
                }
            } catch (error) {
                await CustomUI.alert(`시스템 오류: ${error.message}`);
            } finally {
                openScanFileBtn.disabled = false;
                openScanFileBtn.textContent = "📁 로컬 파일 열기";
            }
        });
    }

    const ScanController = {

        currentLogId: null,

        // [추가] 레이저 애니메이션을 제어하는 함수
        toggleLaser(isVisible) {
            // 레이저 빔 제어
            const beam = document.getElementById('scannerBeam');
            if (beam) {
                beam.style.display = isVisible ? 'block' : 'none';
            }
        },
        // ★★★ [수정됨] 실제 앱 목록을 활용한 정밀 검사 연출 ★★★
        async startAndroidScan() {
            this.toggleLaser(true);
            this.resetSmartphoneUI();

            try {
                // 1. 초기 멘트 및 리얼 검사 시작 (백그라운드)
                ViewManager.updateProgress(1, "디바이스 파일 시스템에 접근 중...");

                // 2. 데이터 확
                const scanData = await window.electronAPI.runScan();
                const apps = scanData.allApps || [];
                const totalApps = apps.length;

                // 앱이 하나도 없는 경우(예외)는 바로 종료
                if (totalApps === 0) {
                    this.toggleLaser(false);
                    this.finishScan(scanData);
                    return;
                }

                // 시간 계산
                // [시간 계산 로직]
                const targetMinutes = State.androidTargetMinutes || 0;
                const totalDurationMs = targetMinutes * 60 * 1000;

                // 앱 하나당 보여줄 분석 시간
                const timePerApp = targetMinutes > 0 
                    ? Math.max(35, totalDurationMs / totalApps) 
                    : 35;

                console.log(`[Theater Mode] 총 ${totalApps}개 앱, 목표 ${targetMinutes}분, 개당 ${(timePerApp / 1000).toFixed(2)}초 소요`);

                let currentIndex = 0;

                // ★ 애니메이션 루프 함수
                // [3단계] 애니메이션 루프 함수
                const processNextApp = () => {
                    // 종료 조건: 모든 앱 분석이 끝났을 때
                    if (currentIndex >= totalApps) {
                        console.log(`[Theater Mode] 검사 완료: 총 ${totalApps}개 분석됨`);
                        this.toggleLaser(false); // 레이저 정지
                        this.finishScan(scanData); // 완료 처리 (여기서 'SCAN COMPLETED'로 변경)
                        return;
                    }

                    const app = apps[currentIndex];
                    // UI 가독성을 위해 앱 이름만 포맷팅
                    const appName = Utils.formatAppName(app.packageName);

                    // 진행률 계산 (최대 99%까지)
                    const percent = Math.floor(((currentIndex + 1) / totalApps) * 100);

                    // 화면 갱신: 스마트폰 내부와 외부 프로그레스 바 동기화
                    ViewManager.updateProgress(
                        Math.min(99, percent),
                        `[${currentIndex + 1}/${totalApps}] ${appName} 정밀 분석 중...`
                    );

                    currentIndex++;

                    // 계산된 시간만큼 대기 후 다음 앱으로 이동
                    setTimeout(processNextApp, timePerApp);
                };

                // 루프 시작
                processNextApp();
            } catch (error) {
                // 에러 발생 시 레이저를 끄고 에러 핸들링
                this.toggleLaser(false);
                this.handleError(error);
            }
        },

        async startLogTransaction(deviceMode) {
            const user = auth.currentUser;
            if (!user) return false;

            try {
                // 1. 유저 정보 가져오기 (업체명 확인용)
                const userRef = doc(db, "users", user.uid);
                const userSnap = await getDoc(userRef);
                const userData = userSnap.exists() ? userSnap.data() : {};

                // 업체명 (DB에 없으면 이메일이나 기본값 사용)
                const companyName = userData.companyName || userData.email || "Unknown Company";

                // 2. 쿼터 차감 & 로그 생성 병렬 처리
                // (batch를 쓰면 더 안전하지만, 편의상 순차 처리)
                /*await updateDoc(userRef, {
                    quota: increment(-1)
                });
                */
                const newLogRef = await addDoc(collection(db, "scan_logs"), {
                    userId: user.uid,
                    companyName: companyName,     // ★ 요청하신 업체명
                    deviceMode: deviceMode,
                    startTime: serverTimestamp(), // ★ 시작 시간
                    endTime: null,
                    status: 'started',            // ★ 상태: 시작됨
                    resultSummary: null
                });

                // 생성된 로그 ID 저장 (나중에 완료 처리할 때 씀)
                this.currentLogId = newLogRef.id;

                console.log(`[Log] 시작 로그 생성됨 (ID: ${newLogRef.id})`);
                return true;

            } catch (e) {
                console.error("로그 생성 또는 차감 실패:", e);
                return false;
            }
        },

        async endLogTransaction(status, errorMessage = null) {
            if (!this.currentLogId) return; // 시작 로그가 없으면 무시

            try {
                const logRef = doc(db, "scan_logs", this.currentLogId);

                await updateDoc(logRef, {
                    status: status,               // ★ 상태: completed 또는 error
                    endTime: serverTimestamp(),   // ★ 종료 시간
                    errorMessage: errorMessage    // 에러일 경우 사유 기록
                });

                console.log(`[Log] 로그 업데이트 완료 (Status: ${status})`);

                // 초기화
                this.currentLogId = null;

            } catch (e) {
                console.error("로그 마무리에 실패했습니다:", e);
            }
        },

        async checkQuota() {
            // 관리자면 무사통과
            if (State.userRole === 'admin') return true;

            try {
                const user = auth.currentUser;
                if (!user) return false;

                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    const currentQuota = userData.quota || 0;

                    if (currentQuota <= 0) {
                        await CustomUI.alert("🚫 잔여 검사 횟수가 부족합니다.\n관리자에게 충전을 문의하세요.");
                        return false; // 횟수 부족
                    }
                }
                return true; // 횟수 충분함
            } catch (e) {
                console.error("횟수 조회 실패:", e);
                await CustomUI.alert("서버 통신 오류로 횟수를 확인할 수 없습니다.");
                return false;
            }
        },

        async startIosScan() {
            ViewManager.updateProgress(5, "아이폰 백업 준비 중... (시간이 소요됩니다)");
            try {
                // 실제 검사 수행
                const rawData = await window.electronAPI.runIosScan(State.currentUdid);
                if (rawData.error) throw new Error(rawData.error);
                const data = Utils.transformIosData(rawData); //데이터 변환
                console.log("아이폰 분석 완료, 개인정보 보호를 위해 백업 파일을 삭제합니다..."); //분석 이후 PC에 남은 백업 파일 삭제 요청
                // await window.electronAPI.deleteIosBackup(State.currentUdid);
                this.finishScan(data); //결과 화면 렌더링
            } catch (error) {
                this.handleError(error);

                // 에러가 발생해도 백업이 남아있을 수 있으므로 삭제 시도
                if (State.currentUdid) {
                    await window.electronAPI.deleteIosBackup(State.currentUdid);
                }
            }
        },

        // [새로 추가] 스마트폰 화면을 초기 상태로 되돌리는 함수
        resetSmartphoneUI() {
        // 1. 안전하게 요소 찾기 (유지)
        const scanScreen = document.getElementById('scan-progress-screen');
        if (!scanScreen) return;
        const screen = scanScreen.querySelector('.phone-screen');
        if (!screen) return;

        // 2. 배경색 초기화 (finishScan이 칠한 녹색 배경 제거)
        screen.style.backgroundColor = ''; 

        const icon = screen.querySelector('.hack-icon');
        const alertText = screen.querySelector('.hack-alert');
        const statusList = screen.querySelector('div[style*="margin-top:20px"]');

        if (icon) {
            icon.className = 'hack-icon'; 
            
            // finishScan이 덧칠했던 '녹색 페인트'를 지우기
            icon.style.color = ''; 
            
        }

        // 3. 텍스트 초기화
        if (alertText) {
            // 문구 원복
            alertText.innerHTML = 'SYSTEM<br>SCANNING';
            
            // finishScan이 덧칠했던 '녹색 페인트'와 '녹색 그림자'를 지우기
            // 이 코드가 있어야 텍스트가 다시 원래의 파란색으로 돌아옴
            alertText.style.color = '';
            alertText.style.textShadow = '';
        }

        // 4. 하단 목록 초기화
        if (statusList) {
            statusList.innerHTML = `
                [!] 비정상 권한 접근 탐지...<br>
                [!] 실시간 프로세스 감시...<br>
                [!] AI 기반 지능형 위협 분석 중...`;
        }

        // 5. 입자 재활성화
        const particles = document.querySelectorAll('.data-particle');
        particles.forEach(p => {
            p.style.display = 'block';
            p.style.opacity = '1';
        });
        
        console.log("[UI] 스마트폰 화면이 초기 상태로 리셋되었습니다.");
    },

        finishScan(data) {
            this.endLogTransaction('completed');
            ViewManager.updateProgress(100, "분석 완료! 결과 리포트를 생성합니다.");
            this.toggleLaser(false);

            const particles = document.querySelectorAll('.data-particle');
            particles.forEach(p => {
                p.style.opacity = '0';
                p.style.display = 'none';
            });
            // 2. 스마트폰 내부 화면을 '안전' 상태로 즉시 변경
            const scanScreen = document.getElementById('scan-progress-screen');
            const phoneScreen = scanScreen ? scanScreen.querySelector('.phone-screen') : null;

            if (phoneScreen) {
                const icon = phoneScreen.querySelector('.hack-icon');
                const alertText = phoneScreen.querySelector('.hack-alert');
                const statusList = phoneScreen.querySelector('div[style*="margin-top:20px"]');

                // 배경색을 신뢰감 있는 짙은 색으로 변경
                phoneScreen.style.backgroundColor = '#0f172a';
                
                // 아이콘을 녹색 체크 표시로 변경
                if (icon) {
                    icon.style.color = '#27c93f'; 
                    icon.style.animation = 'none'; // 깜빡임 중지
                }
                
                // 문구 변경: SCANNING -> SAFE
                if (alertText) {
                    alertText.innerHTML = 'SCAN<br>COMPLETED';
                    alertText.style.color = '#27c93f';
                    alertText.style.textShadow = '0 0 15px rgba(39, 201, 63, 0.5)';
                }

                // 하단 상태 메시지 업데이트
                if (statusList) {
                    statusList.innerHTML = '<span style="color:#27c93f"> 보안 검사가 완료되었습니다.</span>';
                }
            }

            ViewManager.updateProgress(100, "분석 완료! 결과 리포트를 생성합니다.");
            State.lastScanData = data;
            window.lastScanData = data;

            setTimeout(() => {
                ResultsRenderer.render(data);
                ViewManager.showScreen(loggedInView, 'scan-results-screen');
            }, 1500); // 1초 뒤 결과 화면으로 전환
        },

        handleError(error) {
            console.error(error);
            this.endLogTransaction('error', error.message);
            const statusText = document.getElementById('scan-status-text');
            const statusBar = document.getElementById('progress-bar');
            if (statusText) statusText.textContent = "오류: " + error.message;
            if (statusBar) statusBar.style.backgroundColor = '#d9534f';
        }
    };

    // =========================================================
    // [7] 결과 렌더링 (RESULTS RENDERER) - iOS/Android 통합
    // =========================================================
    const ResultsRenderer = {
        render(data) {
            // 화면 초기화
            document.getElementById('results-dashboard-view').classList.remove('hidden');
            document.getElementById('app-detail-view').classList.add('hidden');

            // OS 판단 (데이터에 os 필드가 있다고 가정)
            const isIos = State.currentDeviceMode === 'ios'


            // 1. 기기 정보 바인딩
            document.getElementById('res-model').textContent = data.deviceInfo.model || 'Unknown';
            document.getElementById('res-serial').textContent = data.deviceInfo.serial || '-';
            document.getElementById('res-phone').textContent = data.deviceInfo.phoneNumber || '-';

            const rootEl = document.getElementById('res-root');

            // DOM 요소 참조 (지역 변수)
            const appGrid = document.getElementById('app-grid-container');
            const bgGrid = document.getElementById('bg-app-grid-container');
            const apkList = document.getElementById('res-apk-list');
            const mvtSection = document.getElementById('mvt-analysis-section');
            const androidDescEl = document.getElementById('android-app-list-description');
            const iosDescEl = document.getElementById('ios-app-list-description');

            // 2. 루팅/탈옥 상태 및 Android 멘트 가시성 제어
            if (isIos) {
                this.renderMvtAnalysis(data.mvtResults || {}, isIos);
                // MVT 경고가 renderMvtAnalysis 내에서 rootEl을 갱신합니다. (기본값: 안전함)
                if (androidDescEl) androidDescEl.classList.add('hidden');
                if (iosDescEl) iosDescEl.style.display = 'block';

            } else {
                // Android 모드일 때 루팅 체크
                rootEl.textContent = data.deviceInfo.isRooted ? '⚠️ 발견됨 (ROOTED)' : '✅ 안전함';
                rootEl.style.color = data.deviceInfo.isRooted ? '#D9534F' : '#5CB85C';

                // MVT 섹션 숨기기
                if (mvtSection) mvtSection.classList.add('hidden');
                if (androidDescEl) androidDescEl.classList.remove('hidden');
                if (iosDescEl) iosDescEl.style.display = 'none';
            }

            if (isIos) {
                // [iOS 모드]

                // 1. Android 전용 섹션들 숨기기
                if (bgGrid) bgGrid.closest('.content-card').style.display = 'none';
                if (apkList) apkList.closest('.content-card').style.display = 'none';

                // 2. '설치된 애플리케이션' 섹션 재활용 및 iOS용 렌더링
                if (appGrid) {
                    const appGridParent = appGrid.closest('.content-card');
                    if (appGridParent) appGridParent.style.display = 'block';

                    // 💡 [클래스 토글] Android 그리드 클래스 제거 (찌그러짐 방지)
                    appGrid.classList.remove('app-grid');

                    this.renderIosInstalledApps(data.allApps || [], appGrid);
                }

            } else {
                // [Android 모드]

                // 1. Android 전용 섹션들 표시
                if (bgGrid) bgGrid.closest('.content-card').style.display = 'block';
                if (apkList) apkList.closest('.content-card').style.display = 'block';

                // 2. '설치된 애플리케이션' 섹션 복구
                if (appGrid) {
                    const appGridParent = appGrid.closest('.content-card');
                    if (appGridParent) {
                        appGridParent.style.display = 'block';
                        appGridParent.querySelector('h3').innerHTML = `📲 설치된 애플리케이션  (${data.allApps.length}개)`;
                    }

                    // 💡 [클래스 토글] iOS 그리드 클래스가 있었다면 제거하고, Android 그리드 클래스 추가
                    appGrid.classList.remove('ios-app-list-grid');
                    appGrid.classList.add('app-grid');

                    // 3. 앱 목록 렌더링
                    appGrid.innerHTML = '';
                    data.allApps.forEach(app => this.createAppIcon(app, appGrid));
                }

                // 4. 백그라운드 앱 목록 렌더링 (bgGrid)
                if (bgGrid) {
                    bgGrid.innerHTML = '';
                    // 💡 data.allApps에서 필터링
                    const runningApps = data.allApps ? data.allApps.filter(app => app.isRunningBg) : [];

                    bgGrid.closest('.content-card').querySelector('h3').innerHTML = `🚀 백그라운드 실행 중인 앱  (${runningApps.length}개)`;
                    if (runningApps.length > 0) {
                        runningApps.forEach(app => this.createAppIcon(app, bgGrid));
                    } else {
                        bgGrid.innerHTML = '<p class="sub-text" style="padding: 10px;">백그라운드에서 실행 중인 의심스러운 애플리케이션이 탐지되지 않았습니다.</p>';
                    }
                }

                // 5. APK 파일 목록 렌더링 (apkList)
                apkList.closest('.content-card').querySelector('h3').innerHTML = `📂 발견된 설치 파일  (${data.apkFiles.length}개)`;
                if (apkList) {
                    apkList.innerHTML = data.apkFiles && data.apkFiles.length > 0
                        ? data.apkFiles.map(f => `<li>${f}</li>`).join('')
                        : '<li>없음</li>';
                }
            }

            // 5. 의심 앱 리스트 (MVT 경고 포함된 최종 목록 표시)
            this.renderSuspiciousList(data.suspiciousApps, isIos);
        },

        // -------------------------------------------------
        // [NEW] MVT 상세 분석 렌더링 함수 (iOS 전용)
        // -------------------------------------------------
        renderMvtAnalysis(mvtResults, isIos) {
            const mvtSection = document.getElementById('mvt-analysis-section');
            const mvtContainer = document.getElementById('mvt-analysis-container');

            // Android일 경우 숨기기
            if (!isIos) {
                if (mvtSection) mvtSection.classList.add('hidden');
                return;
            }

            // iOS일 경우 표시
            if (mvtSection) mvtSection.classList.remove('hidden');
            if (!mvtContainer) return;

            // MVT 5대 핵심 영역 정의
            const sections = [
                { id: 'web', title: '🌐 1. 브라우저 및 웹 활동', files: 'History.db, Favicons.db, WebKit 데이터' },
                // ... (나머지 4개 섹션 유지) ...
                { id: 'messages', title: '💬 2. 메시지 및 통신 기록', files: 'sms.db, ChatStorage.sqlite' },
                { id: 'system', title: '⚙️ 3. 시스템 로그 및 프로세스 활동', files: 'DataUsage.sqlite, Crash Reports' },
                { id: 'apps', title: '🗂️ 4. 설치된 앱 및 프로파일', files: 'Manifest.db, Profiles' },
                { id: 'artifacts', title: '📁 5. 기타 시스템 파일', files: 'shutdown.log, LocalStorage' }
            ];

            let html = '';

            sections.forEach(section => {
                const result = mvtResults[section.id] || { status: 'safe', warnings: [] };
                const isWarning = result.warnings && result.warnings.length > 0;
                const statusText = isWarning ? '경고 발견' : '안전';
                const statusClass = isWarning ? 'status-warning' : 'status-safe';

                const contentStyle = isWarning ? 'display: block;' : 'display: none;';

                let warningList = '';
                if (isWarning) {
                    // 경고 항목에 포렌식 느낌의 폰트/색상 강조
                    warningList = result.warnings.map(warning => `
                    <li style="color:#D9534F; margin-bottom:5px; font-size:13px; font-family: monospace;">
                        <span style="font-weight:bold;">[IOC Match]</span> ${warning}
                    </li>
                `).join('');
                    warningList = `<ul style="list-style:disc; padding-left:20px; margin-top:10px; margin-bottom:0;">${warningList}</ul>`;
                }

                // 
                html += `
                <div class="analysis-section" data-status="${isWarning ? 'warning' : 'safe'}" style="margin-bottom:12px; border-left: 4px solid ${isWarning ? '#f57c00' : '#4caf50'};">
                    <div class="analysis-header" onclick="toggleAnalysis(this)" style="padding:15px; background-color:${isWarning ? '#fffde7' : '#fafafa'}; transition: background-color 0.2s;">
                        <span style="font-size: 15px; font-weight: 700;">${section.title}</span>
                        <div style="display:flex; align-items:center;">
                             <span style="font-size: 12px; margin-right: 10px; color: #888;">주요 검사 파일: <code>${section.files.split(',')[0].trim()}...</code></span>
                            <span class="analysis-status ${statusClass}">${statusText} (${result.warnings ? result.warnings.length : 0}건)</span>
                        </div>
                    </div>
                    <div class="analysis-content" style="${contentStyle} padding: 15px 15px 5px 15px;">
                        <p style="margin-bottom:10px; font-weight:500;">
                            **[${isWarning ? '위협 경로' : '검사 완료'}]** ${isWarning
                        ? `MVT는 이 영역에서 ${result.warnings.length}건의 알려진 스파이웨어 흔적(IOC)과 일치하는 항목을 발견했습니다.`
                        : `MVT 분석 엔진은 이 영역의 데이터베이스(${section.files})에서 특이사항을 발견하지 못했습니다.`
                    }
                        </p>
                        ${warningList}
                    </div>
                </div>
            `;
            });

            mvtContainer.innerHTML = html;

            // 모든 MVT 경고 수를 합산하여 기기 정보 영역(res-root) 업데이트
            const totalMvtWarnings = sections.reduce((sum, section) => {
                const result = mvtResults[section.id];
                return sum + (result && result.warnings ? result.warnings.length : 0);
            }, 0);

            const rootEl = document.getElementById('res-root');
            if (rootEl && totalMvtWarnings > 0) {
                rootEl.textContent = `⚠️ 경고 발견 (${totalMvtWarnings}건)`;
                rootEl.style.color = '#D9534F';
            } else if (rootEl) {
                rootEl.textContent = '✅ 안전함'; // 경고가 없다면 안전함으로 복구
                rootEl.style.color = '#5CB85C';
            }
        },

        // -------------------------------------------------
        // [NEW] iOS 설치된 앱 목록 렌더링 (Android 그리드 자리에 표시)
        // -------------------------------------------------
        renderIosInstalledApps(apps, container) { // container는 render 함수에서 받은 appGrid입니다.
            if (!container) return;

            const totalApps = apps.length;

            // 1. 제목 업데이트 (container를 기준으로 찾음)
            const parentHeader = container.closest('.content-card')?.querySelector('h3');
            if (parentHeader) {
                parentHeader.innerHTML = `📲 검사 대상 애플리케이션 목록 (총 ${totalApps}개)`;
            }

            // 2. iOS 전용 멘트 표시 (이미 render 함수에서 display:block 처리됨)
            const descEl = document.getElementById('ios-app-list-description');
            if (descEl) {
                descEl.innerHTML = `MVT 분석은 아래 목록에 포함된 **${totalApps}개의 앱 데이터베이스 및 파일 흔적**을 검사하는 데 활용되었습니다.`;
            }

            container.innerHTML = '';

            if (totalApps === 0) {
                container.innerHTML = '<p style="color:#888; padding:10px;">앱 목록 정보가 확인되지 않았습니다.</p>';
                return;
            }

            // 3. 앱 목록 렌더링: CSS 클래스만 사용 (찌그러짐 방지용)
            const sortedApps = [...apps].sort((a, b) => (a.cachedTitle || a.packageName).localeCompare(b.cachedTitle || b.packageName));

            let listHtml = '<div class="ios-app-list-grid">'; // CSS 클래스 사용

            sortedApps.forEach(app => {
                const displayName = app.cachedTitle || Utils.formatAppName(app.packageName);
                listHtml += `
                <div class="ios-app-item">
                    <strong class="app-title">${displayName}</strong>
                    <span class="app-package">${app.packageName}</span>
                </div>
            `;
            });
            listHtml += '</div>';

            container.innerHTML = listHtml;
        },

        // 아이콘 생성 로직 (Android 전용 - 기존 코드 유지)
        createAppIcon(app, container) {
            const div = document.createElement('div');
            const isSuspicious = app.reason ? true : false;
            div.className = `app-item ${isSuspicious ? 'suspicious' : ''}`;

            const initialName = app.cachedTitle || Utils.formatAppName(app.packageName);

            div.innerHTML = `
                <div class="app-icon-wrapper">
                    <img src="" class="app-real-icon" style="display:none;" alt="${initialName}">
                    <span class="app-fallback-icon" style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:24px;">📱</span>
                </div>
                <div class="app-display-name">${initialName}</div>
                <div class="app-package-sub">${app.packageName}</div>
            `;

            const imgTag = div.querySelector('.app-real-icon');
            const spanTag = div.querySelector('.app-fallback-icon');

            const getLocalIconPath = (appData) => {
                if (appData.reason) return './assets/SpyAppLogo.png';
                return './assets/systemAppLogo.png';
            };

            const handleImageError = (isLocalFallback = false) => {
                if (isLocalFallback) {
                    imgTag.style.display = 'none';
                    spanTag.style.display = 'flex';
                    return;
                }
                const localPath = getLocalIconPath(app);
                if (localPath) {
                    imgTag.src = localPath;
                    imgTag.style.display = 'block';
                    spanTag.style.display = 'none';
                    imgTag.onerror = () => handleImageError(true);
                } else {
                    handleImageError(true);
                }
            };

            imgTag.onerror = () => handleImageError(false);

            if (app.cachedIconUrl) {
                imgTag.src = app.cachedIconUrl;
                imgTag.style.display = 'block';
                spanTag.style.display = 'none';
            } else if (!app.cachedIconUrl || !app.cachedTitle) {
                window.electronAPI.getAppData(app.packageName).then(result => {
                    if (!result || !result.icon) {
                        handleImageError(false);
                        return;
                    }
                    app.cachedIconUrl = result.icon;
                    imgTag.src = result.icon;
                    imgTag.onload = () => {
                        imgTag.style.display = 'block';
                        spanTag.style.display = 'none';
                    };
                    if (result.title) {
                        app.cachedTitle = result.title;
                        div.querySelector('.app-display-name').textContent = result.title;
                    }
                }).catch(() => {
                    handleImageError(false);
                });
            }

            div.addEventListener('click', () => {
                AppDetailManager.show(app, div.querySelector('.app-display-name').textContent);
            });

            container.appendChild(div);
        },

        // 위협 리스트 렌더링 (iOS/Android 공통 - 로직 개선)
        renderSuspiciousList(suspiciousApps, isIos = false) {
            const suspList = document.getElementById('suspicious-list-container');

            // iOS일 때 제목 변경 (DOM 구조에 따라 h3가 바로 위에 있다고 가정)
            const headerElement = suspList.previousElementSibling;
            if (headerElement && headerElement.tagName === 'H3') {
                headerElement.textContent = isIos ? "🚨 정밀 분석 결과" : "🚨 정밀 분석 결과";
            }

            if (suspiciousApps && suspiciousApps.length > 0) {
                let html = '<ul style="list-style:none; padding:0;">';
                suspiciousApps.forEach(app => {
                    // 앱 이름/타이틀 결정
                    const dName = app.cachedTitle || Utils.formatAppName(app.packageName);
                    const reason = app.reason || "알 수 없는 위협";

                    // 뱃지 표시 (VT 또는 MVT)
                    let vtBadge = '';
                    if (app.vtResult && app.vtResult.malicious > 0) {
                        vtBadge = `<span style="background:#d9534f; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🦠 VT: ${app.vtResult.malicious}</span>`;
                    } else if (isIos) {
                        vtBadge = `<span style="background:#0275d8; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🛡️ MVT 탐지</span>`;
                    }

                    // 해시값 표시 (iOS인 경우에만 보이게 처리하거나 항상 보이게 할 수도 있음)
                    const hashInfo = (isIos && app.hash && app.hash !== 'N/A')
                        ? `<div style="font-size:11px; color:#888; margin-top:4px; font-family:monospace;">Hash: ${app.hash}</div>`
                        : '';

                    html += `
                        <li style="padding:15px; border-bottom:1px solid #eee; border-left: 4px solid #D9534F; background-color: #fff5f5; margin-bottom: 10px; border-radius: 4px;">
                            <div style="color:#D9534F; font-weight:bold; font-size: 15px; margin-bottom: 4px;">
                                🚨 ${dName} ${vtBadge} <span style="font-size:12px; font-weight:normal; color:#888;">(${app.packageName})</span>
                            </div>
                            <div style="font-size:13px; color:#555;">${reason}</div>
                            ${hashInfo}
                        </li>`;
                });
                suspList.innerHTML = html + '</ul>';
            } else {
                // 안전할 때 메시지 (iOS/Android 구분)
                const safeMessage = isIos
                    ? '정밀 분석 결과, 알려진 스파이웨어 흔적이 발견되지 않았습니다.'
                    : '탐지된 스파이앱이 없습니다.';

                suspList.innerHTML = `
                    <div style="text-align:center; padding:30px; background:#f8f9fa; border-radius:8px;">
                        <div style="font-size:40px; margin-bottom:10px;">✅</div>
                        <h3 style="color:#5CB85C; margin:0 0 5px 0;">안전함 (Clean)</h3>
                        <p style="color:#666; font-size:14px; margin:0;">${safeMessage}</p>
                    </div>
                `;
            }
        }
    };

    // =========================================================
    // [8] 앱 상세 화면 (APP DETAIL MANAGER)
    // =========================================================
    const AppDetailManager = {
        lastScrollY: 0,

        show(app, displayName) {

            const scrollContainer = document.querySelector('#logged-in-view .main-content'); // 스크롤이 생기는 박스
            const permissionsDetailList = document.querySelector('.permission-list-container');

            if (scrollContainer) {

                console.log("실행됌?")
                this.lastScrollY = scrollContainer.scrollTop;
            }

            console.log(this.lastScrollY)
            document.getElementById('results-dashboard-view').classList.add('hidden');
            document.getElementById('app-detail-view').classList.remove('hidden');

            if (scrollContainer) {

                scrollContainer.scrollTop = 0;
                permissionsDetailList.scrollTop = 0;
            }

            // 1. 이름 표시 (캐시된 타이틀 우선, 없으면 넘겨받은 이름)
            const finalName = app.cachedTitle || displayName;
            document.getElementById('detail-app-name').textContent = finalName;

            // 나머지 텍스트 정보 채우기
            document.getElementById('detail-package-name').textContent = app.packageName;
            document.getElementById('detail-sideload').textContent = app.origin || (app.isSideloaded ? '외부 설치' : '공식 스토어');
            document.getElementById('detail-bg').textContent = app.isRunningBg ? '실행 중' : '중지됨';
            document.getElementById('detail-req-count').textContent = app.requestedCount || 0;
            document.getElementById('detail-grant-count').textContent = app.grantedCount || 0;

            // 2. 아이콘 DOM 초기화
            const iconWrapper = document.querySelector('.detail-icon-wrapper');
            iconWrapper.innerHTML = `
        <img class="detail-real-img" src="" style="width:100%; height:100%; object-fit:cover; display:none; border-radius: 12px;">
        <span class="detail-fallback-span" style="font-size:32px;">📱</span>
    `;
            const img = iconWrapper.querySelector('.detail-real-img');
            const span = iconWrapper.querySelector('.detail-fallback-span');

            const setLocalFallbackIcon = () => {
                // 💡 assets/systemAppLogo.png 경로를 사용하여 이미지 설정
                img.src = './assets/systemAppLogo.png';
                img.style.display = 'block';
                span.style.display = 'none';

                // 로컬 폴백 이미지 로드 실패 시, 최종적으로 '📱' 이모지로 전환
                img.onerror = () => {
                    img.style.display = 'none';
                    span.style.display = 'flex';
                };
            };

            // [Case A] 캐시된 아이콘이 있으면 즉시 표시
            if (app.cachedIconUrl) {
                img.src = app.cachedIconUrl;
                img.style.display = 'block';
                span.style.display = 'none';
            } else {

                setLocalFallbackIcon();
            }

            // [Case B] 정보가 부족하면 API 요청
            // (아이콘이 없거나 타이틀이 없으면 요청 시도)
            if ((!app.cachedIconUrl || !app.cachedTitle)) {
                window.electronAPI.getAppData(app.packageName).then(result => {
                    if (!result) return;

                    // [A] 아이콘 처리 (독립적)
                    if (result.icon) {
                        app.cachedIconUrl = result.icon; // 캐싱
                        img.src = result.icon;
                        img.onload = () => {
                            img.style.display = 'block';
                            span.style.display = 'none';
                        };
                    }

                    // [B] 타이틀 처리 (독립적)
                    if (result.title) {
                        app.cachedTitle = result.title; // 캐싱
                        document.getElementById('detail-app-name').textContent = result.title;
                    }
                }).catch(() => { });
            }

            // 버튼 및 기타 정보 설정 (기존과 동일)
            this.setupActionButton('uninstall-btn', "🗑️ 앱 강제 삭제", app, displayName);
            this.setupActionButton('neutralize-btn', "🛡️ 무력화 (권한 박탈)", app, displayName);

            const usage = app.dataUsage || { rx: 0, tx: 0 };
            const total = usage.rx + usage.tx;
            const netEl = document.getElementById('detail-network');
            netEl.innerHTML = `총 ${Utils.formatBytes(total)}<br><span style="font-size:12px; color:#888;">(수신: ${Utils.formatBytes(usage.rx)} / 송신: ${Utils.formatBytes(usage.tx)})</span>`;

            const list = document.getElementById('detail-permission-list');
            list.innerHTML = '';
            if (app.requestedList && app.requestedList.length > 0) {
                app.requestedList.forEach(perm => {
                    const isGranted = app.grantedList.includes(perm);
                    const spanElem = document.createElement('span');
                    spanElem.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                    spanElem.textContent = (isGranted ? '✅ ' : '🚫 ') + Utils.getKoreanPermission(perm);
                    list.appendChild(spanElem);
                });
            } else {
                list.innerHTML = '<p style="color:#999; padding:5px;">요청된 권한이 없습니다.</p>';
            }

            document.getElementById('app-detail-view').scrollTo({ top: 0 });
        },

        setupActionButton(btnId, text, app, appName) {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.dataset.package = app.packageName;
                btn.dataset.appName = appName;
                btn.disabled = false;
                btn.textContent = text;
            }
        }

    };

    // 뒤로가기 버튼
    document.getElementById('back-to-dashboard-btn')?.addEventListener('click', () => {
        document.getElementById('app-detail-view').classList.add('hidden');
        document.getElementById('results-dashboard-view').classList.remove('hidden');

        const scrollContainer = document.querySelector('#logged-in-view .main-content');
        if (scrollContainer) {
            // 약간의 딜레이를 주어야 화면 렌더링 후 정확히 이동함 (없어도 되면 빼도 됨)
            // scrollContainer.scrollTop = AppDetailManager.lastScrollY; 

            // 부드럽게 말고 '즉시' 이동하는게 UX상 더 자연스러울 때가 많음
            scrollContainer.scrollTo(0, AppDetailManager.lastScrollY);
        }
    });

    // =========================================================
    // [9] 액션 핸들러 (삭제/무력화/인쇄)
    // =========================================================

    // 1. 앱 삭제
    const uninstallBtn = document.getElementById('uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', async () => {
            const { package: packageName, appName } = uninstallBtn.dataset;
            if (!packageName) return;

            // 기존: if (!confirm(...)) return;
            if (!await CustomUI.confirm(`[경고] 정말로 '${appName}' 앱을 삭제하시겠습니까?\n\n패키지명: ${packageName}`)) return;

            // ... (중간 생략) ...

            try {
                const result = await window.electronAPI.uninstallApp(packageName);
                if (result.success) {
                    await CustomUI.alert(result.message); // alert 대체
                    document.getElementById('back-to-dashboard-btn').click();
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                await CustomUI.alert(`삭제 실패: ${err.message}\n\n[기기 관리자 해제 필요] 설정 > 보안 > 기기 관리자 앱에서 '${appName}' 체크 해제 후 다시 시도하세요.`);
            } finally {
                uninstallBtn.disabled = false;
                uninstallBtn.textContent = "🗑️ 앱 강제 삭제";
            }
        });
    }

    // 2. 무력화
    const neutralizeBtn = document.getElementById('neutralize-btn');
    if (neutralizeBtn) {
        neutralizeBtn.addEventListener('click', async () => {
            const { package: packageName, appName } = neutralizeBtn.dataset;
            if (!packageName) return;

            if (!await CustomUI.confirm(`[주의] '${appName}' 앱의 모든 권한을 회수하고 강제 종료하시겠습니까?`)) return;

            neutralizeBtn.disabled = true;
            neutralizeBtn.textContent = "무력화 중...";

            try {
                const result = await window.electronAPI.neutralizeApp(packageName);
                if (result.success) {
                    await CustomUI.alert(`✅ 무력화 성공!\n총 ${result.count}개의 권한을 박탈했습니다.`);
                    document.getElementById('back-to-dashboard-btn').click();
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                await CustomUI.alert(`무력화 실패: ${err.message}`);
            } finally {
                neutralizeBtn.disabled = false;
                neutralizeBtn.textContent = "🛡️ 무력화 (권한 박탈)";
            }
        });
    }

    function formatAppName(packageName) {
        if (!packageName) return "Unknown";
        const parts = packageName.split('.');
        let name = parts[parts.length - 1];
        if ((name === 'android' || name === 'app') && parts.length > 1) {
            name = parts[parts.length - 2];
        }
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    const saveResultsBtn = document.getElementById('save-results-btn');
    if (saveResultsBtn) {
        saveResultsBtn.addEventListener('click', async () => {
            if (!State.lastScanData) {
                await CustomUI.alert("저장할 데이터가 없습니다.");
                return;
            }

            saveResultsBtn.disabled = true;
            saveResultsBtn.textContent = "저장 중...";

            try {
                const result = await window.electronAPI.saveScanResult(State.lastScanData);
                if (result.success) {
                    await CustomUI.alert(result.message);
                } else {
                    await CustomUI.alert(`저장 실패: ${result.error || result.message}`);
                }
            } catch (error) {
                await CustomUI.alert(`로컬 저장 오류: ${error.message}`);
            } finally {
                saveResultsBtn.disabled = false;
                saveResultsBtn.textContent = "💾 로컬 저장";
            }
        });
    }

    // 3. 인쇄
    const printResultsBtn = document.getElementById('print-results-btn');
    if (printResultsBtn) {
        printResultsBtn.addEventListener('click', () => {
            if (!window.lastScanData) {
                alert("인쇄할 검사 결과가 없습니다.");
                return;
            }

            const data = window.lastScanData;
            const isIos = State.currentDeviceMode === 'ios';

            // --- [1] 검사자 및 고객 정보 (Client Info Form에서 가져옴) ---
            // 익명 처리된 값 가져오기 (폼 값이 익명 처리 값일 경우 그대로 출력)
            const clientName = document.getElementById('client-name').value || "익명";
            const clientDob = document.getElementById('client-dob').value || "0000-00-00";
            const clientPhone = document.getElementById('client-phone').value || "000-0000-0000";

            // 익명/기본값 체크 헬퍼
            const isAnonName = clientName === '익명 사용자';
            const isAnonDob = clientDob === '0001-01-01';
            const isAnonPhone = clientPhone === '000-0000-0000';

            // --- [2] DOM 바인딩 ---

            // 1. 헤더 정보 및 업체명
            const now = new Date();
            const dateStr = now.toLocaleString('ko-KR');
            document.getElementById('print-date').textContent = dateStr;
            document.getElementById('print-doc-id').textContent = `BD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

            // 💡 [수정] 검사 업체명 바인딩 (State에서 가져옴)
            document.getElementById('print-agency-name').textContent = State.agencyName;

            // 💡 [추가] 검사자 정보 테이블 바인딩
            const examinerTable = document.getElementById('print-examiner-info');
            if (examinerTable) {
                examinerTable.innerHTML = `
                <tr>
                    <th>검사자 이름</th>
                    <td>${isAnonName ? '익명 처리' : clientName}</td>
                    <th>생년월일</th>
                    <td>${isAnonDob ? '익명 처리' : clientDob}</td>
                </tr>
                <tr>
                    <th>전화번호</th>
                    <td colspan="3">${isAnonPhone ? '익명 처리' : clientPhone}</td>
                </tr>
            `;
            }

            // 3. 기기 정보
            document.getElementById('print-model').textContent = data.deviceInfo.model;
            document.getElementById('print-serial').textContent = data.deviceInfo.serial;
            document.getElementById('print-root').textContent = isIos ? '판단불가 (MVT)' : (data.deviceInfo.isRooted ? '발견됨 (위험)' : '안전함');
            document.getElementById('print-phone').textContent = data.deviceInfo.phoneNumber;

            // 4. 종합 판정 및 통계
            const threatCount = data.suspiciousApps.length;
            const summaryBox = document.getElementById('print-summary-box');

            if (threatCount > 0) {
                summaryBox.className = 'summary-box status-danger';
                summaryBox.innerHTML = `⚠️ 위험 (DANGER): 총 ${threatCount}개의 스파이앱이 탐지되었습니다.`;
            } else {
                summaryBox.className = 'summary-box status-safe';
                summaryBox.innerHTML = `✅ 안전 (SAFE): 스파이앱이 탐지 되지 않앗습니다.`;
            }

            document.getElementById('print-total-count').textContent = data.allApps.length;
            document.getElementById('print-threat-count').textContent = threatCount;
            document.getElementById('print-file-count').textContent = data.apkFiles.length;


            // 5. 위협 탐지 내역 (표)
            const threatContainer = document.getElementById('print-threat-container');
            if (threatCount > 0) {
                let html = `<table class="detail-table"><thead><tr><th>탐지된 앱</th><th>패키지명</th><th>탐지 사유</th></tr></thead><tbody>`;
                data.suspiciousApps.forEach(app => {
                    let vtInfo = '';
                    // iOS MVT 결과도 suspiciousApps에 포함되어 있으므로, isMvt 플래그나 hash 존재 여부로 MVT 결과임을 명시할 수 있습니다.
                    if (app.hash && app.hash !== 'N/A') {
                        vtInfo = `<br><span style="color:#0275d8; font-size:9px;">[MVT Artifact]</span>`;
                    } else if (app.vtResult && app.vtResult.malicious > 0) {
                        vtInfo = `<br><span style="color:red; font-size:9px;">[VT 탐지: ${app.vtResult.malicious}/${app.vtResult.total}]</span>`;
                    }
                    html += `<tr>
                    <td class="text-danger" style="font-weight:bold;">${formatAppName(app.packageName)}</td>
                    <td>${app.packageName}</td>
                    <td>${app.reason || '불명확'}${vtInfo}</td>
                </tr>`;
                });
                html += `</tbody></table>`;
                threatContainer.innerHTML = html;
            } else {
                threatContainer.innerHTML = `<div style="padding:10px; border:1px solid #ccc; text-align:center; color:#5CB85C;">탐지된 스파이앱 없음</div>`;
            }


            // 6. APK 파일 리스트 섹션 제어 (iOS 숨김 처리)
            const fileSection = document.getElementById('print-file-system-section');
            const fileBody = document.getElementById('print-file-body');

            if (isIos) {
                // 💡 [수정] iOS일 경우 파일 시스템 분석 섹션 전체 숨김
                if (fileSection) fileSection.style.display = 'none';
            } else {
                // Android일 경우 섹션 표시
                if (fileSection) fileSection.style.display = 'block';

                // APK 목록 바인딩
                if (data.apkFiles.length > 0) {
                    fileBody.innerHTML = data.apkFiles.map((f, i) => `<tr><td style="text-align:center;">${i + 1}</td><td>${f}</td></tr>`).join('');
                } else {
                    fileBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#999;">발견된 파일 없음</td></tr>`;
                }
            }


            // 7. [부록] 전체 앱 목록 (Android 전용 앱 목록 표시 로직 유지)
            const printArea = document.getElementById('printable-report');
            // 💡 [추가] 부록 섹션 제목을 조건부로 변경할 요소 참조 (index.html에 h3 태그라고 가정)
            const appendixHeader = document.querySelector('#printable-report .print-page:last-child h3.section-heading');

            if (isIos) {
                // 💡 [수정] iOS일 경우 5번 섹션 숨김 (기존 로직)
                const fileSection = document.getElementById('print-file-system-section');
                if (fileSection) fileSection.style.display = 'none';

                // 💡 [수정] iOS일 경우 부록 섹션 번호를 6번에서 5번으로 변경
                if (appendixHeader) {
                    appendixHeader.textContent = appendixHeader.textContent.replace(/^6\./, '5.');
                }
            } else {
                // Android일 경우 섹션 표시
                const fileSection = document.getElementById('print-file-system-section');
                if (fileSection) fileSection.style.display = 'block';

                // Android일 경우 부록 섹션 번호를 6번으로 유지
                if (appendixHeader) {
                    appendixHeader.textContent = appendixHeader.textContent.replace(/^5\./, '6.');
                }
                // ... (기존 APK 목록 바인딩 로직 유지) ...
            }

            const appGrid = document.getElementById('print-all-apps-grid');
            appGrid.innerHTML = '';

            // 이름순 정렬
            const sortedApps = [...data.allApps].sort((a, b) => a.packageName.localeCompare(b.packageName));

            sortedApps.forEach(app => {

                const div = document.createElement('div');

                if (app.reason) {
                    // 1순위: 위협 앱 (빨간색)
                    div.className = 'compact-item compact-threat';
                } else if (app.isSideloaded) {
                    // 2순위: 사이드로딩 앱 (회색)
                    div.className = 'compact-item compact-sideload';
                } else {
                    // 3순위: 일반 앱 (흰색)
                    div.className = 'compact-item';
                }

                // 앱 이름 표시 (위협이면 앞에 [위협] 표시)
                const prefix = app.reason ? '[위협] ' : (app.isSideloaded ? '[외부] ' : '');
                div.textContent = `${prefix}${formatAppName(app.packageName)} (${app.packageName})`;

                appGrid.appendChild(div);
            });

            setTimeout( async () => {
                window.print();
                printArea.style.display = 'none';

                // 💡 [복구] 인쇄 후 섹션 번호를 원래대로 복구 (다음 검사를 위해)
                if (appendixHeader) {
                    appendixHeader.textContent = appendixHeader.textContent.replace(/^[56]\./, '6.');
                }
                const fileSection = document.getElementById('print-file-system-section');
                if (fileSection) fileSection.style.display = 'block';


                if (State.currentDeviceMode === 'android') {
                    console.log("인쇄 완료 후 휴대폰 자동 전송 시작...");
                    
                    // 메인 프로세스에 PDF 생성 및 전송 요청 (무조건 실행)
                    const result = await window.electronAPI.autoPushReportToAndroid();

                    if (result.success) {
                        // 성공 시 사용자에게 알림 (선택 사항)
                        CustomUI.alert(`✅ 휴대폰 전송 완료!\n\n리포트가 휴대폰의 [Download] 폴더에\n자동으로 저장되었습니다.`);
                    } else {
                        // 실패 시 로그만 출력하거나 필요 시 알림
                        console.error("휴대폰 자동 전송 실패:", result.error);
                    }
                }
                
            }, 500);
        });
    }

    // =========================================================
    // [10] 검사 시간 임의 설정
    // =========================================================

    const adminTriggers = document.querySelectorAll('.app-title');
    const adminModal = document.getElementById('admin-modal');
    const adminContent = document.querySelector('.modal-content'); // ★ 내용물 박스 선택
    const adminInput = document.getElementById('admin-input');
    const adminSaveBtn = document.getElementById('admin-save-btn');
    const adminCancelBtn = document.getElementById('admin-cancel-btn');

    // 모달 닫기 함수
    const closeAdminModal = () => {
        if (adminModal) adminModal.classList.add('hidden');
    };

    // 저장 로직 (함수로 분리)
    const handleAdminSave = async () => {
        const val = adminInput.value;
        if (!val && val !== '0') {
            await CustomUI.alert("값을 입력하세요.");
            return;
        }

        const min = parseInt(val, 10);
        let message = "";

        if (min === 0) {
            message = "설정 해제: 즉시 완료 모드";
        } else if (min < 10 || min > 60) {
            await CustomUI.alert("시간은 10분 ~ 60분 사이로 설정해주세요.");
            return;
        } else {
            message = `✅ 설정됨: 안드로이드 검사 시간 [${min}분]`;
        }

        // 1. 현재 로그인한 유저 확인
        const user = auth.currentUser;
        if (!user) {
            await CustomUI.alert("오류: 로그인 정보를 찾을 수 없습니다.");
            return;
        }

        // 2. UI 즉시 반영
        State.androidTargetMinutes = min;

        adminSaveBtn.textContent = "저장 중...";
        adminSaveBtn.disabled = true;

        try {
            // ★★★ [수정됨] 공용 설정(settings/config)이 아니라 내 계정(users/uid)을 수정 ★★★
            const docRef = doc(db, "users", user.uid);

            await updateDoc(docRef, {
                android_scan_duration: min // 필드명 통일
            });

            await CustomUI.alert(`${message}\n(서버 계정 정보에도 저장되었습니다)`);
            closeAdminModal();

        } catch (error) {
            console.error("저장 실패:", error);
            // 만약 문서가 없어서 에러가 나면 setDoc으로 시도하거나 알림
            await CustomUI.alert(`⚠️ 저장 실패: ${error.message}`);
            closeAdminModal();
        } finally {
            adminSaveBtn.textContent = "저장";
            adminSaveBtn.disabled = false;
        }
    };

    if (adminTriggers.length > 0 && adminModal) {
        console.log(`✅ 히든 메뉴 시스템 활성화됨`);

        // 더블클릭 트리거
        adminTriggers.forEach(trigger => {
            trigger.style.userSelect = 'none';
            trigger.style.cursor = 'default';

            trigger.addEventListener('dblclick', async () => {
                // 로그인 & 상태 체크 (기존과 동일)
                const loggedInView = document.getElementById('logged-in-view');
                if (!loggedInView.classList.contains('active')) return;

                const progressScreen = document.getElementById('scan-progress-screen');
                if (progressScreen && progressScreen.classList.contains('active')) {
                    await CustomUI.alert("🚫 검사 중에는 변경 불가"); return;
                }
                const resultScreen = document.getElementById('scan-results-screen');
                if (resultScreen && resultScreen.classList.contains('active')) {
                    await CustomUI.alert("🚫 결과 화면에서는 변경 불가"); return;
                }

                // 현재 값 채우기
                adminInput.value = State.androidTargetMinutes || 0;
                adminModal.classList.remove('hidden');
                adminInput.focus();
            });
        });

        // 저장 버튼 이벤트 교체
        const newSaveBtn = adminSaveBtn.cloneNode(true);
        adminSaveBtn.parentNode.replaceChild(newSaveBtn, adminSaveBtn);
        newSaveBtn.addEventListener('click', handleAdminSave);

        // 취소 버튼
        const newCancelBtn = adminCancelBtn.cloneNode(true);
        adminCancelBtn.parentNode.replaceChild(newCancelBtn, adminCancelBtn);
        newCancelBtn.addEventListener('click', closeAdminModal);

        // 드래그 닫힘 방지
        if (adminContent) {
            adminContent.addEventListener('click', (e) => e.stopPropagation());
        }
        // 배경 클릭 닫기
        adminModal.addEventListener('click', (e) => {
            if (e.target === adminModal) closeAdminModal();
        });

    } else {
        console.warn('❌ 히든 메뉴 요소 찾기 실패');
    }
    // =========================================================
    // [11] 유틸리티 (UTILS)
    // =========================================================
    const Utils = {
        formatAppName(packageName) {
            if (!packageName) return "Unknown";
            const parts = packageName.split('.');
            let name = parts[parts.length - 1];
            if ((name === 'android' || name === 'app') && parts.length > 1) name = parts[parts.length - 2];
            return name.charAt(0).toUpperCase() + name.slice(1);
        },

        formatBytes(bytes, decimals = 2) {
            if (!+bytes) return '0 Bytes';
            const k = 1024;
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals < 0 ? 0 : decimals))} ${['Bytes', 'KB', 'MB', 'GB', 'TB'][i]}`;
        },

        transformAndroidData: (scanData) => {
            const transformedApps = scanData.allApps || [];

            // 💡 [핵심 수정] VT 확진 앱만 위협 목록으로 분류
            // app.reason 필드에 "[VT 확진]"이 포함된 앱만 필터링합니다.
            const suspiciousApps = transformedApps.filter(app => {
                // reason 필드가 있고, 그 안에 "[VT 확진]" 문자열이 포함된 경우만 true
                return app.reason && app.reason.includes('[VT 확진]');
            });


            return {
                deviceInfo: scanData.deviceInfo,
                allApps: transformedApps,
                apkFiles: scanData.apkFiles || [],
                suspiciousApps: suspiciousApps
                // networkUsageMap 등 다른 필드는 필요에 따라 추가
            };
        },


        // iOS 데이터를 안드로이드 포맷으로 변환
        transformIosData(iosData) {
            console.log("📥 [Renderer] Main에서 받은 데이터:", iosData); // 디버깅용 로그

            // 1. 위협 데이터 매핑
            const suspiciousApps = (iosData.suspiciousItems || []).map(item => {
                const moduleName = item.module || item.check_name || 'Unknown Module';
                const description = item.description || item.name || '탐지된 이상 징후';
                const filePath = item.file_path || item.path || '-';

                return {
                    packageName: moduleName,
                    cachedTitle: `[iOS] ${moduleName}`,
                    reason: description,
                    apkPath: filePath,
                    hash: item.sha256 || 'N/A',
                    isSideloaded: true,
                    isRunningBg: false,
                    grantedList: [],
                    grantedCount: 0
                };
            });

            // 2. 기기 정보 전달 (★ 핵심 수정 부분)
            // main.js에서 만든 deviceInfo가 있으면 무조건 그걸 씁니다.
            // 없으면(null이면) 그때서야 기본값을 씁니다.
            const finalDeviceInfo = iosData.deviceInfo || {
                model: 'iPhone (Unknown)',
                serial: '-',
                isRooted: false,
                phoneNumber: '-'
            };

            return {
                deviceInfo: finalDeviceInfo, // ★ Main에서 준 정보를 그대로 통과시킴
                allApps: iosData.allApps || [],
                suspiciousApps: suspiciousApps,
                apkFiles: []
            };
        },

        // 권한 한글 매핑
        getKoreanPermission(permString) {
            // 권한 한글 매핑 데이터 (Short Keys / Ultimate Edition)
            const MAP = {
                'CAMERA': '📷 카메라',
                'RECORD_AUDIO': '🎤 마이크 (녹음)',
                'READ_CONTACTS': '📒 연락처 읽기',
                'ACCESS_FINE_LOCATION': '📍 정밀 위치 (GPS)',
                'READ_SMS': '✉️ 문자 읽기',
                'SEND_SMS': '✉️ 문자 보내기',
                'RECEIVE_BOOT_COMPLETED': '🔌 부팅 시 자동 실행',
                'BIND_DEVICE_ADMIN': '🛡️ 기기 관리자 (삭제 방지)',
                'INTERNET': '🌐 인터넷 사용',
                'READ_EXTERNAL_STORAGE': '💾 저장소 읽기',
                'WRITE_CONTACTS': '📒 연락처 쓰기/수정',
                'CALL_PHONE': '📞 전화 걸기',
                'READ_CALL_LOG': '📞 통화 기록 읽기',
                'WRITE_CALL_LOG': '📞 통화 기록 쓰기/수정',
                'PROCESS_OUTGOING_CALLS': '📞 발신 전화 가로채기/모니터링',
                'ACCESS_COARSE_LOCATION': '📍 대략적 위치 (네트워크 기반)',
                'SYSTEM_ALERT_WINDOW': '🪟 다른 앱 위에 화면 표시 (피싱/가로채기)',
                'READ_PHONE_STATE': '📱 기기 정보/상태 읽기 (IMEI, 전화번호)',
                'GET_ACCOUNTS': '🔑 계정 목록 접근 (Google, SNS 계정)',
                'USE_BIOMETRIC': '🖐️ 지문/생체 인식 사용',
                'REQUEST_INSTALL_PACKAGES': '📦 다른 앱 설치 요청',
                'READ_CALENDAR': '🗓️ 캘린더 일정 읽기',
                'WRITE_CALENDAR': '🗓️ 캘린더 일정 쓰기',
                'WAKE_LOCK': '🔋 화면/CPU 잠금 방지',
                'CHANGE_WIFI_STATE': '📶 Wi-Fi 연결 상태 변경',
                'FOREGROUND_SERVICE': '🚀 포그라운드 서비스 실행 (백그라운드 지속)',
                'ACCESS_WIFI_STATE': '📶 Wi-Fi 네트워크 상태 접근',
                'READ_MEDIA_VISUAL_USER_SELECTED': '👀 미디어 (사진/영상) 선택적 접근',
                'READ_MEDIA_IMAGES': '🖼️ 미디어 (사진) 전체 읽기',
                'READ_MEDIA_VIDEO': '🎥 미디어 (영상) 전체 읽기',
                'MANAGE_DOCUMENTS': '📁 문서 관리 (모든 파일 접근)',
                'FOREGROUND_SERVICE_CAMERA': '📸 포그라운드 서비스: 카메라 사용',
                'FOREGROUND_SERVICE_MICROPHONE': '🎙️ 포그라운드 서비스: 마이크 사용',
                'FOREGROUND_SERVICE_MEDIA_PROJECTION': '📺 포그라운드 서비스: 화면 미디어 전송',
                'FOREGROUND_SERVICE_DATA_SYNC': '🔄 포그라운드 서비스: 데이터 동기화',
                'FOREGROUND_SERVICE_MEDIA_PLAYBACK': '🎵 포그라운드 서비스: 미디어 재생',
                'RUN_USER_INITIATED_JOBS': '🔄 사용자 시작 작업 실행',
                'NEARBY_WIFI_DEVICES': '📡 근처 Wi-Fi 기기 검색',
                'ACCESS_NETWORK_STATE': '📶 네트워크 상태 확인',
                'MODIFY_AUDIO_SETTINGS': '📢 오디오 설정 변경',
                'NFC': '💳 NFC 사용 (근거리 무선 통신)',
                'HIGH_SAMPLING_RATE_SENSORS': '📈 고주파수 센서 사용',
                'USE_FINGERPRINT': '🖐️ 지문/생체 인식 사용',
                'VIBRATE': '🔔 진동 제어',
                'GET_PACKAGE_SIZE': '📦 앱 크기 정보 조회',
                'DETECT_SCREEN_CAPTURE': '캡처/녹화 감지',
                'POST_NOTIFICATIONS': '💬 알림 표시 요청',
                'ACCESS_ADSERVICES_ATTRIBUTION': '📊 광고 기여도 서비스 접근',
                'ACCESS_ADSERVICES_AD_ID': '🆔 광고 식별자 접근',
                'USE_CREDENTIALS': '🔑 자격 증명 사용 (계정 인증 정보 활용)',
                'MANAGE_ACCOUNTS': '🔑 계정 관리 (계정 추가, 삭제, 수정)',
                'WRITE_SETTINGS': '⚙️ 시스템 설정 변경 (비행기 모드, 밝기 등)',
                'BROADCAST_STICKY': '📢 지속적인 브로드캐스트',
                'MEDIA_CONTENT_CONTROL': '⏯️ 미디어 제어',
                'INTERACT_ACROSS_USERS': '👥 다른 사용자 상호작용',
                'INTERACT_ACROSS_PROFILES': '👥 다른 프로필 상호작용',
                'FOREGROUND_SERVICE_CONNECTED_DEVICE': '💻 포그라운드 서비스: 연결 기기 접근',
                'WRITE_EXTERNAL_STORAGE': '💾 저장소 파일 쓰기/수정',
                'ACCESS_NOTIFICATION_POLICY': '🔔 알림 정책 접근/변경',
                'BLUETOOTH_ADMIN': '블루투스 설정 관리',
                'CHANGE_NETWORK_STATE': '네트워크 연결 상태 변경',
                'READ_PROFILE': '👤 사용자 프로필 정보 읽기',
                'ACCESS_BACKGROUND_LOCATION': '📍 백그라운드 위치 접근 (백그라운드)',
                'BLUETOOTH': '블루투스 연결/사용',
                'CALL_PRIVILEGED': '📞 권한이 부여된 전화 걸기/수신',
                'READ_ASSISTANT_APP_SEARCH_DATA': '🔍 어시스턴트 앱 검색 데이터 읽기',
                'READ_SYNC_SETTINGS': '🔄 동기화 설정 읽기',
                'GET_TASKS': '📋 최근 실행 앱 목록 조회',
                'REAL_GET_TASKS': '📋 모든 실행 앱 목록 조회',
                'WRITE_SMS': '✉️ 문자(SMS/MMS) 쓰기/수정',
                'FLASHLIGHT': '💡 플래시 라이트 사용',
                'DOWNLOAD_WITHOUT_NOTIFICATION': '📥 알림 없이 다운로드',
                'MANAGE_VOICE_KEYPHRASES': '🗣️ 음성 키프레이즈 관리',
                'MANAGE_SOUND_TRIGGER': '🔊 사운드 트리거 관리',
                'SOUND_TRIGGER_RUN_IN_BATTERY_SAVER': '🔋 절전 모드에서 사운드 트리거 실행',
                'CAPTURE_AUDIO_HOTWORD': '🎤 핫워드 오디오 캡처',
                'MANAGE_HOTWORD_DETECTION': '🗣️ 핫워드 감지 관리',
                'STOP_APP_SWITCHES': '앱 전환 차단',
                'SET_WALLPAPER': '🖼️ 배경화면 설정',
                'SET_WALLPAPER_HINTS': '🖼️ 배경화면 힌트 설정',
                'BIND_APPWIDGET': '위젯 바인딩',
                'CHANGE_WIFI_MULTICAST_STATE': '📶 Wi-Fi 멀티캐스트 상태 변경',
                'SET_MEDIA_KEY_LISTENER': '⏯️ 미디어 키 리스너 설정',
                'SET_VOLUME_KEY_LONG_PRESS_LISTENER': '🔊 볼륨 키 길게 누름 리스너 설정',
                'MANAGE_USB': '🔌 USB 장치 관리',
                'PACKAGE_USAGE_STATS': '📊 앱 사용 통계 접근',
                'START_ACTIVITIES_FROM_BACKGROUND': '🚀 백그라운드에서 활동 시작',
                'ANSWER_PHONE_CALLS': '📞 전화 받기/종료 자동 처리',
                'EXPAND_STATUS_BAR': '상태 표시줄 확장',
                'QUERY_ALL_PACKAGES': '📦 모든 설치된 앱 목록 조회',
                'CONTROL_INCALL_EXPERIENCE': '📞 통화 중 경험 제어',
                'ENTER_CAR_MODE_PRIORITIZED': '🚗 카 모드 우선권 진입',
                'WRITE_APN_SETTINGS': '⚙️ APN 설정 쓰기',
                'SCHEDULE_EXACT_ALARM': '⏰ 정확한 알람 예약',
                'BLUETOOTH_CONNECT': '블루투스 연결',
                'BLUETOOTH_SCAN': '블루투스 스캔',
                'SUBSTITUTE_SHARE_TARGET_APP_NAME_AND_ICON': '🔗 공유 대상 이름/아이콘 대체',
                'SUBSCRIBE_TO_KEYGUARD_LOCKED_STATE': '🔒 잠금 화면 상태 구독',
                'EXECUTE_APP_ACTION': '▶️ 앱 동작 실행',
                'EXECUTE_APP_FUNCTIONS': '▶️ 앱 기능 실행',
                'CAPTURE_MEDIA_OUTPUT': '📺 미디어 출력 캡처',
                'MODIFY_AUDIO_ROUTING': '📢 오디오 경로 변경',
                'POST_PROMOTED_NOTIFICATIONS': '💬 홍보성 알림 표시',
                'REORDER_TASKS': '📋 최근 실행 앱 순서 변경',
                'CAPTURE_AUDIO_OUTPUT': '👂 오디오 출력 캡처 (스피커 소리)',
                'SYSTEM_APPLICATION_OVERLAY': '🪟 시스템 앱 위에 오버레이 표시',
                'AUTHENTICATE_ACCOUNTS': '🔑 계정 인증 자격 증명 사용',
                'READ_SYNC_STATS': '🔄 동기화 통계 읽기',
                'SUBSCRIBED_FEEDS_READ': '📰 구독 피드 읽기',
                'SUBSCRIBED_FEEDS_WRITE': '📰 구독 피드 쓰기/수정',
                'WRITE_SYNC_SETTINGS': '🔄 동기화 설정 쓰기/변경',
                'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS': '🔋 배터리 최적화 무시 요청',
                'REQUEST_PASSWORD_COMPLEXITY': '🔒 비밀번호 복잡도 설정 요청',
                'MANAGE_OWN_CALLS': '📞 자체 통화 관리',
                'USE_FULL_SCREEN_INTENT': '📱 전체 화면 인텐트 사용',
                'FOREGROUND_SERVICE_PHONE_CALL': '📞 포그라운드 서비스: 전화 통화',
                'ACCESS_KEYGUARD_SECURE_STORAGE': '🔒 키가드 보안 저장소 접근',
                'WRITE_MEDIA_STORAGE': '💾 미디어 저장소 쓰기/수정',
                'SET_PREFERRED_APPLICATIONS': '⚙️ 기본 앱 설정 변경',
                'DEVICE_POWER': '🔋 기기 전원 상태 제어',
                'GET_ACCOUNTS_PRIVILEGED': '🔑 특권 계정 목록 접근',
                'WRITE_SECURE_SETTINGS': '⚙️ 보안 시스템 설정 쓰기',
                'MANAGE_ROLE_HOLDERS': '👥 역할 소유자 관리',
                'GET_INTENT_SENDER_INTENT': '의도 발신자 인텐트 획득',
                'FINGERPRINT_PRIVILEGED': '🖐️ 지문 특권 사용',
                'BIOMETRICS_PRIVILEGED': '🖐️ 생체 인식 특권 사용',
                'READ_PRIVILEGED_PHONE_STATE': '📱 특권 기기 정보 읽기',
                'CONFIGURE_WIFI_DISPLAY': '📺 Wi-Fi 디스플레이 설정',
                'SEM_WRITE_CAPTURED_URL': '캡처된 URL 쓰기',
                'FOREGROUND_SERVICE_SPECIAL_USE': '🚀 포그라운드 서비스: 특수 목적 사용',
                'SSRM_NOTIFICATION_PERMISSION': '알림 권한 요청',
                'STATUS_BAR': '상태 표시줄 제어',
                'MANAGE_ACTIVITY_STACKS': '📋 활동 스택 관리',
                'INSTALL_PACKAGES': '📦 패키지 설치',
                'MODIFY_THEME': '테마 수정',
                'FINGERPRINT_WEB_SIGNIN': '🖐️ 웹 로그인 지문 사용',
                'IRIS_WEB_SIGNIN': '👁️ 웹 로그인 홍채 사용',
                'INTELLIGENT_SCAN_WEB_SIGNIN': '스마트 스캔 웹 로그인',
                'READ_MEDIA_AUDIO': '🎵 미디어 (오디오) 전체 읽기',
                'READ_SEARCH_INDEXABLES': '🔍 검색 인덱스 가능 항목 읽기',
                'BROADCAST_CLOSE_SYSTEM_DIALOGS': '시스템 대화상자 닫기 방송',
                'MANAGE_USERS': '👥 사용자 계정 관리',
                'CREDENTIAL_MANAGER_QUERY_CANDIDATE_CREDENTIALS': '🔑 자격 증명 후보 조회',
                'CREDENTIAL_MANAGER_SET_ALLOWED_PROVIDERS': '🔑 허용된 자격 증명 제공자 설정',
                'CREDENTIAL_MANAGER_SET_ORIGIN': '🔑 자격 증명 출처 설정',
                'RECEIVE_SMS': '📩 문자 수신 감지 (몰래 수신)',
                'RECEIVE_MMS': '📩 MMS(멀티미디어 문자) 수신',
                'RECEIVE_WAP_PUSH': '📩 WAP 푸시 메시지 수신 (원격 명령)',
                'BROADCAST_SMS': '📡 문자 메시지 방송 (시스템 권한)',
                'READ_CELL_BROADCASTS': '📢 긴급 재난 문자/방송 읽기',
                'READ_PHONE_NUMBERS': '📱 내 전화번호 가져오기',
                'MODIFY_PHONE_STATE': '📱 전화 상태 조작 (통화 차단/가로채기)',
                'USE_SIP': '📞 SIP(인터넷 전화) 사용',
                'BIND_TELECOM_CONNECTION_SERVICE': '📞 통신 연결 서비스 바인딩',
                'ACCEPT_HANDOVER': '📞 통화 전환 허용 (Wi-Fi ↔ LTE)',
                'ACCESS_MEDIA_LOCATION': '🖼️ 사진 속 위치 정보(GeoTag) 읽기',
                'ACCESS_LOCATION_EXTRA_COMMANDS': '📍 위치 제공자 추가 명령 실행',
                'CONTROL_LOCATION_UPDATES': '📍 위치 업데이트 제어/조작',
                'BIND_ACCESSIBILITY_SERVICE': '⚠️ [최고 위험] 접근성 서비스 (화면 제어/키로깅)',
                'DELETE_PACKAGES': '🗑️ [시스템] 다른 앱 삭제',
                'REPLACE_EXISTING_PACKAGE': '🔄 [시스템] 기존 앱 바꿔치기 (위변조)',
                'CLEAR_APP_CACHE': '🧹 앱 캐시 삭제',
                'CLEAR_APP_USER_DATA': '🧹 앱 사용자 데이터 초기화',
                'MOVE_PACKAGE': '📦 앱 설치 위치 이동',
                'INJECT_EVENTS': '⌨️ [해킹] 키 입력/터치 이벤트 주입 (원격 제어)',
                'READ_INPUT_STATE': '⌨️ 키 입력 상태 읽기 (키로깅)',
                'READ_LOGS': '📝 [시스템] 시스템 로그 읽기 (민감 정보 유출)',
                'DUMP': '📝 [시스템] 시스템 상태 정보 덤프',
                'SET_ACTIVITY_WATCHER': '👀 앱 실행 감시자 설정',
                'SET_PROCESS_LIMIT': '🛑 백그라운드 프로세스 제한',
                'SIGNAL_PERSISTENT_PROCESSES': '🛑 지속 프로세스 종료 신호',
                'KILL_BACKGROUND_PROCESSES': '🔪 다른 앱 강제 종료',
                'FORCE_STOP_PACKAGES': '🔪 앱 강제 중지',
                'REBOOT': '🔄 기기 재부팅',
                'SHUTDOWN': '📴 기기 전원 끄기',
                'FACTORY_TEST': '🏭 공장 초기화 테스트 모드 진입',
                'MASTER_CLEAR': '💥 [매우 위험] 공장 초기화 (데이터 전체 삭제)',
                'BRICK': '🧱 기기 벽돌화 (영구 손상 시도)',
                'DISABLE_KEYGUARD': '🔓 잠금 화면(패턴/비번) 해제',
                'BATTERY_STATS': '🔋 배터리 사용량 통계 조회',
                'WRITE_GSERVICES': '⚙️ 구글 서비스 설정 변경',
                'CHANGE_CONFIGURATION': '⚙️ UI 구성 변경 (언어/방향)',
                'CHANGE_COMPONENT_ENABLED_STATE': '🚫 앱 아이콘 숨기기/비활성화',
                'PERSISTENT_ACTIVITY': '🧟 앱이 메모리에서 죽지 않도록 설정',
                'RESTART_PACKAGES': '🔄 앱 재시작',
                'MANAGE_EXTERNAL_STORAGE': '⚠️ [위험] 모든 파일 관리 접근',
                'ACCESS_MTP': '🔌 MTP 프로토콜 접근',
                'MOUNT_UNMOUNT_FILESYSTEMS': '💾 SD카드 마운트/해제',
                'MOUNT_FORMAT_FILESYSTEMS': '💾 저장소 포맷/초기화',
                'FOREGROUND_SERVICE_LOCATION': '📍 포그라운드: 위치 추적',
                'FOREGROUND_SERVICE_HEALTH': '❤️ 포그라운드: 건강 데이터',
                'FOREGROUND_SERVICE_REMOTE_MESSAGING': '📨 포그라운드: 원격 메시징',
                'INSTANT_APP_FOREGROUND_SERVICE': '⚡ 인스턴트 앱 포그라운드 실행',
                'CONNECTIVITY_INTERNAL': '📶 [시스템] 내부 네트워크 관리',
                'CONTROL_VPN': '🔒 VPN 연결 제어',
                'TETHER_PRIVILEGED': '📡 핫스팟/테더링 제어',
                'BLUETOOTH_ADVERTISE': '🦷 블루투스 신호 송출',
                'BLUETOOTH_PRIVILEGED': '🦷 [시스템] 블루투스 특권',
                'NFC_TRANSACTION_EVENT': '💳 NFC 결제 이벤트 수신',
                'UWB_RANGING': '📏 UWB(초광대역) 거리 측정',
                'BIND_NOTIFICATION_LISTENER_SERVICE': '📩 [위험] 알림 내용 훔쳐보기 (카톡/문자)',
                'COLLAPSE_STATUS_BAR': '⬆️ 상태 표시줄 축소',
                'ACCESS_SURFACE_FLINGER': '🖥️ 화면 프레임 버퍼 접근 (스크린샷)',
                'READ_FRAME_BUFFER': '🖥️ 화면 내용 읽기 (스크린샷)',
                'INTERNAL_SYSTEM_WINDOW': '🪟 내부 시스템 윈도우 사용',
                'USE_IRIS': '👁️ 홍채 인식 사용',
                'USE_FACE_AUTHENTICATION': '🙂 얼굴 인식 사용',
                'BODY_SENSORS': '❤️ 신체 센서(심박수 등) 접근',
                'BODY_SENSORS_BACKGROUND': '❤️ 백그라운드 신체 센서 접근',
                'ACTIVITY_RECOGNITION': '🏃‍♂️ 활동 감지',
                'HARDWARE_TEST': '🛠️ 하드웨어 테스트',
                'TRANSMIT_IR': '📡 적외선(IR) 송신',
                'CAMERA_DISABLE_TRANSMIT_LED': '📷 카메라 촬영 중 LED 끄기 (몰카)',
                'ACCOUNT_MANAGER': '👤 계정 매니저 접근',
                'BIND_INPUT_METHOD': '⌨️ 키보드(IME) 앱 바인딩',
                'BIND_VPN_SERVICE': '🔒 VPN 서비스 바인딩',
                'BIND_WALLPAPER': '🖼️ 배경화면 서비스 바인딩',
                'BIND_VOICE_INTERACTION': '🗣️ 음성 인식 서비스 바인딩',
                'BIND_REMOTE_VIEWS': '📱 원격 뷰 바인딩',
                'BIND_TEXT_SERVICE': '📝 텍스트 서비스 바인딩',
                'BIND_DREAM_SERVICE': '💤 화면보호기 바인딩',
                'BIND_CARRIER_MESSAGING_SERVICE': '📨 통신사 메시징 서비스 바인딩',
                'INSTALL_SHORTCUT': '📌 홈 화면 바로가기 추가',
                'UNINSTALL_SHORTCUT': '📌 홈 화면 바로가기 삭제',
                'SET_TIME_ZONE': '⏰ 시간대 변경',
                'SET_TIME': '⏰ 시스템 시간 변경',
                'READ_HISTORY_BOOKMARKS': '🌐 브라우저 기록 읽기',
                'WRITE_HISTORY_BOOKMARKS': '🌐 브라우저 기록 조작',
                'SET_ALARM': '⏰ 알람 설정',
                'KNOX_SECURITY': '🛡️ 삼성 Knox 보안 제어',
                'KNOX_DEVICE_ADMIN': '🛡️ 삼성 Knox 관리자',
                'KNOX_CUSTOM_SYSTEM': '🛡️ 삼성 Knox 커스텀 시스템',
                'KNOX_HW_CONTROL': '🛡️ 삼성 Knox 하드웨어 제어',
                'KNOX_APP_MGMT': '🛡️ 삼성 Knox 앱 관리',
                'KNOX_RESTRICTION_MGMT': '🛡️ 삼성 Knox 제한 관리',
                'SAMSUNG_PAY': '💳 삼성페이 접근',
                'DVFS_BOOSTER_PERMISSION': '🚀 삼성 성능 부스터 제어',
                'WRITE_USE_APP_FEATURE_SURVEY': '📝 삼성 사용 패턴 수집',
                'COCKTAIL_BAR_SERVICE': '🍸 삼성 엣지 패널 제어',
                'ACCESS_PROVIDER': '📧 삼성 이메일 접근',
                'ADD_ACCOUNT': '👤 삼성 계정 추가',
                'USE_FACE': '🙂 삼성 얼굴 인식',
                'IMAGE_ENHANCE': '📷 삼성 카메라 화질 개선',
                'LAUNCH_PERSONAL_PAGE_SERVICE': '🔐 삼성 프라이빗 모드 실행',
                'BILLING': '💰 구글 플레이 결제',
                'CHECK_LICENSE': '©️ 라이선스 확인',
                'RECEIVE': '☁️ 푸시 알림 수신 (Google/Firebase)',
                'READ_GSERVICES': '🔧 구글 서비스 설정 읽기',
                'BIND_GET_INSTALL_REFERRER_SERVICE': '📢 앱 유입 경로 추적',
                'GOOGLE_PHOTOS': '🖼️ 구글 포토 접근',
                'READ_GMAIL': '📧 지메일(Gmail) 읽기',
                'WRITE_GMAIL': '📧 지메일(Gmail) 쓰기',
                'LGE_CAMERA_VERIFY': '📷 LG 카메라 검증',
                'READ_SETTINGS': '⚙️ 런처 설정 읽기 (제조사 공통)',
                'BROADCAST_BADGE': '🔴 앱 배지 제어 (Sony/HTC)',
                'PROVIDER_INSERT_BADGE': '🔴 배지 삽입',
                'UPDATE_SHORTCUT': '📌 바로가기 업데이트',
                'CHANGE_BADGE': '🔴 화웨이 앱 배지 변경',
                'MDM': '🛡️ MDM(모바일 기기 관리) 보안 제어',
                'EXTRA_NETWORK': '📶 샤오미 네트워크 추가 권한',
                'PERM_USE_ANALYTICS': '📊 샤오미 분석 데이터 사용',
                'USE_EXACT_ALARM': '⏰ 정확한 알람 사용 (시스템 승인 필요 없음)',
                'SCHEDULE_EXACT_ALARM': '⏰ 정확한 알람 예약 (사용자 권한 필요)',
                'ACCESS_MEDIA_LOCATION': '📍 미디어 파일 위치 정보(GeoTag) 읽기',
                'READ_MEDIA_VISUAL_USER_SELECTED': '👀 사용자가 직접 선택한 사진/영상만 접근',
                'POST_NOTIFICATIONS': '🔔 앱 알림 보내기 (Android 13+)',
                'REVOKE_POST_NOTIFICATIONS_WITHOUT_KILL': '🔕 앱 종료 없이 알림 권한 회수',
                'NEARBY_WIFI_DEVICES': '📡 근처 Wi-Fi 기기 탐색 (위치 정보 없이)',
                'UWB_RANGING': '📏 UWB(초광대역) 정밀 거리 측정',
                'MANAGE_MEDIA_PROJECTION': '📺 화면 공유/캡처 세션 관리',
                'REQUEST_DELETE_PACKAGES': '🗑️ 앱 삭제 요청 (사용자 확인)',
                'UPDATE_PACKAGES_WITHOUT_USER_ACTION': '🔄 사용자 개입 없이 앱 업데이트',
                'ADD_VOICEMAIL': '📼 음성 사서함 메시지 추가',
                'READ_VOICEMAIL': '📼 음성 사서함 읽기',
                'WRITE_VOICEMAIL': '📼 음성 사서함 쓰기/삭제',
                'READ_PRECISE_PHONE_STATE': '📱 정밀한 통화 상태 읽기 (데이터 연결 등)',
                'BIND_VISUAL_VOICEMAIL_SERVICE': '📼 비주얼 보이스메일 서비스 바인딩',
                'BIND_CARRIER_SERVICES': '📡 통신사 전용 서비스 바인딩',
                'BIND_CALL_REDIRECTION_SERVICE': '↪️ 발신 전화 리디렉션 서비스 바인딩',
                'BIND_SCREENING_SERVICE': '📞 스팸 전화 스크리닝 서비스 바인딩',
                'READ_USER_DICTIONARY': '📖 사용자 단어장/사전 읽기',
                'WRITE_USER_DICTIONARY': '📖 사용자 단어장/사전 쓰기',
                'SET_ORIENTATION': '🔄 화면 회전 방향 강제 설정',
                'SET_POINTER_SPEED': '🖱️ 마우스/터치패드 포인터 속도 설정',
                'BIND_QUICK_SETTINGS_TILE': '🔘 퀵 설정(상단바) 타일 추가/관리',
                'BIND_INPUT_METHOD': '⌨️ 키보드(IME) 입력기 바인딩',
                'BIND_MIDI_DEVICE_SERVICE': '🎹 MIDI 악기 연결 서비스 바인딩',
                'MANAGE_WIFI_INTERFACES': '📶 Wi-Fi 인터페이스 직접 제어',
                'OVERRIDE_WIFI_CONFIG': '📶 Wi-Fi 설정 강제 덮어쓰기',
                'GLOBAL_SEARCH': '🔍 전역 검색 데이터 접근',
                'SET_ALWAYS_FINISH': '🛑 액티비티 유지 안 함 (개발자 옵션)',
                'SET_ANIMATION_SCALE': '🎞️ 애니메이션 배율 설정 (개발자 옵션)',
                'SET_DEBUG_APP': '🐞 디버깅 앱 설정',
                'CAR_SPEED': '🚗 차량 속도 정보 읽기',
                'CAR_MILEAGE': '🚗 차량 주행 거리 정보 읽기',
                'CAR_FUEL': '⛽ 차량 연료량 확인',
                'CAR_VENDOR_EXTENSION': '🚗 차량 제조사 확장 기능 사용',
                'CONTROL_CAR_CLIMATE': '❄️ 차량 에어컨/히터 제어',
                'CONTROL_CAR_DOORS': '🚪 차량 문 잠금/해제',
                'CONTROL_CAR_WINDOWS': '🪟 차량 창문 제어',
                'BIND_COMPANION_DEVICE_SERVICE': '⌚ 웨어러블/컴패니언 기기 연결 관리',
                'REQUEST_COMPANION_RUN_IN_BACKGROUND': '⌚ 컴패니언 기기 백그라운드 실행 유지',
                'REQUEST_COMPANION_USE_DATA_IN_BACKGROUND': '⌚ 컴패니언 기기 백그라운드 데이터 사용',
                'ACCESS_VR_STATE': '🥽 VR(가상현실) 모드 상태 접근',
                'ACCESS_AMBIENT_LIGHT_STATS': '💡 주변 밝기 센서 통계 접근',
                'BODY_SENSORS_BACKGROUND': '❤️ 백그라운드에서 신체 센서(심박 등) 접근',
                'USE_ICC_AUTH_WITH_DEVICE_IDENTIFIER': '🔑 기기 식별자를 이용한 ICC 인증',
                'MANAGE_FINGERPRINT': '🖐️ 지문 데이터 관리 (등록/삭제)',
                'RESET_FINGERPRINT_LOCKOUT': '🔓 지문 인식 실패 잠금 초기화',
                'MANAGE_BIOMETRIC': '👤 생체 인식 데이터 관리',
                'COPY_PROTECTED_DATA': '©️ 보호된 데이터 복사 (시스템)',
                'FORCE_BACK': '🔙 뒤로 가기 강제 실행',
                'MANAGE_APP_OPS_MODES': '🛡️ 앱 권한(AppOps) 강제 조작',
                'UPDATE_DEVICE_STATS': '📊 기기 통계 강제 업데이트',
                'CHANGE_APP_IDLE_STATE': '💤 앱 절전(Doze) 모드 상태 변경',
                'MANAGE_NOTIFICATIONS': '🔔 모든 알림 관리/삭제 (시스템)',
                'RETRIEVE_WINDOW_CONTENT': '🪟 화면 창 내용 추출 (접근성)',
                'TABLET_MODE': '📱 태블릿 모드 전환',
                'STATUS_BAR_SERVICE': '⬇️ 상태 표시줄 서비스 바인딩'
            };
            const shortName = permString.split('.').pop();
            return MAP[shortName] || shortName;
        }
    };
    // =========================================================
    // [12] 관리자 시스템 (ADMIN MANAGER) - 신규 추가
    // =========================================================
    const AdminManager = {

        currentUserUid: null, // 현재 보고 있는 상세 페이지의 업체 UID

        init() {
            console.log("🚀 AdminManager.init() 시작됨!");

            const loggedInContainer = document.getElementById('logged-in-view');
            const navMenu = loggedInContainer.querySelector('.nav-menu');

            if (!navMenu) return console.error("❌ nav-menu 없음");
            if (loggedInContainer.querySelector('#nav-admin')) return;

            // 1. 메인 사이드바에 '관리자 페이지' 버튼 생성
            const li = document.createElement('li');
            li.className = 'nav-item';
            li.id = 'nav-admin';
            li.innerHTML = '🛡️ 관리자 페이지';
            li.style.color = '#F0AD4E';
            li.style.fontWeight = 'bold';

            li.addEventListener('click', () => {
                ViewManager.activateMenu('nav-admin');
                ViewManager.showScreen(document.getElementById('logged-in-view'), 'admin-screen');
                // 기본적으로 첫 번째 탭(업체 등록) 보이기
                this.switchTab('admin-tab-register');
            });
            navMenu.insertBefore(li, navMenu.firstChild);

            const tabContainer = document.querySelector('.admin-tabs'); // 탭 버튼 감싸는 div 가정
            if (tabContainer && !document.getElementById('btn-abnormal-logs')) {
                const abBtn = document.createElement('button');
                abBtn.className = 'admin-tab-btn';
                abBtn.id = 'btn-abnormal-logs';
                abBtn.dataset.target = 'admin-tab-abnormal';
                abBtn.innerText = '⚠️ 비정상 로그';
                tabContainer.appendChild(abBtn);

                // 탭 클릭 이벤트 연결
                abBtn.addEventListener('click', () => this.switchTab('admin-tab-abnormal'));
            }

            // 기존 탭 이벤트 연결
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => this.switchTab(btn.dataset.target));
            });

            // 이벤트 리스너들
            const createUserForm = document.getElementById('admin-create-user-form');
            if (createUserForm) createUserForm.addEventListener('submit', (e) => this.createUser(e));

            const refreshBtn = document.getElementById('refresh-users-btn');
            if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadUsers());

            // 상세페이지 닫기(뒤로가기) 버튼용 컨테이너 생성
            this.createDetailViewContainer();
        },

        // 상세 페이지용 HTML 구조 생성 (최초 1회)
        createDetailViewContainer() {
            const screen = document.getElementById('admin-screen');
            const detailDiv = document.createElement('div');
            detailDiv.id = 'admin-user-detail-view';
            detailDiv.className = 'hidden'; // 기본 숨김
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
            
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>검사 일시 (시작)</th>
                        <th>기기</th>
                        <th>상태</th>
                        <th>소요 시간</th>
                        <th>에러 메시지</th>
                    </tr>
                </thead>
                <tbody id="user-scan-logs-body">
                    </tbody>
            </table>
        `;
            screen.appendChild(detailDiv);

            document.getElementById('detail-back-btn').addEventListener('click', () => {
                // 1. 상세뷰 숨기기
                document.getElementById('admin-user-detail-view').classList.add('hidden');

                // 날짜 필터 필드 초기화
                document.getElementById('log-date-start').value = '';
                document.getElementById('log-date-end').value = '';

                // 2. 목록뷰 보이기 (hidden 제거 + active 추가)
                const listTab = document.getElementById('admin-tab-list');
                listTab.classList.remove('hidden');
                listTab.classList.add('active');

                this.currentUserUid = null;

                // 3. ★ 핵심: 목록 데이터 다시 불러오기 (이게 없어서 안 떴던 것임)
                this.loadUsers();
            });
        },

        // ★ 탭 전환 함수
        switchTab(tabId) {
            const detailView = document.getElementById('admin-user-detail-view');
            if (detailView) {
                detailView.classList.add('hidden');
            }
            this.currentUserUid = null;

            // 탭 버튼 스타일
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                if (btn.dataset.target === tabId) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            // 콘텐츠 표시
            document.querySelectorAll('.admin-tab-content').forEach(content => {
                content.classList.remove('active'); // 일단 다 숨김
                if (content.id === tabId) {
                    // 선택된 탭: active 클래스를 부여하여 표시하고 hidden은 제거
                    content.classList.remove('hidden');
                    content.classList.add('active');
                } else {
                    // 나머지 탭: active를 제거하고 hidden을 부여하여 확실히 숨김
                    content.classList.remove('active');
                    content.classList.add('hidden');
                }
            });

            // 동적으로 생성된 탭(비정상 로그) 처리
            if (tabId === 'admin-tab-abnormal') {
                // HTML에 콘텐츠 영역이 없을 수 있으므로 동적 생성
                let abContent = document.getElementById('admin-tab-abnormal');
                if (!abContent) {
                    abContent = document.createElement('div');
                    abContent.id = 'admin-tab-abnormal';
                    abContent.className = 'admin-tab-content active';
                    abContent.innerHTML = `
                    <h3>⚠️ 비정상/에러 로그 감지</h3>
                    <div style="margin-bottom:10px; color:#666; font-size:13px;">
                        * <b>Error:</b> 검사 중 오류 발생 <br>
                        * <b>Incomplete:</b> 시작은 했으나 종료 기록 없음 (강제종료/튕김)
                    </div>
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>시간</th>
                                <th>업체명</th>
                                <th>기기모드</th>
                                <th>상태</th>
                                <th>내용</th>
                            </tr>
                        </thead>
                        <tbody id="abnormal-log-body"></tbody>
                    </table>
                `;
                    document.querySelector('.admin-content-area').appendChild(abContent);
                } else {

                }
                this.loadAbnormalLogs();
            }

            if (tabId === 'admin-tab-list') this.loadUsers();
            if (tabId === 'admin-tab-reports') this.loadReports();
        },


        // [탭 1] 신규 업체 등록
        async createUser(e) {
            e.preventDefault();

            // 1. 입력값 가져오기
            const nameInput = document.getElementById('new-user-name'); // 업체명 요소
            const idInput = document.getElementById('new-user-id');
            const pwdInput = document.getElementById('new-user-pwd');
            const quotaInput = document.getElementById('new-user-quota');

            const companyName = nameInput.value.trim(); // ★ 업체명
            const inputId = idInput.value.trim();
            const password = pwdInput.value;

            // ★ 횟수값 확실하게 숫자(Integer)로 변환 (값이 없으면 기본 40)
            let quota = parseInt(quotaInput.value, 10);
            if (isNaN(quota)) quota = 40;

            const fullEmail = inputId + ID_DOMAIN;

            // 확인창
            if (!await CustomUI.confirm(`[생성 확인]\n\n업체명: ${companyName}\nID: ${inputId}\n기본 횟수: ${quota}회`)) return;

            // 보조 앱을 이용한 생성
            const secondaryAppName = "secondaryApp-" + Date.now();
            const config = auth.app.options;

            try {
                const secondaryApp = initializeApp(config, secondaryAppName);
                const secondaryAuth = getAuth(secondaryApp);
                const userCred = await createUserWithEmailAndPassword(secondaryAuth, fullEmail, password);
                const newUser = userCred.user;

                // ★★★ [수정됨] Firestore에 업체명과 횟수 저장 ★★★
                await setDoc(doc(db, "users", newUser.uid), {
                    companyName: companyName, // [추가] 업체명
                    userId: inputId,          // 아이디
                    email: fullEmail,         // 이메일(풀버전)
                    role: 'user',             // 권한
                    isLocked: false,          // 잠금여부
                    quota: quota,             // [확인] 검사 횟수 저장
                    android_scan_duration: 0,
                    createdAt: new Date(),
                    lastScanDate: null
                });

                await CustomUI.alert(`✅ 생성 완료!\n업체명: ${companyName}\n아이디: ${inputId}`);

                // 폼 초기화
                document.getElementById('admin-create-user-form').reset();
                // 초기화 후 기본값 40 다시 세팅
                if (quotaInput) quotaInput.value = 40;

                this.loadUsers(); // 목록 새로고침

            } catch (error) {
                console.error(error);
                await CustomUI.alert("생성 실패: " + error.message);
            }
        },

        async loadUsers() {
            const tbody = document.getElementById('admin-user-list-body');
            // 헤더 수정 (최근접속 제거)
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
                const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
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

                    // 1. 업체명 (클릭 시 상세페이지 이동)
                    const nameCell = `
                    <div class="user-link" style="cursor:pointer; color:#337ab7; font-weight:bold;" 
                         onclick="AdminManager.viewUserDetail('${docSnap.id}')">
                        ${companyName} <span style="font-weight:normal; color:#888; font-size:12px;">(${userId})</span>
                    </div>
                `;

                    // 2. 상태 뱃지
                    const statusBadge = user.isLocked
                        ? `<span class="admin-badge badge-locked">🔒 잠김</span>`
                        : `<span class="admin-badge badge-active">✅ 활성</span>`;

                    // 3. 횟수
                    const quota = user.quota || 0;

                    // 4. 기능 제어 (기록 버튼 삭제, 디자인 개선)
                    const controls = `
                    <button class="admin-btn btn-quota" title="횟수 조정" onclick="window.changeQuota('${docSnap.id}', ${quota})">🔢 횟수</button>
                    ${user.isLocked
                            ? `<button class="admin-btn btn-unlock" title="차단 해제" onclick="window.toggleLock('${docSnap.id}', false)">🔓 해제</button>`
                            : `<button class="admin-btn btn-lock" title="접속 차단" onclick="window.toggleLock('${docSnap.id}', true)">🔒 잠금</button>`
                        }
                    <button class="admin-btn btn-delete" title="업체 삭제" onclick="window.deleteUser('${docSnap.id}', '${companyName}')">🗑️ 삭제</button>
                `;

                    row.innerHTML = `
                    <td>${nameCell}</td>
                    <td>${statusBadge}</td>
                    <td><strong style="font-size:15px;">${quota}</strong> 회</td>
                    <td>${controls}</td>
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

            // 1. 목록 숨기고 상세 뷰 보이기
            document.getElementById('admin-tab-list').classList.remove('active'); // 탭 내용 숨김
            document.getElementById('admin-tab-list').classList.add('hidden');    // 확실히 숨김

            const detailView = document.getElementById('admin-user-detail-view');
            detailView.classList.remove('hidden');
            const contentDiv = document.getElementById('user-detail-content');

            contentDiv.innerHTML = '<p>데이터 분석 중...</p>';

            try {
                // 2. 유저 정보 가져오기
                const userDoc = await getDoc(doc(db, "users", uid));
                if (!userDoc.exists()) throw new Error("유저 정보 없음");
                const userData = userDoc.data();

                // 3. 로그 데이터 가져오기 (통계용)
                // scan_logs 컬렉션에서 해당 userId로 된 것들 모두 조회
                const logsQ = query(collection(db, "scan_logs"), where("userId", "==", uid), orderBy("startTime", "desc"));
                const logsSnap = await getDocs(logsQ);

                // 4. 통계 계산
                const stats = this.calculateScanStats(logsSnap.docs);

                // 5. 제출된 리포트 가져오기 (reported_logs) - 업체 ID 매칭 필요 
                // UID를 사용하도록 변경합니다.
                const reportsQ = query(
                    collection(db, "reported_logs"),
                    where("agencyId", "==", uid), // 'uid' 변수 사용 (users 문서 ID)
                    orderBy("reportedAt", "desc")
                );
                const reportsSnap = await getDocs(reportsQ);

                // 6. HTML 렌더링
                contentDiv.innerHTML = `
                <div class="user-detail-header">
                    <div>
                        <h2 style="margin:0;">${userData.companyName || '업체명 없음'}</h2>
                        <div style="color:#666; margin-top:5px;">
                            ID: ${userData.userId} | 가입: ${userData.createdAt ? new Date(userData.createdAt.toDate()).toLocaleDateString() : '-'}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:24px; font-weight:bold; color:#3A539B;">${userData.quota || 0}회</div>
                        <div style="font-size:12px; color:#888;">잔여 횟수</div>
                    </div>
                </div>

                <h3>📊 검사 통계</h3>
                <div class="stat-container">
                    <div class="stat-box">
                        <span>금일 검사</span>
                        <span class="stat-number">${stats.today}</span>
                    </div>
                    <div class="stat-box">
                        <span>이번 달 검사</span>
                        <span class="stat-number">${stats.month}</span>
                    </div>
                    <div class="stat-box">
                        <span>올해 검사</span>
                        <span class="stat-number">${stats.year}</span>
                    </div>
                    <div class="stat-box">
                        <span>누적 총 검사</span>
                        <span class="stat-number">${stats.total}</span>
                    </div>
                </div>

                <h3>🛠️ 업체 관리</h3>
                <div style="background:#eee; padding:15px; border-radius:8px; margin-bottom:30px;">
                    <button class="admin-btn btn-quota" onclick="window.changeQuota('${uid}', ${userData.quota || 0})">➕/➖ 횟수 조정</button>
                    ${userData.isLocked
                        ? `<button class="admin-btn btn-unlock" onclick="window.toggleLock('${uid}', false)">🔓 차단 해제</button>`
                        : `<button class="admin-btn btn-lock" onclick="window.toggleLock('${uid}', true)">🚫 접속 차단(잠금)</button>`
                    }
                    <button class="admin-btn btn-delete" style="float:right;" onclick="window.deleteUser('${uid}', '${userData.companyName}')">⚠️ 업체 영구 삭제</button>
                </div>

                <h3>📨 제출된 결과 리포트 (${reportsSnap.size}건)</h3>
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>제출일시</th>
                            <th>메시지</th>
                            <th>탐지결과</th>
                            <th>상세</th>
                        </tr>
                    </thead>
                    <tbody id="detail-report-body">
                        ${this.renderDetailReports(reportsSnap)}
                    </tbody>
                </table>
            `;
                const now = new Date();
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(now.getDate() - 7); // 현재 날짜에서 7일 전으로 설정

                // YYYY-MM-DD 형식으로 변환 (input[type=date]와 호환되도록)
                // KST 기준 포맷팅 (날짜만 필요)
                const defaultStartDate = sevenDaysAgo.toISOString().split('T')[0];
                const defaultEndDate = now.toISOString().split('T')[0];

                // 1. 날짜 입력 필드에 기본 기간 설정 (UI 업데이트)
                const startDateEl = document.getElementById('log-date-start');
                const endDateEl = document.getElementById('log-date-end');

                if (startDateEl) startDateEl.value = defaultStartDate;
                if (endDateEl) endDateEl.value = defaultEndDate;

                // 2. loadScanLogs를 계산된 기본 기간을 포함하여 호출
                this.loadScanLogs(uid, defaultStartDate, defaultEndDate);

                // 필터링 버튼 이벤트 등록 (시작일, 종료일 사용)
                document.getElementById('filter-logs-btn').onclick = () => {
                    const startDate = document.getElementById('log-date-start').value;
                    const endDate = document.getElementById('log-date-end').value;
                    this.loadScanLogs(uid, startDate, endDate); // 함수 호출 인자 변경
                };
                document.getElementById('reset-logs-btn').onclick = () => {
                    document.getElementById('log-date-start').value = ''; // 필드 리셋
                    document.getElementById('log-date-end').value = ''; // 필드 리셋
                    this.loadScanLogs(uid);
                };

                //'목록으로 돌아가기' 버튼 이벤트 핸들러 등록
                // createDetailViewContainer에서 등록된 'detail-back-btn'에 이벤트를 연결합니다.
                document.getElementById('detail-back-btn').onclick = () => {
                    // 1. 상세 뷰 숨기기
                    document.getElementById('admin-user-detail-view').classList.add('hidden');

                    // 2. 메인 탭 뷰를 다시 표시 (AdminManager.switchTab 호출을 통해 메인 목록을 로드)
                    this.switchTab('admin-tab-list'); // 'admin-tab-list'는 메인 목록 뷰 ID입니다.
                };

            } catch (e) {
                console.error(e);
                contentDiv.innerHTML = `<p style="color:red;">정보 로드 실패: ${e.message}</p>`;
            }
        },

        // 통계 계산 도우미 함수
        calculateScanStats(docs) {
            const now = new Date();
            const stats = { today: 0, month: 0, year: 0, total: 0 };

            docs.forEach(doc => {
                const data = doc.data();
                if (!data.startTime) return;
                const date = data.startTime.toDate();

                stats.total++;

                // 같은 연도인지 확인
                if (date.getFullYear() === now.getFullYear()) {
                    stats.year++;
                    // 같은 달인지 확인
                    if (date.getMonth() === now.getMonth()) {
                        stats.month++;
                        // 같은 날인지 확인
                        if (date.getDate() === now.getDate()) {
                            stats.today++;
                        }
                    }
                }
            });
            return stats;
        },
        // 특정 업체의 검사 로그를 불러와 렌더링 (loadScanLogs)
        async loadScanLogs(uid, startDate = null, endDate = null) {
            const tbody = document.getElementById('user-scan-logs-body');
            if (!tbody) return;

            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">로그를 불러오는 중...</td></tr>';

            try {
                let logsQ = query(
                    collection(db, "scan_logs"),
                    where("userId", "==", uid),
                    orderBy("startTime", "desc")
                );

                // 기간 필터링 적용 로직
                if (startDate && endDate) {
                    const startTimestamp = new Date(startDate);
                    const endTimestamp = new Date(endDate);

                    // 종료일은 해당 날짜의 끝(다음 날 00:00:00)까지 포함하도록 하루를 더합니다.
                    endTimestamp.setDate(endTimestamp.getDate() + 1);

                    // Firebase 쿼리 재구성
                    logsQ = query(
                        collection(db, "scan_logs"),
                        where("userId", "==", uid),
                        where("startTime", ">=", startTimestamp),
                        where("startTime", "<", endTimestamp), // 종료일의 다음 날 0시 미만
                        orderBy("startTime", "desc")
                    );

                    // 유효성 검사
                    if (startTimestamp.getTime() >= endTimestamp.getTime()) {
                        throw new Error("검색 시작일은 종료일보다 이전이어야 합니다.");
                    }
                } else if (startDate || endDate) {
                    // 날짜가 하나만 입력된 경우 경고
                    throw new Error("기간 검색을 위해 시작일과 종료일을 모두 입력해야 합니다.");
                }

                const logsSnap = await getDocs(logsQ);

                console.log(`[Admin Log] ${uid} 업체의 로그 ${logsSnap.size}건 발견됨.`);

                if (logsSnap.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">검사 기록이 없습니다.</td></tr>';
                    return;
                }

                let html = '';
                logsSnap.forEach(doc => {

                    const log = doc.data();

                    const startTime = log.startTime && typeof log.startTime.toDate === 'function' ?
                        new Date(log.startTime.toDate()) : null;

                    const endTime = log.endTime && typeof log.endTime.toDate === 'function' ?
                        new Date(log.endTime.toDate()) : null;

                    const dateStr = startTime ? startTime.toLocaleString('ko-KR') : '-';
                    const statusClass = log.status === 'completed' ? 'color:green' : (log.status === 'error' ? 'color:red' : 'color:orange');

                    let durationStr = '-';
                    if (startTime && endTime) {
                        const diffMs = endTime - startTime;
                        const seconds = Math.floor(diffMs / 1000);
                        if (seconds > 60) {
                            durationStr = `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
                        } else {
                            durationStr = `${seconds}초`;
                        }
                    }

                    html += `
                        <tr>
                            <td>${dateStr}</td>
                            <td>${log.deviceMode || '-'}</td>
                            <td style="${statusClass}; font-weight:bold;">${log.status.toUpperCase()}</td>
                            <td>${durationStr}</td>
                            <td style="font-size:12px; color:#d9534f;">${log.errorMessage || '-'}</td>
                        </tr>
                        `;
                });

                tbody.innerHTML = html;

            } catch (e) {
                if (e.message.includes("시작일")) {
                    alert(e.message);
                }
            }
        },

        renderDetailReports(snapshot) {
            // 테이블 컬럼이 4개이므로 colspan도 4로 설정
            if (snapshot.empty) return '<tr><td colspan="4" style="text-align:center;">제출된 리포트가 없습니다.</td></tr>';

            let html = '';
            snapshot.forEach(doc => {
                const r = doc.data();

                // Firestore Timestamp 객체 안전 체크 및 날짜 문자열 변환
                let dateStr = '-';
                if (r.reportedAt && typeof r.reportedAt.toDate === 'function') {
                    const dateObj = r.reportedAt.toDate();
                    dateStr = dateObj.toLocaleString('ko-KR');
                } else if (r.reportedAt) {
                    // Timestamp 객체가 아닐 경우
                    const dateObj = new Date(r.reportedAt);
                    dateStr = dateObj.toLocaleString('ko-KR');
                }

                // 탐지 결과 표시
                const threat = r.threatCount > 0 ? `<b style="color:red;">위협 ${r.threatCount}건</b>` : '<span style="color:green;">안전</span>';

                html += `
                <tr>
                    <td>${dateStr}</td> <td>${r.message || '-'}</td>
                    <td>${threat}</td>
                    <td>
                        <button class="control-btn" style="background:#555; color:white; border:none; padding: 5px 10px; border-radius: 4px;"
                                onclick="window.viewReportDetail('${doc.id}')">상세보기</button>
                    </td>
                </tr>
                `;
            });
            return html;
        },

        // ----------------------------------------------------
        // [NEW] 비정상 로그 (에러, 튕김) 모아보기
        // ----------------------------------------------------
        async loadAbnormalLogs() {
            const tbody = document.getElementById('abnormal-log-body');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">로그 검색 중...</td></tr>';

            try {
                // 모든 로그를 긁어서 JS로 필터링 (Firestore 복합 쿼리 제한 때문)
                // 최적화: 최근 100~200개만 가져오거나 날짜 제한을 두는 것이 좋음
                const q = query(collection(db, "scan_logs"), orderBy("startTime", "desc"), limit(200));
                const snapshot = await getDocs(q);

                let html = '';
                let count = 0;

                snapshot.forEach(doc => {
                    const log = doc.data();

                    let type = null;
                    // 1. 상태가 error인 경우
                    if (log.status === 'error') type = 'ERROR';
                    // 2. 상태가 started인데 endTime이 없는 경우 (진행중일수도 있으나 오래된거면 튕긴것)
                    else if (log.status === 'started' && !log.endTime) {
                        // 시작한지 1시간 지났는데 안 끝난거면 튕긴걸로 간주
                        const startTime = log.startTime ? log.startTime.toDate() : new Date();
                        const diff = (new Date() - startTime) / 1000 / 60; // 분
                        if (diff > 60) type = 'INCOMPLETE';
                    }

                    if (type) {
                        count++;
                        const date = log.startTime ? new Date(log.startTime.toDate()).toLocaleString() : '-';
                        const badgeClass = type === 'ERROR' ? 'badge-error' : 'badge-incomplete';
                        const msg = type === 'ERROR' ? (log.errorMessage || '원인 불명 에러') : '종료 기록 없음(강제종료 의심)';

                        html += `
                        <tr>
                            <td>${date}</td>
                            <td>${log.companyName || 'Unknown'} (${log.userId})</td>
                            <td>${log.deviceMode || '-'}</td>
                            <td><span class="abnormal-badge ${badgeClass}">${type}</span></td>
                            <td style="color:#d9534f; font-size:13px;">${msg}</td>
                        </tr>
                    `;
                    }
                });

                if (count === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:green;">🎉 최근 발견된 비정상 로그가 없습니다.</td></tr>';
                } else {
                    tbody.innerHTML = html;
                }

            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로그 로드 실패: ${e.message}</td></tr>`;
            }
        },
        // [탭 3] 전송된 리포트 로딩 (신규 기능)
        async loadReports() {
            const tbody = document.getElementById('admin-reports-body');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">데이터 조회 중...</td></tr>';

            try {
                // 1. 리포트 데이터 가져오기
                const q = query(collection(db, "reported_logs"), orderBy("reportedAt", "desc"));
                const querySnapshot = await getDocs(q);

                tbody.innerHTML = '';
                if (querySnapshot.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">전송된 기록이 없습니다.</td></tr>';
                    return;
                }

                querySnapshot.forEach((docSnap) => {
                    const report = docSnap.data();
                    const date = report.reportedAt ? new Date(report.reportedAt.toDate()).toLocaleString() : '-';

                    // ★ [핵심] 저장된 이름을 바로 씀 (없으면 기존 방식대로 ID 표시)
                    // 예전 로그(이름 저장 안 된 것)를 위해 OR(||) 연산자 사용
                    const displayName = report.agencyName || report.agencyId;

                    const row = document.createElement('tr');

                    row.innerHTML = `
                        <td>${date}</td>
                        <td>
                            <b>${displayName}</b><br>
                            ${report.agencyName ? `<span style="font-size:11px; color:#888;">(${report.agencyId})</span>` : ''}
                        </td>
                        <td>${report.message || '내용 없음'}</td>
                        <td>
                            위협: <b style="color:red;">${report.threatCount}</b>건<br>
                            <span style="font-size:11px; color:#666;">${report.deviceModel || '-'}</span>
                        </td>
                        <td>
                            <button class="control-btn" onclick="window.viewReportDetail('${docSnap.id}')">상세보기</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });

            } catch (error) {
                console.error(error);
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로드 실패: ${error.message}</td></tr>`;
            }
        }
    };

    // ★★★ [수정 2] AdminManager를 전역 window 객체에 등록 (HTML onclick에서 접근 가능하게) ★★★
    window.AdminManager = AdminManager;

    // [전역 함수] 전송된 리포트 상세보기 (임시)
    window.viewReportDetail = async (reportId) => {
        // 1. 화면 요소 가져오기
        const detailScreen = document.getElementById('admin-report-detail-screen');
        const adminScreen = document.getElementById('admin-screen');

        if (!detailScreen || !adminScreen) return;

        try {
            // DB에서 데이터 가져오기
            const docRef = doc(db, "reported_logs", reportId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                alert("삭제된 리포트입니다.");
                return;
            }

            const data = docSnap.data();

            // --- [1] 헤더 및 기본 정보 바인딩 ---
            // 날짜 변환 (Firestore Timestamp -> Date)
            let dateStr = '-';
            if (data.reportedAt) {
                // Timestamp 객체면 toDate(), 아니면 그대로 사용
                const dateObj = data.reportedAt.toDate ? data.reportedAt.toDate() : new Date(data.reportedAt);
                dateStr = dateObj.toLocaleString('ko-KR');
            }

            document.getElementById('view-doc-id').textContent = reportId.substring(0, 8).toUpperCase();
            document.getElementById('view-report-time').textContent = dateStr;

            // --- [2] 요약 정보 카드 (데이터 구조 직접 접근) ---
            // Agency Info
            document.getElementById('view-agency-name').textContent = data.agencyName || '-';
            document.getElementById('view-agency-id').textContent = data.agencyId || '-';
            document.getElementById('view-agency-email').textContent = data.agencyEmail || '-';

            // Client Info
            const client = data.clientInfo || {};
            document.getElementById('view-client-name').textContent = client.name || '익명';
            document.getElementById('view-client-phone').textContent = client.phone || '-';
            document.getElementById('view-client-dob').textContent = client.dob || '-';

            // Device Info
            const device = data.deviceInfo || {};
            document.getElementById('view-device-model').textContent = device.model || '-';
            document.getElementById('view-device-os').textContent = (device.os || '-').toUpperCase();
            document.getElementById('view-device-serial').textContent = device.serial || '-';

            // Message
            document.getElementById('view-message-text').textContent = data.message || '특이사항 없음';

            // --- [3] 위협 앱 상세 리스트 생성 (핵심) ---
            const apps = data.suspiciousApps || [];
            const threatListEl = document.getElementById('view-threat-list');
            document.getElementById('view-threat-count').textContent = apps.length;

            threatListEl.innerHTML = ''; // 초기화

            if (apps.length === 0) {
                threatListEl.innerHTML = `<div style="text-align:center; padding:30px; color:#28a745; background:white; border-radius:8px;">✅ 탐지된 위협이 없습니다. (Clean Device)</div>`;
            } else {
                apps.forEach((app, index) => {
                    // 앱 이름 포맷팅 (패키지명에서 추출)
                    let appName = "Unknown App";
                    if (app.packageName) {
                        const parts = app.packageName.split('.');
                        appName = parts.length > 1 ? parts[parts.length - 1] : app.packageName;
                        appName = appName.charAt(0).toUpperCase() + appName.slice(1);
                    }

                    // 권한 리스트 생성 (HTML)
                    let permissionHtml = '';
                    if (app.grantedList && app.grantedList.length > 0) {
                        permissionHtml = app.grantedList.map(perm => {
                            const shortPerm = perm.replace('android.permission.', '');
                            return `<span class="perm-badge granted">✔ ${shortPerm}</span>`;
                        }).join('');
                    } else {
                        permissionHtml = '<span style="font-size:11px; color:#999;">허용된 중요 권한 없음</span>';
                    }

                    // 상세 정보 카드 생성
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
                                <label>🔑 허용된 주요 권한 (${app.grantedCount || 0}개)</label>
                                <div class="perm-container">
                                    ${permissionHtml}
                                </div>
                            </div>
                        </div>
                    `;
                    threatListEl.appendChild(card);
                });
            }

            // --- [4] 화면 전환 ---
            adminScreen.style.display = 'none';
            adminScreen.classList.remove('active');

            detailScreen.style.display = 'block';
            detailScreen.classList.add('active');
            detailScreen.classList.remove('hidden');
            detailScreen.scrollTop = 0; // 스크롤 맨 위로

        } catch (e) {
            console.error("상세보기 오류:", e);
            alert("정보를 불러오는 중 오류가 발생했습니다: " + e.message);
        }
    };

    // [뒤로가기 버튼 이벤트]
    const detailBackBtn = document.getElementById('admin-detail-back-btn');
    if (detailBackBtn) {
        detailBackBtn.addEventListener('click', () => {
            const detailScreen = document.getElementById('admin-report-detail-screen');
            const adminScreen = document.getElementById('admin-screen');

            detailScreen.style.display = 'none';
            detailScreen.classList.remove('active');

            adminScreen.style.display = 'block';
            adminScreen.classList.add('active');
        });
    }

    window.toggleAnalysis = (header) => {
        const content = header.nextElementSibling;
        if (content.style.display === "block") {
            content.style.display = "none";
        } else {
            content.style.display = "block";
        }
    };

    // [전역 함수 노출] HTML onclick에서 호출하기 위해 window에 등록
    window.toggleLock = async (uid, shouldLock) => {
        if (!await CustomUI.confirm(shouldLock ? "🚫 이 업체의 사용을 막으시겠습니까?" : "✅ 차단을 해제하시겠습니까?")) return; try {
            await updateDoc(doc(db, "users", uid), { isLocked: shouldLock });
            if (AdminManager.currentUserUid === uid) AdminManager.viewUserDetail(uid);
            else AdminManager.loadUsers();
        } catch (e) { await CustomUI.alert("처리 실패: " + e.message); }
    };

    window.changeQuota = async (uid, currentQuota) => {
        console.log(`횟수 변경 클릭됨: ${uid}, 현재: ${currentQuota}`); // 디버깅용 로그

        // CustomUI가 아직 로드되지 않았을 경우를 대비한 안전장치
        if (typeof CustomUI === 'undefined') {
            alert("시스템 로딩 중입니다. 잠시 후 다시 시도해주세요.");
            return;
        }

        const input = await CustomUI.prompt(`[횟수 조정]\n현재 횟수: ${currentQuota}회\n\n추가(+)하거나 차감(-)할 수량을 입력하세요.\n(예: 10 또는 -5)`, "0");

        if (!input) return; // 취소 누름
        const change = parseInt(input, 10);

        if (isNaN(change)) {
            await CustomUI.alert("❌ 숫자만 입력해주세요.");
            return;
        }
        if (change === 0) return;

        try {
            // 결과값 미리 계산
            const newQuota = parseInt(currentQuota) + change;
            if (newQuota < 0) {
                await CustomUI.alert("❌ 횟수는 0보다 작을 수 없습니다.");
                return;
            }

            // DB 업데이트 (increment 사용)
            const userRef = doc(db, "users", uid);
            await updateDoc(userRef, {
                quota: increment(change)
            });

            await CustomUI.alert(`✅ 변경 완료!\n${currentQuota}회 -> ${newQuota}회`);

            // 화면 새로고침 (상세페이지 보고 있으면 상세페이지 갱신, 아니면 목록 갱신)
            if (AdminManager.currentUserUid === uid) {
                AdminManager.viewUserDetail(uid);
            } else {
                AdminManager.loadUsers();
            }

        } catch (e) {
            console.error(e);
            await CustomUI.alert("변경 실패: " + e.message);
        }
    };

    window.electronAPI.onUpdateStart((version) => {
        const modal = document.getElementById('update-modal');
        const verText = document.getElementById('update-ver-text');
        verText.textContent = `V${version}으로 업데이트를 시작합니다.`;
        modal.classList.remove('hidden');
    });

    // 업데이트 진행 중
    window.electronAPI.onUpdateProgress((data) => {
        const fill = document.getElementById('update-progress-fill');
        const percentText = document.getElementById('update-percent');
        const speedText = document.getElementById('update-speed');
        const sizeText = document.getElementById('update-size-info');

        fill.style.width = `${data.percent}%`;
        percentText.textContent = `${data.percent}%`;
        speedText.textContent = data.bytesPerSecond;
        sizeText.textContent = `${data.transferred} / ${data.total}`;
    });

    // 에러 발생 시
    window.electronAPI.onUpdateError(async (msg) => {
        await CustomUI.alert("업데이트 중 오류가 발생했습니다: " + msg);
        document.getElementById('update-modal').classList.add('hidden');
    });

    window.viewHistory = async (uid) => {
        const modal = document.getElementById('admin-result-modal');
        const content = document.getElementById('admin-result-content');
        modal.classList.remove('hidden');
        content.innerHTML = "데이터 조회 중...";

        try {
            // users -> uid -> scanResults 서브컬렉션 조회
            const historyRef = collection(db, "users", uid, "scanResults");
            const q = query(historyRef, orderBy("date", "desc"));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                content.innerHTML = "<p>📭 제출된 검사 결과가 없습니다.</p>";
                return;
            }

            let html = `<ul class="file-list" style="max-height:400px;">`;
            snapshot.forEach(doc => {
                const data = doc.data();
                const date = data.date ? new Date(data.date.toDate()).toLocaleString() : '날짜 없음';
                const threatCount = data.threatCount || 0;
                const style = threatCount > 0 ? 'color:red; font-weight:bold;' : 'color:green;';

                html += `
                    <li style="padding:10px; border-bottom:1px solid #eee;">
                        <div>🕒 <b>${date}</b></div>
                        <div style="${style}">결과: 스파이앱 ${threatCount}개 발견</div>
                        <div style="font-size:12px; color:#666;">모델: ${data.model} (Serial: ${data.serial})</div>
                    </li>
                `;
            });
            html += "</ul>";
            content.innerHTML = html;

        } catch (e) {
            content.innerHTML = `<p style="color:red;">기록 조회 실패: ${e.message}</p>`;
        }
    };

    window.deleteUser = async (uid, name) => {
        const msg = `⚠️ [삭제 경고]\n\n업체명: ${name}\n\n정말로 삭제하시겠습니까?\n삭제된 업체는 더 이상 로그인할 수 없으며, 모든 데이터가 제거됩니다.`;

        // confirm 창 띄우기
        if (!await CustomUI.confirm(msg)) return;

        try {
            // 1. Firestore 문서 삭제
            // (import { deleteDoc, doc } ... 가 되어 있어야 함)
            await deleteDoc(doc(db, "users", uid));

            // 2. 알림 및 새로고침
            await CustomUI.alert("🗑️ 업체가 삭제되었습니다.");
            // 상세페이지 보고 있었다면 목록으로 강제 이동
            document.getElementById('admin-user-detail-view').classList.add('hidden');
            document.getElementById('admin-tab-list').classList.remove('hidden');
            AdminManager.loadUsers();

        } catch (e) {
            console.error("삭제 실패:", e);
            await CustomUI.alert("삭제 실패: " + e.message);
        }
    };

    // =========================================================
    // [결과 전송] 서버로 검사 결과 데이터 전송
    // =========================================================
    const reportResultsBtn = document.getElementById('report-results-btn');
    if (reportResultsBtn) {
        reportResultsBtn.addEventListener('click', async () => {

            // 1. 데이터 유효성 검사
            if (!State.lastScanData) {
                await CustomUI.alert("전송할 검사 결과 데이터가 없습니다.");
                return;
            }

            // 2. 전송 여부 확인 (메시지 입력 받기)
            // (입력창이 없으면 그냥 confirm으로 대체 가능, 여기선 prompt 사용)
            const message = await CustomUI.prompt("서버로 결과를 전송하시겠습니까?\n관리자에게 남길 메모가 있다면 적어주세요.", "특이사항 없음");
            if (message === null) return; // 취소 누름

            reportResultsBtn.disabled = true;
            reportResultsBtn.textContent = "전송 중...";

            try {
                // 3. 데이터 수집
                const user = auth.currentUser;
                const scanData = State.lastScanData;

                // ★★★ [추가] 업체명 가져오기 (DB에서 조회) ★★★
                let currentCompanyName = "알 수 없는 업체";
                let currentAgencyEmail = "-";

                if (user) {
                    currentAgencyEmail = user.email;
                    try {
                        const uSnap = await getDoc(doc(db, "users", user.uid));
                        if (uSnap.exists()) {
                            currentCompanyName = uSnap.data().companyName || user.email;
                        }
                    } catch (e) {
                        console.error("업체명 조회 실패:", e);
                    }
                }

                // (1) 고객 정보 (입력폼에서 가져옴)
                // 익명일 경우 값 처리는 client-info-form 로직을 따름
                const clientName = document.getElementById('client-name').value || "익명";
                const clientDob = document.getElementById('client-dob').value || "0000-00-00";
                const clientPhone = document.getElementById('client-phone').value || "000-0000-0000";

                // 발견앱 목록
                const detectedApps = scanData.suspiciousApps

                // (2) 기기 정보
                const deviceInfo = {
                    model: scanData.deviceInfo.model,
                    serial: scanData.deviceInfo.serial,
                    os: State.currentDeviceMode // 'android' or 'ios'
                };

                // 4. Firestore 전송
                await addDoc(collection(db, "reported_logs"), {
                    agencyId: user ? user.uid : 'anonymous_agent', // 보낸 업체 ID
                    agencyName: currentCompanyName,
                    agencyEmail: user ? user.email : '-',          // 보낸 업체 이메일

                    // --- 요청하신 핵심 데이터 ---
                    clientInfo: {
                        name: clientName,
                        dob: clientDob,
                        phone: clientPhone
                    },
                    deviceInfo: deviceInfo,
                    suspiciousApps: detectedApps,

                    // --- 관리용 메타 데이터 ---
                    threatCount: detectedApps.length,
                    message: message, // 아까 입력받은 메모
                    reportedAt: serverTimestamp() // 서버 시간
                });

                await CustomUI.alert("✅ 결과가 서버로 성공적으로 전송되었습니다.");

            } catch (error) {
                console.error("전송 실패:", error);
                await CustomUI.alert("전송 실패: " + error.message);
            } finally {
                reportResultsBtn.disabled = false;
                reportResultsBtn.textContent = "📡 서버 전송";
            }
        });
    }

    // renderer.js 파일 내 (주요 함수 영역에 추가)

    /**
     * SemVer(Semantic Versioning) 규칙에 따라 두 버전 문자열을 비교합니다.
     * @param {string} a - 비교할 첫 번째 버전 (예: '1.0.10')
     * @param {string} b - 비교할 두 번째 버전 (예: '1.1.0')
     * @returns {number} 1: a가 더 큼, -1: b가 더 큼, 0: 두 버전이 같음
     */
    function compareVersions(a, b) {
        // 버전을 점(.) 기준으로 나눕니다.
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);

        // Major, Minor, Patch 순서로 각 부분을 비교합니다.
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;

            if (numA > numB) {
                return 1; // A가 B보다 큼
            }
            if (numA < numB) {
                return -1; // B가 A보다 큼
            }
        }

        return 0; // 두 버전이 같음
    }
});