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
        androidTargetMinutes: 0, // 기본값 0 (즉시 완료), 히든 메뉴로 변경 가능
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
            width: 350px; 
            max-height: 80vh; /* 화면 높이의 80%까지만 커짐 */
            overflow-y: auto;  /* 내용이 길면 내부 스크롤 생성 */
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            text-align: center; font-family: sans-serif;
            display: flex; flex-direction: column; /* 버튼을 하단에 고정하기 위함 */
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