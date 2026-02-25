// Auto-split module: clientDevice

export function initClientDevice(ctx) {
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    // Services (auth + firestore)
    // Role-separated deps
    const authService = services.auth;
    const { doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where, runTransaction, addDoc, serverTimestamp, deleteDoc, increment, limit } = services.firestore;

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

            // [Patch] clear scan session flag on disconnect
            try { if (window.State) window.State.__bd_scanInProgress = false; } catch (_) { }

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

// -------------------------------------------------
// ✅ 연결 끊기 시 자동 조치
// 1) 개발자 옵션 OFF (자동)
// 2) 완료 안내 팝업 표시
// 3) (선택) 개발자 옵션이 꺼지지 않으면 설정 화면 열기 제공
//
// NOTE:
// - 사용자가 "보안 위험 자동 차단"을 꺼두었다면, 다시 켜면 USB 디버깅이 자동으로 꺼질 수 있습니다.
// - 본 흐름에서는 보안 위험 자동 차단을 직접 토글하지 않고, 사용자에게 안내합니다.
// -------------------------------------------------
const api = window.electronAPI || {};
const doAction = async (action) => {
    try {
        const fn = api.performDeviceSecurityAction;
        if (typeof fn !== 'function') return { ok: false, error: 'NO_API' };
        return await fn({ action });
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
};

// 1) 개발자 옵션 끄기 시도
const resDevOff = await doAction({ kind: 'toggle', target: 'devOptions', value: false });

// 2) 실제 상태 재확인(지연/재시도: 기기 설정 반영에 시간이 걸리는 경우가 있음)
let devNow = null; // true | false | null
// NOTE: "보안 위험 자동 차단"(설정 UI)은 기기/OEM별로 DB 값과 1:1로 매핑되지 않는 경우가 있어
// 앱에서 정확한 ON/OFF 판정/자동 토글을 보장하기 어렵습니다. (안내 문구만 표시)
const toBool = (status) => {
    const s = String(status || '').toUpperCase();
    if (s.startsWith('ON')) return true;
    if (s.startsWith('OFF')) return false;
    return null;
};

const readSecurityStatus = async () => {
    if (typeof api.getDeviceSecurityStatus !== 'function') return { devNow: null };
    const st = await api.getDeviceSecurityStatus();
    const items = (st && st.items) ? st.items : [];
    const devItem = items.find(it => it && it.id === 'devOptions');
    return { devNow: devItem ? toBool(devItem.status) : null };
};

try {
    // 최대 3회(총 ~1.6초) 재확인
    for (let i = 0; i < 3; i++) {
        const st = await readSecurityStatus();
        devNow = st.devNow;
        if (devNow === false) break;
        // 토글 성공 응답이 왔으면 조금 기다렸다가 재조회
        if (resDevOff && resDevOff.ok) {
            await new Promise(r => setTimeout(r, 550));
        } else {
            break;
        }
    }
} catch (_e) { }

// 3) 안내 팝업
const lines = [];
if (devNow === false) {
    lines.push('✅ 개발자 옵션이 정상적으로 꺼졌습니다.');
} else if (devNow === true) {
    if (resDevOff && resDevOff.ok) {
        lines.push('⚠️ 개발자 옵션 끄기를 시도했지만, 현재 상태가 즉시 반영되지 않았거나 확인이 불확실합니다.');
    } else {
        lines.push('⚠️ 개발자 옵션이 아직 켜져 있습니다.');
    }
} else {
    if (resDevOff && resDevOff.ok) {
        lines.push('✅ 개발자 옵션 끄기 요청은 전송되었습니다. 다만 기기 상태를 즉시 확인하지 못했습니다.');
    } else {
        lines.push('⚠️ 개발자 옵션 상태를 확인할 수 없습니다.');
    }
}

// 보안 위험 자동 차단 안내(사용자 인지용)
lines.push('');
lines.push('🔒 검사를 위해 "보안 위험 자동 차단"을 꺼두셨다면, 이제 다시 켜주세요.');
lines.push('   (켜면 USB 디버깅이 자동으로 꺼질 수 있습니다.)');

// 개발자 옵션이 꺼지지 않았으면 설정 열기 제안
if (devNow !== false) {
    await CustomUI.alert(lines.join('\n'));
    const goSettings = await CustomUI.confirm(
        (devNow === true)
            ? '개발자 옵션이 아직 켜져 있습니다.\n설정 화면을 열어 직접 끄시겠습니까?'
            : '개발자 옵션 상태를 확인하지 못했습니다.\n설정 화면을 열어 직접 확인하시겠습니까?'
    );
    if (goSettings) {
        await doAction({ kind: 'openSettings', intent: 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS' });
        await CustomUI.alert('설정에서 개발자 옵션을 끈 뒤, 앱으로 돌아와 주세요.');
    }
} else {
    await CustomUI.alert(lines.join('\n'));
}

// 1. 네비게이션 메뉴 상태 복구
                document.getElementById('nav-create').classList.remove('hidden');
                document.getElementById('nav-open').classList.remove('hidden');

                const navScanInfo = document.getElementById('nav-scan-info');
                if (navScanInfo) {
                    navScanInfo.classList.add('hidden');
                    navScanInfo.classList.remove('active');
                    navScanInfo.style.display = 'none';
                }


                const navResult = document.getElementById('nav-result');
                if (navResult) {
                    navResult.classList.add('hidden');
                    navResult.classList.remove('active');
                }

                const subMenu = document.getElementById('result-sub-menu');
                if (subMenu) {
                    subMenu.classList.add('hidden');
                    subMenu.classList.remove('active');
                }

                const iosSubMenu = document.getElementById('ios-sub-menu');
                if (iosSubMenu) {
                    iosSubMenu.classList.add('hidden');
                    iosSubMenu.style.display = 'none';
                }

                // 화면에 그려진 리스트 컨테이너들을 물리적으로 비움
                const containers = [
                    'app-grid-container',
                    'bg-app-grid-container',
                    'apk-grid-container',
                    'log-container',
                    'suspicious-list-container',
                    'spyware-detail-container',

                    // iOS 5대 핵심영역(분리 메뉴) 컨테이너
                    'ios-web-container',
                    'ios-messages-container',
                    'ios-system-container',
                    'ios-appsprofiles-container',
                    'ios-artifacts-container',

                    // (구버전 호환) 단일 MVT 컨테이너
                    'mvt-analysis-container',

                    // 개인정보 유출 위협
                    'privacy-threat-detail-container',
                    'privacy-threat-list-container'
                ];

                containers.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = '';
                });

                // 기기 정보 텍스트들도 초기화
                const infoFields = ['res-model', 'res-serial', 'res-phone', 'res-root'];
                infoFields.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = '-';
                });

                // 2. 상태값 및 화면 전환


                // Loaded scan cleanup (file open)
                try {
                    State.isLoadedScan = false;
                    State.lastScanData = null;
                    State.lastScanFileMeta = null;
                    window.lastScanData = null;
                } catch (_e) { }

                try {
                    if (typeof window.__bd_renderScanInfo === 'function') {
                        window.__bd_renderScanInfo(null, null);
                    }
                } catch (_e) { }

                // Android dashboard cleanup (nav/scroll/polling/ui)
                // [Patch] only show dashboard nav when scan is active
                if (window.State && window.State.__bd_scanInProgress) {
                    const dashNav = document.getElementById('nav-android-dashboard');
                    if (dashNav) {
                        dashNav.classList.add('hidden');
                        dashNav.classList.remove('active');
                        dashNav.style.display = 'none';
                    }
                } else {
                    const dashNav = document.getElementById('nav-android-dashboard');
                    if (dashNav) { dashNav.classList.add('hidden'); dashNav.classList.remove('active'); dashNav.style.display = 'none'; }
                }
                try { window.__bd_stopAndroidDashboardPolling && window.__bd_stopAndroidDashboardPolling(); } catch (_) { }
                try { window.__bd_resetAndroidDashboardUI && window.__bd_resetAndroidDashboardUI(); } catch (_) { }
                try { window.__bd_setNoScroll && window.__bd_setNoScroll(false); } catch (_) { }
                State.androidDashboardEnabled = false;

                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'create-scan-screen');

                // 3. 버튼 상태 복구 및 입력폼 초기화
                const realStartScanBtn = document.getElementById('real-start-scan-btn');
                if (realStartScanBtn) {
                    realStartScanBtn.disabled = false;
                    realStartScanBtn.textContent = '검사 시작하기';
                }

                const resetBtn = document.getElementById('reset-client-info-btn');
                if (resetBtn) resetBtn.click();

                try {
                    State.lastScanData = null;
                    State.__bd_lastScanData = null;
                    State.__bd_scanInProgress = false;
                    State.__bd_scanPhase = 'idle';
                } catch (e) { }

                try { window.lastScanData = null; } catch (e) { }
                try { window.__bd_lastScanData = null; } catch (e) { }

                console.log("[Clean-up] 모든 이전 검사 데이터가 초기화되었습니다.");

                // 결과 안내 (사용자 요청: 추가 메뉴 대신 안내 모달)
                try {
	                    const ok1 = !!resAutoBlock?.ok;
	                    const okDev = !!resDevOff?.ok;
	                    const ok2 = !!resUsbOff?.ok;
                    const msg = [
                        '연결을 해제했습니다. 보안 설정을 복구했습니다.',
                        '',
	                        `• 보안 위험 자동 차단: ${ok1 ? 'ON 처리 완료' : '자동 처리 실패(기기 정책/권한 제한 가능)'}`,
	                        `• 개발자 옵션: ${okDev ? 'OFF 처리 완료' : '자동 처리 실패(기기 정책/권한 제한 가능)'}`,
                        `• USB 디버깅: ${ok2 ? 'OFF 처리 완료' : '자동 처리 실패(기기 정책/권한 제한 가능)'}`,
                        '',
                        '일부 기기는 제조사/OS 정책으로 자동 변경이 제한될 수 있습니다.',
                        '그 경우 기기 설정에서 직접 확인해주세요.'
                    ].join('\n');
                    await CustomUI.alert(msg);
                } catch (_e) { }
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
            if (!screen || !screen.classList.contains('active')) {
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

            // 3. 연결 없음 
            State.currentDeviceMode = null;
            this.setUI('disconnected', '기기를 연결해주세요', 'Android 또는 iOS 기기를 USB로 연결하세요.', '#333', false);
        },

        setUI(status, titleText, descText, color, showBtn = true) {
            // 1. 제어할 엘리먼트들 확보
            const wrapper = document.getElementById('connection-visual-wrapper'); // 폰+케이블 래퍼
            // const icon = document.getElementById('connection-device-icon'); <-- 이 줄 삭제! (더 이상 필요 없음)
            const alertTitle = document.getElementById('connection-device-title'); // 폰 내부 텍스트
            const title = document.getElementById('connection-status-title');      // 하단 큰 제목
            const desc = document.getElementById('connection-status-desc');        // 하단 작은 설명
            const btnContainer = document.getElementById('start-scan-container');  // 버튼 컨테이너

            // 2. 하단 텍스트 및 버튼 업데이트 
            title.textContent = titleText;
            title.style.color = color;
            // 모델명이 있을 때만 굵게 표시하는 로직 유지
            desc.innerHTML = descText.includes('모델') ? descText : `<span>${descText}</span>`;
            btnContainer.style.display = showBtn ? 'block' : 'none';

            // 3. 스마트폰 프레임 상태 클래스 초기화 
            wrapper.classList.remove('state-disconnected', 'state-unauthorized', 'state-connected');

            // 4. 상태별 비주얼 분기 처리 
            if (status === 'connected') {

                wrapper.classList.add('state-connected');

                alertTitle.innerHTML = 'DEVICE<br>READY';

                // Android dashboard menu visibility
                if (State.currentDeviceMode === 'android') {
                    State.androidDashboardEnabled = false;
                    const dashNav = document.getElementById('nav-android-dashboard');
                    if (dashNav) {
                        dashNav.classList.add('hidden');
                        dashNav.style.display = 'none';
                    }
                }
            }
            else if (status === 'unauthorized') {

                wrapper.classList.add('state-unauthorized');

                alertTitle.innerHTML = 'WAITING<br>AUTH';
            }
            else {

                wrapper.classList.add('state-disconnected');

                alertTitle.innerHTML = 'CONNECT<br>DEVICE';
            }
        }
    };

    // Expose for other modules
    ctx.services = ctx.services || {};
    ctx.services.deviceManager = DeviceManager;


    // =========================================================
}
