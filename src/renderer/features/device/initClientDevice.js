// Synced from TypeScript preview output. Source of truth: initClientDevice.ts
export function initClientDevice(ctx) {
    const { State, ViewManager, CustomUI, dom } = ctx;
    const { loggedInView } = dom;
    const clientInfoForm = document.getElementById('client-info-form');
    const toConnectionScreenBtn = document.getElementById('to-connection-screen-btn');
    const clientInputs = {
        name: document.getElementById('client-name'),
        dob: document.getElementById('client-dob'),
        phone: document.getElementById('client-phone')
    };
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
    function setupAnonToggle(key) {
        const inputEl = clientInputs[key];
        const checkEl = anonChecks[key];
        const anonValue = anonValues[key];
        if (!checkEl || !inputEl)
            return;
        checkEl.addEventListener('change', () => {
            const isAnonymous = checkEl.checked;
            if (isAnonymous) {
                inputEl.value = anonValue;
                inputEl.disabled = true;
            }
            else {
                inputEl.value = '';
                inputEl.disabled = false;
            }
            checkFormValidity();
        });
    }
    setupAnonToggle('name');
    setupAnonToggle('dob');
    setupAnonToggle('phone');
    function checkFormValidity() {
        const isNameAnon = !!(anonChecks.name && anonChecks.name.checked);
        const isDobAnon = !!(anonChecks.dob && anonChecks.dob.checked);
        const isPhoneAnon = !!(anonChecks.phone && anonChecks.phone.checked);
        const isNameValid = isNameAnon || !!clientInputs.name?.value.trim();
        const isDobValid = isDobAnon || !!clientInputs.dob?.value.trim();
        const isPhoneValid = isPhoneAnon || !!clientInputs.phone?.value.trim();
        const isValid = isNameValid && isPhoneValid;
        if (toConnectionScreenBtn) {
            toConnectionScreenBtn.disabled = !isValid;
        }
    }
    if (clientInfoForm) {
        clientInfoForm.addEventListener('input', checkFormValidity);
        document.getElementById('reset-client-info-btn')?.addEventListener('click', () => {
            Object.values(clientInputs).forEach(input => {
                if (!input)
                    return;
                input.value = '';
                input.disabled = false;
            });
            Object.values(anonChecks).forEach(check => {
                if (check)
                    check.checked = false;
            });
            checkFormValidity();
        });
        clientInfoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            ViewManager.showScreen(loggedInView, 'device-connection-screen');
            try {
                State.scanRuntime.inProgress = false;
                State.scanRuntime.phase = 'idle';
            }
            catch (_) {
                /* noop */
            }
            DeviceManager.startPolling();
        });
    }
    const backToInfoBtn = document.getElementById('back-to-info-btn');
    if (backToInfoBtn) {
        backToInfoBtn.addEventListener('click', () => {
            DeviceManager.stopPolling();
            ViewManager.showScreen(loggedInView, 'create-scan-screen');
        });
    }
    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', async () => {
            const isLoadedScan = !!State?.isLoadedScan;
            const confirmMsg = isLoadedScan
                ? '보고서를 닫고 초기 화면으로 돌아가시겠습니까?'
                : '기기 연결을 끊고 초기 화면으로 돌아가시겠습니까?';
            if (await CustomUI.confirm(confirmMsg)) {
                const isLoaded = !!State?.isLoadedScan;
                const isAndroid = !!(State?.currentDeviceMode === 'android');
                let resDevOff = null;
                if (!isLoaded && isAndroid) {
                    const api = (window.electronAPI || {});
                    const doAction = async (action) => {
                        try {
                            const fn = api.performDeviceSecurityAction;
                            if (typeof fn !== 'function')
                                return { ok: false, error: 'NO_API' };
                            return await fn({ action });
                        }
                        catch (e) {
                            return { ok: false, error: e?.message || String(e) };
                        }
                    };
                    resDevOff = await doAction({ kind: 'toggle', target: 'devOptions', value: false });
                    let devNow = null;
                    const toBool = (status) => {
                        const s = String(status || '').toUpperCase();
                        if (s.startsWith('ON'))
                            return true;
                        if (s.startsWith('OFF'))
                            return false;
                        return null;
                    };
                    const readSecurityStatus = async () => {
                        if (typeof api.getDeviceSecurityStatus !== 'function')
                            return { devNow: null };
                        const st = await api.getDeviceSecurityStatus();
                        const items = (st && st.items) ? st.items : [];
                        const devItem = items.find((it) => it && it.id === 'devOptions');
                        return { devNow: devItem ? toBool(devItem.status) : null };
                    };
                    try {
                        for (let i = 0; i < 3; i++) {
                            const st = await readSecurityStatus();
                            devNow = st.devNow;
                            if (devNow === false)
                                break;
                            if (resDevOff && resDevOff.ok) {
                                await new Promise(r => setTimeout(r, 550));
                            }
                            else {
                                break;
                            }
                        }
                    }
                    catch (_e) {
                        /* noop */
                    }
                    const lines = [];
                    if (devNow === false) {
                        lines.push('✅ 개발자 옵션이 정상적으로 꺼졌습니다.');
                    }
                    else if (devNow === true) {
                        if (resDevOff && resDevOff.ok) {
                            lines.push('⚠️ 개발자 옵션 끄기를 시도했지만, 현재 상태가 즉시 반영되지 않았거나 확인이 불확실합니다.');
                        }
                        else {
                            lines.push('⚠️ 개발자 옵션이 아직 켜져 있습니다.');
                        }
                    }
                    else {
                        if (resDevOff && resDevOff.ok) {
                            lines.push('✅ 개발자 옵션 끄기 요청은 전송되었습니다. 다만 기기 상태를 즉시 확인하지 못했습니다.');
                        }
                        else {
                            lines.push('⚠️ 개발자 옵션 상태를 확인할 수 없습니다.');
                        }
                    }
                    lines.push('');
                    lines.push('🔒 검사를 위해 "보안 위험 자동 차단"을 꺼두셨다면, 이제 다시 켜주세요.');
                    await CustomUI.alert(lines.join('\n'));
                }
                document.getElementById('nav-create')?.classList.remove('hidden');
                document.getElementById('nav-open')?.classList.remove('hidden');
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
                const containers = [
                    'app-grid-container',
                    'bg-app-grid-container',
                    'apk-grid-container',
                    'log-container',
                    'suspicious-list-container',
                    'spyware-detail-container',
                    'ios-web-container',
                    'ios-messages-container',
                    'ios-system-container',
                    'ios-appsprofiles-container',
                    'ios-artifacts-container',
                    'mvt-analysis-container',
                    'privacy-threat-detail-container',
                    'privacy-threat-list-container'
                ];
                containers.forEach(id => {
                    const el = document.getElementById(id);
                    if (el)
                        el.innerHTML = '';
                });
                const infoFields = ['res-model', 'res-serial', 'res-phone', 'res-root'];
                infoFields.forEach(id => {
                    const el = document.getElementById(id);
                    if (el)
                        el.textContent = '-';
                });
                try {
                    State.isLoadedScan = false;
                    State.lastScanData = null;
                    State.lastScanFileMeta = null;
                }
                catch (_e) {
                    /* noop */
                }
                try {
                    ctx.helpers?.renderScanInfo?.(null, null);
                }
                catch (_e) {
                    /* noop */
                }
                const dashNav = document.getElementById('nav-android-dashboard');
                if (dashNav) {
                    dashNav.classList.add('hidden');
                    dashNav.classList.remove('active');
                    dashNav.style.display = 'none';
                }
                try {
                    ctx.helpers?.stopAndroidDashboardPolling?.();
                }
                catch (_) { /* noop */ }
                try {
                    ctx.helpers?.resetAndroidDashboardUI?.();
                }
                catch (_) { /* noop */ }
                try {
                    ctx.helpers?.setDashboardScrollLock?.(false);
                }
                catch (_) { /* noop */ }
                State.androidDashboardEnabled = false;
                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'create-scan-screen');
                try {
                    document.querySelectorAll('#logged-in-view .nav-item').forEach(item => {
                        item.classList.remove('active');
                    });
                    document.getElementById('nav-create')?.classList.add('active');
                }
                catch (_e) {
                    /* noop */
                }
                const realStartScanBtn = document.getElementById('real-start-scan-btn');
                if (realStartScanBtn) {
                    realStartScanBtn.disabled = false;
                    realStartScanBtn.textContent = '검사 시작하기';
                }
                document.getElementById('reset-client-info-btn')?.dispatchEvent(new MouseEvent('click'));
                try {
                    State.lastScanData = null;
                    State.scanRuntime.inProgress = false;
                    State.scanRuntime.phase = 'idle';
                }
                catch (_e) {
                    /* noop */
                }
                console.log('[Clean-up] 모든 이전 검사 데이터가 초기화되었습니다.');
            }
        });
    }
    const DeviceManager = {
        startPolling() {
            if (State.connectionCheckInterval)
                clearInterval(State.connectionCheckInterval);
            this.checkDevice();
            State.connectionCheckInterval = setInterval(() => this.checkDevice(), 1500);
        },
        stopPolling() {
            if (State.connectionCheckInterval)
                clearInterval(State.connectionCheckInterval);
            State.connectionCheckInterval = null;
        },
        async checkDevice() {
            const screen = document.getElementById('device-connection-screen');
            if (!screen || !screen.classList.contains('active')) {
                this.stopPolling();
                return;
            }
            try {
                const android = await window.electronAPI.checkDeviceConnection();
                if (android.status === 'connected') {
                    State.currentDeviceMode = 'android';
                    this.setUI('connected', 'Android 연결됨', android.model, '#5CB85C', true);
                    return;
                }
                else if (android.status === 'unauthorized') {
                    State.currentDeviceMode = null;
                    this.setUI('unauthorized', '승인 대기 중', '휴대폰에서 USB 디버깅을 허용해주세요.', '#F0AD4E', false);
                    return;
                }
                else if (android.status === 'error' || android.status === 'offline') {
                    State.currentDeviceMode = null;
                    const errorMessage = android.error || 'ADB 도구 실행 오류. 프로그램 재시작 필요.';
                    this.setUI('disconnected', 'Android 도구 오류', errorMessage, '#D9534F', false);
                    return;
                }
            }
            catch (_e) {
                this.setUI('disconnected', '통신 오류', 'Android 도구 연결 중 알 수 없는 오류 발생.', '#D9534F', false);
                return;
            }
            try {
                const ios = await window.electronAPI.checkIosConnection();
                if (ios.status === 'connected') {
                    State.currentDeviceMode = 'ios';
                    State.currentUdid = ios.udid;
                    this.setUI('connected', 'iPhone 연결됨', ios.model, '#5CB85C', true);
                    return;
                }
                else if (ios.status === 'unauthorized') {
                    State.currentDeviceMode = null;
                    State.currentUdid = null;
                    this.setUI('unauthorized', '신뢰 승인 대기 중', ios.error || "아이폰을 잠금 해제하고 '이 컴퓨터 신뢰'를 승인해주세요.", '#F0AD4E', false);
                    return;
                }
                else if (ios.status === 'error') {
                    State.currentDeviceMode = null;
                    State.currentUdid = null;
                    const errorMessage = ios.error || 'iOS 도구 실행 오류. iTunes 설치 상태 확인 필요.';
                    this.setUI('disconnected', 'iOS 도구 오류', errorMessage, '#D9534F', false);
                    return;
                }
            }
            catch (_e) {
                this.setUI('disconnected', '통신 오류', 'iOS 도구 연결 중 알 수 없는 오류 발생.', '#D9534F', false);
                return;
            }
            State.currentDeviceMode = null;
            State.currentUdid = null;
            this.setUI('disconnected', '기기를 연결해주세요', 'Android 또는 iOS 기기를 USB로 연결하세요.', '#333', false);
        },
        setUI(status, titleText, descText, color, showBtn = true) {
            const wrapper = document.getElementById('connection-visual-wrapper');
            const alertTitle = document.getElementById('connection-device-title');
            const title = document.getElementById('connection-status-title');
            const desc = document.getElementById('connection-status-desc');
            const btnContainer = document.getElementById('start-scan-container');
            if (title) {
                title.textContent = titleText;
                title.style.color = color;
            }
            if (desc) {
                desc.innerHTML = descText.includes('모델') ? descText : `<span>${descText}</span>`;
            }
            if (btnContainer) {
                btnContainer.style.display = showBtn ? 'block' : 'none';
            }
            wrapper?.classList.remove('state-disconnected', 'state-unauthorized', 'state-connected');
            if (status === 'connected') {
                wrapper?.classList.add('state-connected');
                if (alertTitle)
                    alertTitle.innerHTML = 'DEVICE<br>READY';
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
                wrapper?.classList.add('state-unauthorized');
                if (alertTitle)
                    alertTitle.innerHTML = 'WAITING<br>AUTH';
            }
            else {
                wrapper?.classList.add('state-disconnected');
                if (alertTitle)
                    alertTitle.innerHTML = 'CONNECT<br>DEVICE';
            }
        }
    };
    ctx.services = ctx.services || {};
    ctx.services.deviceManager = DeviceManager;
}
