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

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', () => {
    console.log('--- renderer.js: DOM 로드 완료 ---');

    const ID_DOMAIN = "@bd.com";
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
            parentView.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const screenToShow = parentView.querySelector(`#${screenId}`);
            if (screenToShow) screenToShow.classList.add('active');
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

    // 로그인 처리
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const inputId = document.getElementById('username').value.trim();
            const email = inputId + ID_DOMAIN;
            const password = document.getElementById('password').value;
            const errorMsg = document.getElementById('login-error');

            errorMsg.textContent = "로그인 중...";

            try {
                // 1. Firebase 로그인
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 2. 권한 확인 (DB 조회)
                const role = await checkUserRole(user.uid);
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
        const isValid = isNameValid && isDobValid && isPhoneValid;
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

            const ui = {
                icon: document.getElementById('connection-status-icon'),
                title: document.getElementById('connection-status-title'),
                desc: document.getElementById('connection-status-desc')
            };

            // 1. Android 확인
            try {
                const android = await window.electronAPI.checkDeviceConnection();
                if (android.status === 'connected') {
                    State.currentDeviceMode = 'android';
                    this.setUI(ui, '✅', 'Android 연결됨', android.model, '#5CB85C');
                    return;
                } else if (android.status === 'unauthorized') {
                    State.currentDeviceMode = null;
                    this.setUI(ui, '🔒', '승인 대기 중', '휴대폰에서 USB 디버깅을 허용해주세요.', '#F0AD4E', false);
                    return;
                }
            } catch (e) { }

            // 2. iOS 확인
            try {
                const ios = await window.electronAPI.checkIosConnection();
                if (ios.status === 'connected') {
                    State.currentDeviceMode = 'ios';
                    State.currentUdid = ios.udid;
                    this.setUI(ui, '🍎', 'iPhone 연결됨', ios.model, '#5CB85C');
                    return;
                }
            } catch (e) { }

            // 3. 연결 없음
            State.currentDeviceMode = null;
            this.setUI(ui, '🔌', '기기를 연결해주세요', 'Android 또는 iOS 기기를 USB로 연결하세요.', '#333', false);
        },

        setUI(ui, iconText, titleText, descText, color, showBtn = true) {
            ui.icon.textContent = iconText;
            ui.title.textContent = titleText;
            ui.title.style.color = color;
            ui.desc.innerHTML = descText.includes('연결') || descText.includes('허용') ? descText : `모델: <strong>${descText}</strong>`;

            const btnContainer = document.getElementById('start-scan-container');
            btnContainer.style.display = showBtn ? 'block' : 'none';

            // 잔상 방지 리셋
            if (showBtn && !btnContainer.dataset.visible) {
                btnContainer.dataset.visible = "true";
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

    const ScanController = {

        currentLogId: null,
        // ★★★ [수정됨] 실제 앱 목록을 활용한 정밀 검사 연출 ★★★
        async startAndroidScan() {
            // 1. 초기 멘트 및 리얼 검사 시작 (백그라운드)
            ViewManager.updateProgress(1, "디바이스 파일 시스템에 접근 중...");

            let scanData = null;
            try {
                // 실제 검사는 여기서 순식간에 끝냅니다. (데이터 확보용)
                scanData = await window.electronAPI.runScan();
            } catch (error) {
                this.handleError(error);
                return;
            }

            // 2. 시간 설정 확인 (설정값 없으면 즉시 완료)
            const targetMinutes = State.androidTargetMinutes || 0;
            if (targetMinutes === 0) {
                this.finishScan(scanData);
                return;
            }

            // 3. Theater Mode 진입 (설정된 시간동안 연기 시작)
            const apps = scanData.allApps || [];
            const totalApps = apps.length;

            // 앱이 하나도 없는 경우(예외)는 바로 종료
            if (totalApps === 0) {
                this.finishScan(scanData);
                return;
            }

            // 시간 계산
            // 전체 목표 시간(밀리초)
            const totalDurationMs = targetMinutes * 60 * 1000;

            // 앱 하나당 보여줄 시간 (최소 0.1초 ~ 최대 제한 없음)
            // 예: 10분(600초) / 앱 100개 = 앱 하나당 6초씩 "분석중..." 표시
            const timePerApp = totalDurationMs / totalApps;

            console.log(`[Theater Mode] 총 ${totalApps}개 앱, 목표 ${targetMinutes}분, 개당 ${(timePerApp / 1000).toFixed(2)}초 소요`);

            let currentIndex = 0;

            // ★ 애니메이션 루프 함수
            const processNextApp = () => {
                // 종료 조건: 모든 앱을 다 보여줬으면 끝
                if (currentIndex >= totalApps) {
                    this.finishScan(scanData);
                    return;
                }

                const app = apps[currentIndex];
                const appName = Utils.formatAppName(app.packageName);

                // 진행률 계산 (현재 순번 / 전체 갯수)
                // 100%는 finishScan에서 찍으므로 최대 99%까지만
                const percent = Math.min(99, Math.floor(((currentIndex + 1) / totalApps) * 100));

                // 화면 갱신: "카카오톡 - com.kakao.talk 정밀 해시 분석 중..."
                ViewManager.updateProgress(
                    percent,
                    `[${currentIndex + 1}/${totalApps}] ${appName} - ${app.packageName} 정밀 분석 중...`
                );

                currentIndex++;

                // 다음 앱으로 넘어가는 타이머
                setTimeout(processNextApp, timePerApp);
            };

            // 루프 시작
            processNextApp();
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
                const rawData = await window.electronAPI.runIosScan(State.currentUdid);
                if (rawData.error) throw new Error(rawData.error);
                const data = Utils.transformIosData(rawData);
                this.finishScan(data);
            } catch (error) {
                this.handleError(error);
            }
        },



        finishScan(data) {
            this.endLogTransaction('completed');
            ViewManager.updateProgress(100, "분석 완료! 결과 리포트를 생성합니다.");
            State.lastScanData = data;
            window.lastScanData = data;

            setTimeout(() => {
                ResultsRenderer.render(data);
                ViewManager.showScreen(loggedInView, 'scan-results-screen');
            }, 1000); // 1초 뒤 결과 화면으로 전환
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
    // [7] 결과 렌더링 (RESULTS RENDERER)
    // =========================================================
    const ResultsRenderer = {
        render(data) {
            // 화면 초기화
            document.getElementById('results-dashboard-view').classList.remove('hidden');
            document.getElementById('app-detail-view').classList.add('hidden');

            // 1. 기기 정보
            document.getElementById('res-model').textContent = data.deviceInfo.model;
            document.getElementById('res-serial').textContent = data.deviceInfo.serial;
            const rootEl = document.getElementById('res-root');
            rootEl.textContent = data.deviceInfo.isRooted ? '⚠️ 발견됨 (ROOTED)' : '✅ 안전함';
            rootEl.style.color = data.deviceInfo.isRooted ? '#D9534F' : '#5CB85C';
            document.getElementById('res-phone').textContent = data.deviceInfo.phoneNumber;

            // 2. 앱 그리드 (전체)
            const grid = document.getElementById('app-grid-container');
            grid.innerHTML = '';
            data.allApps.forEach(app => this.createAppIcon(app, grid));

            // 3. 백그라운드 앱 그리드
            const bgGrid = document.getElementById('bg-app-grid-container');
            if (bgGrid) {
                bgGrid.innerHTML = '';
                const runningApps = data.allApps ? data.allApps.filter(app => app.isRunningBg) : [];
                if (runningApps.length === 0) bgGrid.innerHTML = '<p style="color:#888; padding:10px;">백그라운드 실행 앱 없음</p>';
                else runningApps.forEach(app => this.createAppIcon(app, bgGrid));
            }

            // 4. 파일 리스트
            const apkList = document.getElementById('res-apk-list');
            apkList.innerHTML = data.apkFiles.length ? data.apkFiles.map(f => `<li>${f}</li>`).join('') : '<li>없음</li>';

            // 5. 의심 앱 리스트
            this.renderSuspiciousList(data.suspiciousApps);
        },

        // 아이콘 생성 로직 (이미지 로딩 + 폴백)
        createAppIcon(app, container) {
            const div = document.createElement('div');
            const isSuspicious = app.reason ? true : false;
            div.className = `app-item ${isSuspicious ? 'suspicious' : ''}`;

            // 초기 이름 설정 (캐시된 것 우선, 없으면 포맷팅된 이름)
            const initialName = app.cachedTitle || Utils.formatAppName(app.packageName);

            div.innerHTML = `
        <div class="app-icon-wrapper">
            <img src="" class="app-real-icon" style="display:none;" alt="${initialName}">
            <span class="app-fallback-icon" style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:24px;">📱</span>
        </div>
        <div class="app-display-name">${initialName}</div>
        <div class="app-package-sub">${app.packageName}</div>
    `;

            // 1. 엘리먼트 참조
            const imgTag = div.querySelector('.app-real-icon');
            const spanTag = div.querySelector('.app-fallback-icon');

            // 2. 로컬 파일 경로 매핑 함수
            const getLocalIconPath = (appData) => {
                if (appData.reason) {
                    return './assets/SpyAppLogo.png'; 
                }
                // Play Store URL이 없거나 시스템 앱으로 간주될 때 (API 실패 또는 정보 부족)
                return './assets/systemAppLogo.png';
            };

            // 3. 이미지 로딩 실패/폴백 핸들러 (재사용 가능)
            const handleImageError = (isLocalFallback = false) => {
                if (isLocalFallback) {
                    // 로컬 이미지까지 실패한 경우: 최종 📱 아이콘 표시
                    imgTag.style.display = 'none';
                    spanTag.style.display = 'flex';
                    return;
                }
                
                // Play Store 이미지 로딩 실패 시: 로컬 대체 이미지 시도
                const localPath = getLocalIconPath(app);
                
                if (localPath) {
                    imgTag.src = localPath;
                    imgTag.style.display = 'block';
                    spanTag.style.display = 'none';
                    
                    // 로컬 이미지 로딩 실패 시: 최종 fallback으로 연결
                    imgTag.onerror = () => handleImageError(true); 
                } else {
                    // 로컬 대체 경로가 없는 경우, 최종 fallback 실행
                    handleImageError(true);
                }
            };
            
            // 모든 이미지 로딩 실패에 대해 로컬 대체 시도 로직을 걸어둡니다.
            imgTag.onerror = () => handleImageError(false);


            // 4. [캐시 및 API 로드 시작]
            if (app.cachedIconUrl) {
                // 캐시된 URL로 로딩 시작 (실패하면 onerror 핸들러가 처리)
                imgTag.src = app.cachedIconUrl;
                imgTag.style.display = 'block';
                spanTag.style.display = 'none';

            } else if (!app.cachedIconUrl || !app.cachedTitle) {
                // API 요청 (정보 부족 시)
                window.electronAPI.getAppData(app.packageName).then(result => {
                    if (!result || !result.icon) {
                        // API에서 아이콘 URL을 못 가져온 경우 로컬 대체 시도
                        handleImageError(false); 
                        return;
                    } 
                    
                    // API에서 성공적으로 URL을 받은 경우:
                    app.cachedIconUrl = result.icon; // 캐싱
                    
                    // imgTag.src를 설정하여 로딩 시작. 실패하면 onerror 핸들러가 처리합니다.
                    imgTag.src = result.icon;
                    imgTag.onload = () => {
                        imgTag.style.display = 'block';
                        spanTag.style.display = 'none';
                    };
                    
                    // [B] 타이틀 처리
                    if (result.title) {
                        app.cachedTitle = result.title;
                        div.querySelector('.app-display-name').textContent = result.title;
                    }
                    
                }).catch(() => { 
                    // API 요청 자체 실패 시 로컬 대체 시도
                    handleImageError(false);
                 });
            }

            // 클릭 이벤트
            div.addEventListener('click', () => {
                // 클릭 시점의 최신 이름 사용
                const currentName = div.querySelector('.app-display-name').textContent;
                AppDetailManager.show(app, currentName);
            });

            container.appendChild(div);
        },

        renderSuspiciousList(suspiciousApps) {
            const suspList = document.getElementById('suspicious-list-container');
            if (suspiciousApps && suspiciousApps.length > 0) {
                let html = '<ul style="list-style:none; padding:0;">';
                suspiciousApps.forEach(app => {
                    // 여기도 캐시된 타이틀이 있으면 사용
                    const dName = app.cachedTitle || Utils.formatAppName(app.packageName);
                    const reason = app.reason || "알 수 없는 위협";
                    let vtBadge = app.vtResult && app.vtResult.malicious > 0 ? `<span style="background:#d9534f; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🦠 VT: ${app.vtResult.malicious}</span>` : '';
                    html += `
                        <li style="padding:15px; border-bottom:1px solid #eee; border-left: 4px solid #D9534F; background-color: #fff5f5; margin-bottom: 10px; border-radius: 4px;">
                            <div style="color:#D9534F; font-weight:bold; font-size: 15px; margin-bottom: 4px;">
                                🚨 ${dName} ${vtBadge} <span style="font-size:12px; font-weight:normal; color:#888;">(${app.packageName})</span>
                            </div>
                            <div style="font-size:13px; color:#555;">${reason}</div>
                        </li>`;
                });
                suspList.innerHTML = html + '</ul>';
            } else {
                suspList.innerHTML = '<p style="color:#5CB85C; padding:10px;">✅ 탐지된 스파이앱이 없습니다.</p>';
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
            document.getElementById('detail-sideload').textContent = app.isSideloaded ? '외부 설치' : 'Play Store';
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

            // [Case A] 캐시된 아이콘이 있으면 즉시 표시
            if (app.cachedIconUrl) {
                img.src = app.cachedIconUrl;
                img.style.display = 'block';
                span.style.display = 'none';
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

            document.getElementById('app-detail-view').scrollTo({top:0});
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

    // 3. 인쇄
    const printResultsBtn = document.getElementById('print-results-btn');
    if (printResultsBtn) {
        printResultsBtn.addEventListener('click', () => {
            if (!window.lastScanData) {
                alert("인쇄할 검사 결과가 없습니다.");
                return;
            }
            const data = window.lastScanData;

            // 1. 헤더 정보
            const now = new Date();
            const dateStr = now.toLocaleString('ko-KR');
            document.getElementById('print-date').textContent = dateStr;
            document.getElementById('print-doc-id').textContent = `BD-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}-${Math.floor(1000+Math.random()*9000)}`;

            // 2. 기기 정보
            document.getElementById('print-model').textContent = data.deviceInfo.model;
            document.getElementById('print-serial').textContent = data.deviceInfo.serial;
            document.getElementById('print-root').textContent = data.deviceInfo.isRooted ? '발견됨 (위험)' : '안전함';
            document.getElementById('print-phone').textContent = data.deviceInfo.phoneNumber;

            // 3. 종합 판정 및 통계
            const threatCount = data.suspiciousApps.length;
            const summaryBox = document.getElementById('print-summary-box');
            
            if (threatCount > 0) {
                summaryBox.className = 'summary-box status-danger';
                summaryBox.innerHTML = `⚠️ 위험 (DANGER): 총 ${threatCount}건의 위협이 탐지되었습니다.`;
            } else {
                summaryBox.className = 'summary-box status-safe';
                summaryBox.innerHTML = `✅ 안전 (SAFE): 특이사항이 발견되지 않았습니다.`;
            }

            document.getElementById('print-total-count').textContent = data.allApps.length;
            document.getElementById('print-threat-count').textContent = threatCount;
            document.getElementById('print-file-count').textContent = data.apkFiles.length;

            // 4. 위협 탐지 내역 (표)
            const threatContainer = document.getElementById('print-threat-container');
            if (threatCount > 0) {
                let html = `<table class="detail-table"><thead><tr><th>탐지된 앱</th><th>패키지명</th><th>위협 사유</th></tr></thead><tbody>`;
                data.suspiciousApps.forEach(app => {
                    let vtInfo = '';
                    if (app.vtResult && app.vtResult.malicious > 0) {
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
                threatContainer.innerHTML = `<div style="padding:10px; border:1px solid #ccc; text-align:center; color:#5CB85C;">탐지된 위협 없음</div>`;
            }

            // 5. APK 파일 리스트
            const fileBody = document.getElementById('print-file-body');
            if (data.apkFiles.length > 0) {
                fileBody.innerHTML = data.apkFiles.map((f, i) => `<tr><td style="text-align:center;">${i+1}</td><td>${f}</td></tr>`).join('');
            } else {
                fileBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#999;">발견된 파일 없음</td></tr>`;
            }

            // 6. [부록] 전체 앱 목록 (3단 콤팩트 그리드)
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

            const printArea = document.getElementById('printable-report');
            printArea.style.display = 'block'; // ★ 이 줄이 있어야 CSS가 작동함

            setTimeout(() => {
                window.print();
                printArea.style.display = 'none'; // 인쇄 후 다시 숨김
            }, 500); // 렌더링 시간 확보
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

        // iOS 데이터를 안드로이드 포맷으로 변환
        transformIosData(iosData) {
            const suspiciousApps = iosData.suspiciousItems.map(item => ({
                packageName: item.module || item.source_file,
                reason: `[MVT 탐지] ${item.message || item.process_name || 'Suspicious Artifact'}`,
                isSideloaded: true
            }));
            const allApps = (iosData.allApps || []).map(app => ({
                packageName: app.bundle_id || 'Unknown',
                isSideloaded: false,
                isRunningBg: false
            }));
            return {
                deviceInfo: { model: iosData.deviceInfo.model, serial: 'iOS-Device', isRooted: false, phoneNumber: '-' },
                allApps, suspiciousApps, apkFiles: []
            };
        },

        // 권한 한글 매핑
        getKoreanPermission(permString) {
            const MAP = {
                'CAMERA': '📷 카메라', 'RECORD_AUDIO': '🎤 마이크 (녹음)', 'READ_CONTACTS': '📒 연락처 읽기',
                'ACCESS_FINE_LOCATION': '📍 정밀 위치 (GPS)', 'READ_SMS': '✉️ 문자 읽기', 'SEND_SMS': '✉️ 문자 보내기',
                'RECEIVE_BOOT_COMPLETED': '🔌 부팅 시 자동 실행', 'BIND_DEVICE_ADMIN': '🛡️ 기기 관리자 (삭제 방지)',
                'INTERNET': '🌐 인터넷 사용', 'READ_EXTERNAL_STORAGE': '💾 저장소 읽기'
                // ... (필요 시 더 추가)
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
        `;
            screen.appendChild(detailDiv);

            document.getElementById('detail-back-btn').addEventListener('click', () => {
                // 1. 상세뷰 숨기기
                document.getElementById('admin-user-detail-view').classList.add('hidden');

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
            document.getElementById('admin-user-detail-view').classList.add('hidden');
            this.currentUserUid = null;

            // 탭 버튼 스타일
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                if (btn.dataset.target === tabId) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            // 콘텐츠 표시
            document.querySelectorAll('.admin-tab-content').forEach(content => {
                content.classList.remove('active'); // 일단 다 숨김
                if (content.id === tabId) content.classList.add('active'); // 타겟만 표시
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
                    abContent.classList.add('active');
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
                // (업체 ID가 userId 필드와 같다고 가정)
                const reportsQ = query(collection(db, "reported_logs"), where("agencyId", "==", userData.userId), orderBy("reportedAt", "desc"));
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
                        </tr>
                    </thead>
                    <tbody id="detail-report-body">
                        ${this.renderDetailReports(reportsSnap)}
                    </tbody>
                </table>
            `;

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

        // 상세페이지 내 리포트 렌더링
        renderDetailReports(snapshot) {
            if (snapshot.empty) return '<tr><td colspan="3" style="text-align:center;">제출된 리포트가 없습니다.</td></tr>';

            let html = '';
            snapshot.forEach(doc => {
                const r = doc.data();
                const date = r.reportedAt ? new Date(r.reportedAt.toDate()).toLocaleString() : '-';
                const threat = r.threatCount > 0 ? `<b style="color:red;">위협 ${r.threatCount}건</b>` : '<span style="color:green;">안전</span>';

                html += `
                <tr>
                    <td>${date}</td>
                    <td>${r.message || '-'}</td>
                    <td>${threat}</td>
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
});