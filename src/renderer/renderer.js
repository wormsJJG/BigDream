// renderer.js
// BD (Big Dream) Security Solution - Renderer Process
// Renderer no longer talks to Firebase directly.
// Auth + Firestore are routed through the main process via IPC.
import * as firestoreProxy from './core/firestoreProxy.js';
import { createAuthService } from './services/authService.js';
import { createFirestoreService } from './services/firestoreService.js';

import { createViewManager } from './core/viewManager.js';

import { initAuthSettings } from './modules/authSettings.js';
import { initClientDevice } from './modules/clientDevice.js';
import { initScanController } from './modules/scanController.js';
import { initAppDetail } from './modules/appDetail.js';
import { initActionHandlers } from './modules/actionHandlers.js';
import { loadTemplates } from './core/templateLoader.js';

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', async () => {
    await loadTemplates();
    console.log('--- renderer.js: DOM 로드 완료 ---');

    getSaveInfo();

    // Services (composition root)
    const authService = createAuthService();
    const firestoreService = createFirestoreService(firestoreProxy);

    const ID_DOMAIN = "@bd.com";

    // [추가] 로그인 전 사이드바 메뉴 (로그인 / 고객센터)
    // =========================================================
    // NOTE: 모듈로 분리되면서 (authSettings)에서 호출해야 하므로,
    // 렌더러 부트스트랩 컨텍스트(ctx.helpers)로 내보낸다.
    const createLoggedOutNavSetup = ({ ViewManager, loggedOutView }) => () => {
        const navLogin = document.getElementById('nav-login');
        const navSupport = document.getElementById('nav-support');

        if (navLogin) {
            navLogin.addEventListener('click', () => {
                // 사이드바 active 클래스 관리
                document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
                navLogin.classList.add('active');

                // 로그인 화면만 보이게 하고 나머지는 숨김
                document.getElementById('login-screen').style.display = 'block';
                document.getElementById('support-screen').style.display = 'none';

                ViewManager.showScreen(loggedOutView, 'login-screen');
            });
        }

        if (navSupport) {
            navSupport.addEventListener('click', () => {
                // 사이드바 active 클래스 관리
                document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
                navSupport.classList.add('active');

                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('support-screen').style.display = 'block';

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
            // NOTE: 실제 입력 요소 id는 username/password 이므로 일관되게 사용
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
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
        isLoadedScan: false,     // true when a scan result is loaded via "검사 열기"
        androidTargetMinutes: 0, // 기본값 0 (즉시 완료), 히든 메뉴로 변경 가능
        iosProgressMode: 'real', // admin/distributor only: 'real' | 'random_20_30'
        agencyName: 'BD SCANNER', // 회사 정보 상태
        quota: -1, // -1은 로딩 중 또는 알 수 없음
        scrollPostion: 0
    };

    // =========================================================
    // [2] 뷰 관리자 (VIEW MANAGER)
    // =========================================================
    const ViewManager = createViewManager(State);

    // DOM 참조 캐싱 (자주 쓰는 뷰)
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');

    ViewManager.showView('logged-out-view');

    const loginScreen = document.getElementById('login-screen');

    if (loginScreen) loginScreen.style.display = 'block';

    // logged-out 사이드바 active 처리
    document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
    const navLogin = document.getElementById('nav-login');
    if (navLogin) navLogin.classList.add('active');

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
                // NOTE:
                // - inline style / innerHTML(데이터 주입) 제거
                // - 기존 동작(Enter=확인, ESC=취소, autofocus/select) 유지
                const modalOverlay = document.createElement('div');
                modalOverlay.className = 'modal bd-prompt-modal bd-modal-z10000';

                const modalBox = document.createElement('div');
                modalBox.className = 'modal-content bd-prompt-content';

                const title = document.createElement('h3');
                title.className = 'bd-prompt-title bd-preline';
                title.textContent = String(message ?? '');

                const input = document.createElement('input');
                input.type = 'text';
                input.id = 'custom-prompt-input';
                input.className = 'bd-prompt-input';
                input.value = String(defaultValue ?? '');

                const btnRow = document.createElement('div');
                btnRow.className = 'bd-prompt-actions';

                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.id = 'prompt-cancel-btn';
                cancelBtn.className = 'secondary-button bd-prompt-btn';
                cancelBtn.textContent = '취소';

                const okBtn = document.createElement('button');
                okBtn.type = 'button';
                okBtn.id = 'prompt-ok-btn';
                okBtn.className = 'primary-button bd-prompt-btn';
                okBtn.textContent = '확인';

                btnRow.appendChild(cancelBtn);
                btnRow.appendChild(okBtn);

                modalBox.appendChild(title);
                modalBox.appendChild(input);
                modalBox.appendChild(btnRow);

                modalOverlay.appendChild(modalBox);
                document.body.appendChild(modalOverlay);

                // 포커스 자동 지정
                input.focus();
                input.select();

                const cleanup = () => {
                    okBtn.removeEventListener('click', handleOk);
                    cancelBtn.removeEventListener('click', handleCancel);
                    input.removeEventListener('keydown', handleKeydown);
                    modalOverlay.remove();
                };

                const handleOk = () => {
                    const val = input.value;
                    cleanup();
                    resolve(val);
                };

                const handleCancel = () => {
                    cleanup();
                    resolve(null);
                };

                const handleKeydown = (e) => {
                    if (e.key === 'Enter') handleOk();
                    if (e.key === 'Escape') handleCancel();
                };

                okBtn.addEventListener('click', handleOk);
                cancelBtn.addEventListener('click', handleCancel);
                input.addEventListener('keydown', handleKeydown);
            });
        },

        choose(message, choices = []) {
            return new Promise((resolve) => {
                const safeChoices = Array.isArray(choices)
                    ? choices.filter(choice => choice && choice.value && choice.label)
                    : [];

                if (safeChoices.length === 0) {
                    resolve(null);
                    return;
                }

                const modalOverlay = document.createElement('div');
                modalOverlay.className = 'modal bd-prompt-modal bd-modal-z10000';

                const modalBox = document.createElement('div');
                modalBox.className = 'modal-content bd-prompt-content';

                const title = document.createElement('h3');
                title.className = 'bd-prompt-title bd-preline';
                title.textContent = String(message ?? '');

                const buttonGroup = document.createElement('div');
                buttonGroup.className = 'bd-choice-actions';

                const buttons = safeChoices.map((choice, index) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = index === 0
                        ? 'primary-button bd-choice-btn'
                        : 'secondary-button bd-choice-btn';
                    btn.textContent = String(choice.label);
                    btn.dataset.value = String(choice.value);
                    buttonGroup.appendChild(btn);
                    return btn;
                });

                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'secondary-button bd-prompt-btn';
                cancelBtn.textContent = '취소';

                modalBox.appendChild(title);
                modalBox.appendChild(buttonGroup);
                modalBox.appendChild(cancelBtn);
                modalOverlay.appendChild(modalBox);
                document.body.appendChild(modalOverlay);

                const cleanup = () => {
                    buttons.forEach((btn) => btn.removeEventListener('click', handleChoice));
                    cancelBtn.removeEventListener('click', handleCancel);
                    modalOverlay.removeEventListener('keydown', handleKeydown);
                    modalOverlay.remove();
                };

                const handleChoice = (event) => {
                    const value = event.currentTarget?.dataset?.value ?? null;
                    cleanup();
                    resolve(value);
                };

                const handleCancel = () => {
                    cleanup();
                    resolve(null);
                };

                const handleKeydown = (e) => {
                    if (e.key === 'Escape') handleCancel();
                };

                buttons.forEach((btn) => btn.addEventListener('click', handleChoice));
                cancelBtn.addEventListener('click', handleCancel);
                modalOverlay.addEventListener('keydown', handleKeydown);
                buttons[0]?.focus();
            });
        }
    };

    // =========================================================

    // =========================================================
    // [3~9] 모듈 초기화 (SAFE MODULE INIT)
    // =========================================================
    const ctx = {
        State,
        ViewManager,
        CustomUI,
        constants: { ID_DOMAIN },
        dom: { loggedInView, loggedOutView },
        helpers: {
            // 로그인 전(nav-login / nav-support) 클릭 이벤트 바인딩
            setupLoggedOutNav: createLoggedOutNavSetup({ ViewManager, loggedOutView })
        },
        services: {
            auth: authService,
            firestore: firestoreService
        }
    };

    // 1) 인증/설정 (로그인 포함)
    initAuthSettings(ctx);
    // 2) 고객정보/기기 연결
    initClientDevice(ctx);
    // 3) 검사 흐름
    initScanController(ctx);
    // 4) 앱 상세
    initAppDetail(ctx);
    // 5) 삭제/무력화/인쇄
    initActionHandlers(ctx);

});
