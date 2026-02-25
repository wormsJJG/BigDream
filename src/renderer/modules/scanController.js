
// ✅ Normalize device mode strings (e.g., 'iOS', 'ios 17.2', 'ANDROID') to 'ios' | 'android'
function normalizeDeviceMode(modeValue) {
    const v = String(modeValue || '').toLowerCase();
    if (v.includes('ios')) return 'ios';
    if (v.includes('android')) return 'android';
    return v === 'ios' ? 'ios' : (v === 'android' ? 'android' : '');
}

// Auto-split module: scanController

import { Utils } from '../core/utils.js';
import { setCircularGauge } from '../lib/circularGauge.js';

import { renderSuspiciousListView } from '../features/scan/scanView.js';
export function initScanController(ctx) {

    // Shared access to AppDetailManager (module-safe)
    function showAppDetail(appData, displayName) {
        const mgr = (ctx.services && ctx.services.appDetailManager) || globalThis.AppDetailManager;
        if (!mgr || typeof mgr.show !== 'function') {
            console.error('[BD-Scanner] AppDetailManager is not available yet.');
            return;
        }
        mgr.show(appData, displayName);
    }
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;


    function formatDateTime(value) {
        if (!value) return '-';
        const d = (value instanceof Date) ? value : new Date(value);
        if (isNaN(d.getTime())) return '-';

        const pad2 = (n) => String(n).padStart(2, '0');
        const yyyy = d.getFullYear();
        const mm = pad2(d.getMonth() + 1);
        const dd = pad2(d.getDate());
        const hh = pad2(d.getHours());
        const mi = pad2(d.getMinutes());

        return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }

    function formatRootStatus(deviceInfo) {
        if (!deviceInfo) return '-';
        if (deviceInfo.isRooted === true) return '위험';
        if (deviceInfo.isRooted === false) return '안전함';
        return '-';
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = (text === undefined || text === null || text === '') ? '-' : String(text);
    }

    function toggleHidden(id, shouldHide) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', shouldHide);
    }

    // =========================================================
    // DOM helpers (no innerHTML / no inline-style rendering)
    // =========================================================
    const BD_DOM = {
        clear(el) { if (el) el.replaceChildren(); },
        text(el, value) { if (el) el.textContent = value == null ? '' : String(value); },
        el(tag, opts = {}, children = []) {
            const n = document.createElement(tag);
            if (opts.className) n.className = opts.className;
            if (opts.id) n.id = opts.id;
            if (opts.attrs) {
                Object.entries(opts.attrs).forEach(([k, v]) => {
                    if (v === undefined || v === null) return;
                    n.setAttribute(k, String(v));
                });
            }
            if (!Array.isArray(children)) children = [children];
            children.forEach((c) => {
                if (c === undefined || c === null) return;
                if (typeof c === 'string') n.appendChild(document.createTextNode(c));
                else n.appendChild(c);
            });
            return n;
        },
        // Supports only <b>...</b> tags (safe, deterministic)
        setBoldText(el, textWithBTags) {
            if (!el) return;
            el.replaceChildren();
            const s = String(textWithBTags ?? '');
            const reBold = /<b>(.*?)<\/b>/g;
            let last = 0;
            let m;
            while ((m = reBold.exec(s)) !== null) {
                const idx = m.index;
                if (idx > last) el.appendChild(document.createTextNode(s.slice(last, idx)));
                const b = document.createElement('b');
                b.textContent = m[1];
                el.appendChild(b);
                last = idx + m[0].length;
            }
            if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
        },
        emptyMessage(text, className = 'sc-empty-center') {
            const p = document.createElement('p');
            p.className = className;
            p.textContent = text;
            return p;
        }
    };


    function renderScanInfo(payload, fileMeta) {
        const hasPayload = !!payload;
        toggleHidden('scan-info-empty', hasPayload);
        toggleHidden('scan-info-wrapper', !hasPayload);

        if (!hasPayload) {
            setText('scan-info-examiner-name', '-');
            setText('scan-info-examiner-phone', '-');
            setText('scan-info-model', '-');
            setText('scan-info-os', '-');
            setText('scan-info-serial', '-');
            setText('scan-info-root', '-');
            setText('scan-info-saved-at', '-');
            return;
        }

        const meta = payload.meta || {};
        const deviceInfo = payload.deviceInfo || {};

        setText('scan-info-examiner-name', meta.clientName || '-');
        setText('scan-info-examiner-phone', meta.clientPhone || deviceInfo.phoneNumber || '-');

        setText('scan-info-model', deviceInfo.model || '-');
        setText('scan-info-os', deviceInfo.os || '-');
        setText('scan-info-serial', deviceInfo.serial || '-');
        setText('scan-info-root', formatRootStatus(deviceInfo));

        const savedAt = meta.savedAt || fileMeta?.savedAt || fileMeta?.mtimeMs;
        setText('scan-info-saved-at', formatDateTime(savedAt));
    }

    // Expose for other modules (e.g., nav click)
    window.__bd_renderScanInfo = renderScanInfo;


    // [Patch] Normalize loaded scan JSON so "검사 열기"에서도 목록(앱/백그라운드/APK)이 안정적으로 렌더링되도록 보정
    function normalizeLoadedScanData(payload, osMode) {
        const mode = normalizeDeviceMode(osMode || payload?.deviceInfo?.os || payload?.osMode || payload?.deviceMode);
        if (!payload || mode !== 'android') return payload;

        // 1) allApps 보정 (다양한 키 호환)
        const candidates = [
            payload.allApps,
            payload.apps,
            payload.applications,
            payload.installedApps,
            payload.appList,
            payload.targetApps,
            payload?.results?.allApps,
            payload?.results?.apps,
            payload?.mvtResults?.apps, // 혹시 과거/혼합 포맷
        ];
        const apps = candidates.find(v => Array.isArray(v)) || [];
        payload.allApps = Array.isArray(payload.allApps) ? payload.allApps : apps;

        // 2) APK 목록 보정 (다양한 키 호환)
        const apkCandidates = [
            payload.apkFiles,
            payload.apks,
            payload.apkList,
            payload.foundApks,
            payload?.results?.apkFiles,
            payload?.results?.apks,
        ];
        const apks = apkCandidates.find(v => Array.isArray(v)) || [];
        payload.apkFiles = Array.isArray(payload.apkFiles) ? payload.apkFiles : apks;

        // 2-1) 런타임 캐시 필드 제거 (검사 파일을 저장/불러오기 할 때 DOM 객체/Promise가 섞이면 렌더링이 깨집니다)
        const stripRuntimeFields = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            // 이 값들은 실행 중에만 의미가 있고, 파일 저장 시에는 제거되어야 합니다.
            delete obj.__bd_el;
            delete obj.__bd_fetchPromise;
            delete obj.__bd_index;
            delete obj.__bd_cached; // 혹시 있을 수 있는 잔여 키
        };

        (payload.allApps || []).forEach(stripRuntimeFields);
        (payload.apkFiles || []).forEach(stripRuntimeFields);

        // 3) 백그라운드 실행 표시 보정
        // - 최신 포맷: allApps[*].isRunningBg가 이미 존재
        // - 구/혼합 포맷: runningApps / backgroundApps / bgApps / runningPackages 등에서 패키지 추출 후 플래그 부여
        const hasRunningFlag = Array.isArray(payload.allApps) && payload.allApps.some(a => a && typeof a.isRunningBg === 'boolean');
        if (!hasRunningFlag) {
            const runLists = [
                payload.runningApps,
                payload.backgroundApps,
                payload.bgApps,
                payload.runningPackages,
                payload.bgPackages,
                payload?.results?.runningApps,
                payload?.results?.backgroundApps,
            ];
            const raw = runLists.find(v => Array.isArray(v)) || [];
            const pkgSet = new Set(raw.map(x => (typeof x === 'string') ? x : (x?.packageName || x?.pkg || x?.name)).filter(Boolean));
            if (pkgSet.size) {
                (payload.allApps || []).forEach(app => {
                    if (!app || !app.packageName) return;
                    if (pkgSet.has(app.packageName)) app.isRunningBg = true;
                });
            }
        }

        // 4) runningCount 누락 보정
        if (typeof payload.runningCount !== 'number') {
            const c = (payload.allApps || []).filter(a => a && a.isRunningBg).length;
            payload.runningCount = c;
        }

        return payload;
    }

    // [Patch] reset Android dashboard UI so previous scan residue doesn't remain
    function bdResetAndroidDashboardUI() {
        // log lines
        const log = document.getElementById('log-container');
        if (log) BD_DOM.clear(log);

        // connection badge
        const badge = document.getElementById('dash-connection');
        if (badge) {
            badge.textContent = '● CONNECTION';
            badge.classList.remove('is-disconnected');
        }

        // metrics text
        const safeSet = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
        safeSet('live-bat-text', '--%');
        safeSet('live-ram-text', '--%');
        safeSet('live-temp-text', '--.- °C');
        safeSet('live-bat-val', '0');
        safeSet('live-ram-val', '0');
        safeSet('live-temp-val', '0');

        // spec
        safeSet('live-model-name', '-');
        safeSet('live-os-version', 'ANDROID');
        safeSet('live-serial-number', '-');

        const rootedEl = document.getElementById('live-rooted-status');
        if (rootedEl) {
            rootedEl.textContent = 'UNKNOWN';
            rootedEl.classList.remove('status-safe', 'status-danger');
        }

        // top processes
        const tbody = document.getElementById('dash-top-tbody');
        if (tbody) {
            BD_DOM.clear(tbody);
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.className = 'empty';
            td.textContent = '데이터 대기 중...';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        // progress bar text (optional)
        const status = document.getElementById('android-scan-running-text');
        if (status) {
            status.textContent = '검사 준비 중';
            status.style.color = '';
        }

        const percentEl = document.getElementById('android-progress-percent-text');
        if (percentEl) percentEl.textContent = '0%';

        const procEl = document.getElementById('android-scan-status-text');
        if (procEl) procEl.textContent = '0/0';

        const bar = document.getElementById('android-progress-bar');
        if (bar) bar.style.width = '0%';
    }

    // [Patch] dashboard scroll lock
    function bdSetDashboardScrollLock(on) {
        const root = document.documentElement;
        const body = document.body;
        const main = document.querySelector('.main-content');
        const v = !!on;
        if (root) root.classList.toggle('bd-no-scroll', v);
        if (body) body.classList.toggle('bd-no-scroll', v);
        if (main) main.classList.toggle('bd-no-scroll', v);
    }

    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    /* [BD-PATCH] MENU_LIFECYCLE_HELPER */
    // Menu lifecycle: preScan -> scanning(dashboard/progress) -> results
    const bdMenu = {
        navCreate: () => document.getElementById('nav-create'),
        navOpen: () => document.getElementById('nav-open'),
        navResult: () => document.getElementById('nav-result'),
        dashNav: () => document.getElementById('nav-android-dashboard'),
        scanInfoNav: () => document.getElementById('nav-scan-info'),
        resultSub: () => document.getElementById('result-sub-menu'),
        iosSub: () => document.getElementById('ios-sub-menu'),
    };

    function bdSetMenuState(state) {
        const createBtn = bdMenu.navCreate();
        const openBtn = bdMenu.navOpen();
        const navResult = bdMenu.navResult();
        const dashNav = bdMenu.dashNav();
        const scanInfoNav = bdMenu.scanInfoNav();
        const subMenu = bdMenu.resultSub();
        const iosSub = bdMenu.iosSub();

        const hide = (el) => {
            if (!el) return;
            el.classList.add('hidden');
            el.style.display = 'none';
        };
        const show = (el) => {
            if (!el) return;
            el.classList.remove('hidden');
            el.style.display = '';
        };

        if (state === 'preScan') {
            show(createBtn);
            show(openBtn);
            hide(navResult);
            hide(subMenu);
            hide(iosSub);
            hide(dashNav);
            hide(scanInfoNav);
            return;
        }

        if (state === 'scanning') {
            hide(createBtn);
            hide(openBtn);
            hide(navResult);
            hide(subMenu);
            hide(iosSub);
            hide(scanInfoNav);

            // Android 실시간 검사에서만 대시보드(실시간)를 노출
            if (State.currentDeviceMode === 'android' && !State.isLoadedScan) {
                show(dashNav);
            } else {
                hide(dashNav);
            }
            return;
        }

        if (state === 'results') {
            hide(createBtn);
            hide(openBtn);
            show(navResult);

            if (State.currentDeviceMode === 'ios') {
                show(iosSub);
                hide(subMenu);
                hide(dashNav);
                hide(scanInfoNav);
            } else {
                show(subMenu);
                hide(iosSub);

                // Android 결과 화면:
                // - 실시간 검사 결과: 대시보드 유지
                // - '검사 열기' 결과: 대시보드 숨기고 '검사 정보' 노출
                if (State.isLoadedScan) {
                    hide(dashNav);
                    show(scanInfoNav);
                } else {
                    show(dashNav);
                    hide(scanInfoNav);
                }
            }
        }
    }

    // Hook ViewManager.showScreen so programmatic navigations (disconnect/reconnect) keep menu state consistent
    if (!ViewManager.__bd_wrapped_showScreen) {
        ViewManager.__bd_wrapped_showScreen = true;
        const __origShowScreen = ViewManager.showScreen.bind(ViewManager);
        ViewManager.showScreen = function (root, screenId) {
            const ret = __origShowScreen(root, screenId);
            try {
                if (screenId === 'device-connection-screen' || screenId === 'scan-create-screen') bdSetMenuState('preScan');
                else if (screenId === 'scan-dashboard-screen' || screenId === 'scan-progress-screen') {
                    // If a scan already finished (results exist), keep result menus visible even on dashboard/progress.
                    if (State.lastScanData) bdSetMenuState('results');
                    else bdSetMenuState('scanning');
                }
                else if (screenId === 'scan-results-screen') bdSetMenuState('results');
            } catch (e) {
                console.warn('[BD-Scanner] menu lifecycle hook failed:', e);
            }
            return ret;
        };
    }

    // Initial menu state on controller init
    try { bdSetMenuState('preScan'); } catch (_e) {}

    // Services (auth + firestore)
    const authService = services.auth;
    const firestore = services.firestore;
    const { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, increment } = firestore;

    // [6] 검사 실행 (SCAN CONTROLLER)
    // =========================================================

    // 검사 시작 버튼 클릭
    const realStartScanBtn = document.getElementById('real-start-scan-btn');
    if (realStartScanBtn) {
        realStartScanBtn.addEventListener('click', async () => {

            // 버튼을 즉시 비활성화하여 중복 클릭 방지
            realStartScanBtn.disabled = true;
            realStartScanBtn.textContent = '검사 진행 중...';

            const hasQuota = await ScanController.checkQuota();

            if (!hasQuota) {
                // 횟수 부족 시: 기기 연결 화면 유지 및 폴링 중단
                ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);
                ViewManager.showScreen(loggedInView, 'device-connection-screen');
                // 횟수 부족 시 버튼 상태 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return; // ★ 절대 넘어가지 않음
            }

            //횟수 차감 및 UI 업데이트 로직
            try {
                // 1. Firebase에서 Quota 차감 요청 (increment(-1) 사용)
                const user = authService.getCurrentUser?.();
                if (user) {
                    await updateDoc(doc(null, "users", user.uid), {
                        quota: increment(-1) // 1회 차감
                    });

                    // 2. 로컬 상태와 UI 즉시 업데이트
                    State.quota -= 1;
                    if (ctx.helpers && typeof ctx.helpers.updateAgencyDisplay === 'function') {
                        ctx.helpers.updateAgencyDisplay();
                    }
                }

            } catch (quotaError) {
                console.error("❌ Quota 차감 중 오류 발생:", quotaError);
                CustomUI.alert('검사 횟수 차감에 실패했습니다. (서버 오류)');
                // 횟수 차감 실패 시, 검사 진행을 막고 버튼 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return;
            }

            // [Patch] Capture 대상자 정보(검사 정보) for local save/open-scan
            try {
                const nameEl = document.getElementById('client-name');
                const phoneEl = document.getElementById('client-phone');

                const rawName = nameEl ? String(nameEl.value || '').trim() : '';
                const rawPhone = phoneEl ? String(phoneEl.value || '').trim() : '';

                const isAnonName = (!rawName) || rawName.includes('익명');
                const isAnonPhone = (!rawPhone) || rawPhone.includes('000-0000-0000') || rawPhone.includes('익명');

                State.clientInfo = {
                    name: isAnonName ? null : rawName,
                    phone: isAnonPhone ? null : rawPhone
                };
            } catch (_e) { }

            State.__bd_scanInProgress = true; // [Patch] mark scan session active

            const isLogged = await ScanController.startLogTransaction(State.currentDeviceMode);

            if (!isLogged) {

                CustomUI.alert('서버 통신 오류로 검사를 시작할 수 없습니다. 네트워크를 연결해주세요.');
                // 로그 기록 실패 시 버튼 상태 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return;
            }

            ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);

            // [BD-PATCH] Clear previous results so dashboard menu state doesn't mis-detect an old scan.
            State.lastScanData = null;
            window.lastScanData = null;
            window.__bd_lastScanData = null;
            State.isLoadedScan = false;

            // Hide "검사 정보" nav if it was enabled by a previously loaded report
            const navScanInfo = document.getElementById('nav-scan-info');
            if (navScanInfo) {
                navScanInfo.classList.add('hidden');
                navScanInfo.style.display = 'none';
            }

            // Android: use dedicated dashboard screen, iOS: keep legacy progress screen
            if (State.currentDeviceMode === 'android') {
                // show Android dashboard nav
                const dashNav = document.getElementById('nav-android-dashboard');
                if (dashNav) {
                    dashNav.classList.remove('hidden');
                    dashNav.style.display = '';
                }

                ViewManager.activateMenu('nav-android-dashboard');
                bdSetDashboardScrollLock(true);
                bdResetAndroidDashboardUI(); // [Patch] clear previous dashboard residue
                
                ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');
                await ScanController.startAndroidScan();
            } else {

                bdSetDashboardScrollLock(false);
                
                ViewManager.showScreen(loggedInView, 'scan-progress-screen');
                await ScanController.startIosScan();
            }

            // if (State.currentDeviceMode === 'android') {
            //     // 1. 좌측 네비게이션 메뉴 중 '대시보드' 탭 하이라이트 활성화
            //     ViewManager.activateMenu('nav-android-dashboard');

            //     // 2. 안드로이드 대시보드 화면 표시
            //     ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');

            //     // 3. 실제 검사 로직 시작
            //     await ScanController.startAndroidScan();
            // } else {
            //     ViewManager.showScreen(loggedInView, 'scan-progress-screen');
            //     await ScanController.startIosScan();
            // }
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
                    const osMode = result.osMode;


                    // [Patch] '검사 열기' 데이터 포맷 보정(앱/백그라운드/APK 목록)
                    normalizeLoadedScanData(data, osMode);
                    // 1) 상태 업데이트
                    State.currentDeviceMode = osMode;
                    State.isLoadedScan = true;
                    State.lastScanData = data;
                    window.lastScanData = data;

                    State.lastScanFileMeta = result.fileMeta || null;

                    try {
                        if (typeof window.__bd_renderScanInfo === 'function') {
                            window.__bd_renderScanInfo(data, State.lastScanFileMeta);
                        }
                    } catch (e) {
                        console.warn('[BD-Scanner] scan-info render failed:', e);
                    }

                    // 2) UI 전환
                    // 만약 에러가 여기서 난다면 아래 줄을 주석 처리해보세요.
                    try { ViewManager.activateMenu('nav-result'); } catch (e) { }

                    bdSetDashboardScrollLock(false);
                    ViewManager.showScreen(loggedInView, 'scan-results-screen');

                    requestAnimationFrame(() => {
                        try {
                            ResultsRenderer.render(data);
                        } catch (e) {
                            console.error('[BD-Scanner] ResultsRenderer.render failed:', e);
                        }

                        // 3) 첫 진입 흰 화면 방지 
                        const sections = document.querySelectorAll('.result-content-section');
                        if (sections.length > 0) {
                            sections.forEach(sec => {
                                if (sec.id === 'res-summary') {
                                    sec.style.display = 'block';
                                    sec.classList.add('active');
                                } else {
                                    sec.style.display = 'none';
                                    sec.classList.remove('active');
                                }
                            });
                        }

                        // 탭 하이라이트 강제 적용
                        const firstTab = document.querySelector('.res-tab[data-target="res-summary"]');
                        if (firstTab) {
                            document.querySelectorAll('.res-tab').forEach(t => t.classList.remove('active'));
                            firstTab.classList.add('active');
                        }
                    });

                    // 4) 네비 버튼 표시/숨김 
                    const navCreate = document.getElementById('nav-create');
                    const navOpen = document.getElementById('nav-open');
                    const navResult = document.getElementById('nav-result');
                    const navAndroidDash = document.getElementById('nav-android-dashboard');
                    const navScanInfo = document.getElementById('nav-scan-info');

                    if (navCreate) navCreate.classList.add('hidden');
                    if (navOpen) navOpen.classList.add('hidden');
                    if (navResult) navResult.classList.remove('hidden');

                    // Android "검사 열기"에서는 실시간 대시보드 대신 "검사 정보"를 노출
                    if (String(osMode).toLowerCase() === 'android') {
                        if (navAndroidDash) {
                            navAndroidDash.classList.add('hidden');
                            navAndroidDash.style.display = 'none';
                        }
                        if (navScanInfo) {
                            navScanInfo.classList.remove('hidden');
                            navScanInfo.style.display = 'block';
                        }
                    } else {
                        if (navScanInfo) {
                            navScanInfo.classList.add('hidden');
                            navScanInfo.style.display = 'none';
                        }
                    }

                    await CustomUI.alert(`✅ 검사 결과 로드 완료!\n모델: ${data.deviceInfo?.model || '-'}`);

                } else if (result.message !== '열기 취소') {
                    await CustomUI.alert(`❌ 파일 열기 실패: ${result.error || result.message}`);
                }

            } catch (error) {
                console.error("Critical Error:", error);
                await CustomUI.alert(`시스템 오류: ${error.message}`);
            } finally {
                openScanFileBtn.disabled = false;
                openScanFileBtn.textContent = "📁 로컬 파일 열기";
            }
        });
    }

    const ScanController = {
        currentLogId: null,

        toggleLaser(isVisible) {
            const show = !!isVisible;

            // Android: dashboard beam
            const dashBeam = document.getElementById('dashboardScannerBeam');
            // iOS(또는 legacy progress): progress beam
            const legacyBeam = document.getElementById('scannerBeam');

            if (State.currentDeviceMode === 'android') {
                if (dashBeam) dashBeam.style.display = show ? 'block' : 'none';
                // 혹시 남아있는 legacy beam이 보이지 않게 안전하게 끔
                if (legacyBeam) legacyBeam.style.display = 'none';
            } else {
                if (legacyBeam) legacyBeam.style.display = show ? 'block' : 'none';
                if (dashBeam) dashBeam.style.display = 'none';
            }
        },

                async startAndroidScan() {

                    bdResetAndroidDashboardUI();
                    // 재검사 시 이전 결과 데이터가 남아있으면 결과 메뉴/탭 표시가 꼬일 수 있어 초기화
                    State.lastScanData = null;
                    window.lastScanData = null;

                    this.toggleLaser(true);

                    // 데이터 입자들을 보이게 설정
                    const particles = document.querySelectorAll('.data-particle');
                    particles.forEach(p => {
                        p.style.display = 'block';
                        p.style.opacity = '1';
                    });

                    const alertText = document.getElementById('phoneStatusAlert');
                    if (alertText) {
                        alertText.textContent = 'SYSTEM SCANNING';
                        alertText.classList.add('sc-preline');
                        alertText.style.color = '#00d2ff';
                    }

                    // 폴링 및 UI 리셋
                    this.resetSmartphoneUI();
                    this.startAndroidDashboardPolling();

                    // --------------------------------------------
                    // Phase 1: 메타데이터 수집(0~98) 연출 -> runScan 완료 시 100
                    // Phase 2: 검사 진행(시간 기반 0~99) -> finishScan에서 100 마무리
                    // --------------------------------------------

                    const startPhase1AdbProgress = () => {
                        let alive = true;
                        let p = 0;

                        const start = Date.now();
                        const tickMs = 120;

                        // 연출용 기대시간(평균). 너무 길면 답답해지고, 너무 짧으면 후반이 오래 머뭅니다.
                        const expectedMs = 8500;

                        // "ADB..." 반복을 피하고, 포렌식 제품 느낌의 단계명으로 표시
                        const messages = [
                            '디바이스 연결 확인',
                            '시스템 메타데이터 수집',
                            '앱 목록 인덱싱',
                            '권한/환경 점검',
                            '분석 전처리 준비'
                        ];

                        const timer = setInterval(() => {
                            if (!alive) return;

                            const elapsed = Date.now() - start;
                            const t = Math.min(1, elapsed / expectedMs); // 0~1

                            // ease-out(초반 빠르고 후반 느리게)
                            const eased = 1 - Math.pow(1 - t, 3);

                            // 기본 목표치: 0~98
                            let target = 98 * eased;

                            // ✅ 90%부터 천천히(남은 구간을 더 완만하게)
                            if (target > 90) {
                                // 90~98 구간을 느리게 압축
                                const slowPart = (target - 90) * 0.35;
                                target = 90 + slowPart;

                                // 멈춤 느낌 제거용 미세 워블
                                const wobble = (Math.random() - 0.5) * 0.6; // -0.3 ~ +0.3
                                target = Math.min(98, Math.max(90, target + wobble));
                            }

                            // 스무딩: 목표치를 따라가도록(90 이후 더 느리게)
                            const follow = target < 90 ? 0.24 : 0.12;
                            p = p + (target - p) * follow;

                            const shown = Math.max(0, Math.min(98, Math.round(p)));

                            // 2.5초마다 메시지 변경
                            const msg = messages[Math.floor(elapsed / 2500) % messages.length];

                            ViewManager.updateProgress(shown, `${msg}...`);
                        }, tickMs);

                        return {
                            finish: () => {
                                alive = false;
                                clearInterval(timer);
                                ViewManager.updateProgress(100, '수집 완료. 분석을 시작합니다...');
                            },
                            cancel: () => {
                                alive = false;
                                clearInterval(timer);
                            }
                        };
                    };

                    const startPhase2TimedProgress = ({ totalDurationMs, apps, onDone }) => {
                        const totalApps = apps.length;
                        const start = Date.now();
                        const tickInterval = 200;

                        const tick = () => {
                            const elapsed = Date.now() - start;
                            const ratio = totalDurationMs > 0 ? Math.min(1, elapsed / totalDurationMs) : 1;

                            // 99%까지만(완료는 finishScan에서 100)
                            const percent = Math.min(99, Math.floor(ratio * 100));

                            // 시간 비율로 앱 인덱스도 그럴듯하게 표시
                            const idx = Math.min(totalApps, Math.max(1, Math.floor(ratio * totalApps)));
                            const app = apps[idx - 1];
                            const appName = app?.packageName ? Utils.formatAppName(app.packageName) : '...';

                            ViewManager.updateProgress(percent, `[${idx}/${totalApps}] 검사 진행중... ${appName}`);

                            if (ratio >= 1) {
                                onDone?.();
                                return;
                            }
                            setTimeout(tick, tickInterval);
                        };

                        tick();
                    };

                    try {
                        // Phase 1 시작(runScan 대기 동안 연출)
                        const phase1 = startPhase1AdbProgress();

                        // 실제 데이터 수집/분석
                        const scanData = await window.electronAPI.runScan();

                        // Phase 1 종료
                        phase1.finish();

                        const apps =
                            scanData.allApps ||
                            scanData.apps ||
                            scanData.applications ||
                            scanData.installedApps ||
                            scanData.appList ||
                            scanData.targetApps ||
                            scanData.mvtResults?.apps ||
                            scanData.mvtResults?.applications ||
                            [];

                        const totalApps = apps.length;

                        if (totalApps === 0) {
                            this.toggleLaser(false);
                            this.finishScan(scanData);
                            return;
                        }

                        // 목표 시간 결정
                        let targetMinutes;
                        if (State.userRole === 'user') {
                            // 일반 계정: 보안 정책상 20~30분 랜덤
                            targetMinutes = Math.floor(Math.random() * (30 - 20 + 1) + 20);
                            console.log(`[Security Policy] 일반 업체 - 랜덤 시간 적용: ${targetMinutes}분`);
                        } else {
                            // 특권 계정: 설정 값 사용(없으면 0)
                            targetMinutes = State.androidTargetMinutes || 0;
                            console.log(`[Security Policy] 특권 계정 - 설정 시간 적용: ${targetMinutes}분`);
                        }

                        // Phase 2 시작 전 0%로 리셋 + 문구 전환
                        setTimeout(() => {
                            ViewManager.updateProgress(0, '검사 진행중...');
                        }, 300);

                        if (targetMinutes > 0) {
                            const totalDurationMs = targetMinutes * 60 * 1000;
                            console.log(`[Theater Mode] 총 ${totalApps}개 앱, 목표 ${targetMinutes}분(시간 기반)`);

                            startPhase2TimedProgress({
                                totalDurationMs,
                                apps,
                                onDone: () => {
                                    this.toggleLaser(false);
                                    this.finishScan(scanData);
                                }
                            });
                        } else {
                            // 설정 시간이 0이면 기존 빠른 모드 fallback
                            const timePerApp = 35;
                            console.log(`[Theater Mode] 빠른 모드, 총 ${totalApps}개 앱`);

                            let currentIndex = 0;
                            const processNextApp = () => {
                                if (currentIndex >= totalApps) {
                                    this.toggleLaser(false);
                                    this.finishScan(scanData);
                                    return;
                                }

                                const app = apps[currentIndex];
                                const appName = Utils.formatAppName(app.packageName);
                                const percent = Math.floor(((currentIndex + 1) / totalApps) * 100);

                                ViewManager.updateProgress(
                                    Math.min(99, percent),
                                    `[${currentIndex + 1}/${totalApps}] ${appName} 정밀 분석 중...`
                                );

                                currentIndex++;
                                setTimeout(processNextApp, timePerApp);
                            };

                            processNextApp();
                        }
                    } catch (error) {
                        // 에러 발생 시 레이저를 끄고 에러 핸들링
                        this.toggleLaser(false);
                        this.handleError(error);
                    }
                },

        async startLogTransaction(deviceMode) {
            const user = authService.getCurrentUser?.();
            if (!user) return false;

            try {
                // 1. 유저 정보 가져오기 (업체명 확인용)
                const userRef = doc(null, "users", user.uid);
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
                const newLogRef = await addDoc(collection(null, "scan_logs"), {
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
                const logRef = doc(null, "scan_logs", this.currentLogId);

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
                const user = authService.getCurrentUser?.();
                if (!user) return false;

                const userDoc = await getDoc(doc(null, "users", user.uid));
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
            // 재검사 시 이전 결과 데이터가 남아있으면 결과 메뉴/탭 표시가 꼬일 수 있어 초기화
            State.lastScanData = null;
            window.lastScanData = null;
            this.toggleLaser(true)

            // iOS 실시간 진행률 이벤트 연결 (main -> preload -> renderer)
            // NOTE: startIosScan 종료 시 반드시 해제해야 중복 리스너로 인한 UI 오동작을 방지할 수 있습니다.
            let offIosProgress = null;
            try {
                if (window.electronAPI && typeof window.electronAPI.onIosScanProgress === 'function') {
                    offIosProgress = window.electronAPI.onIosScanProgress((payload) => {
                        try {
                            const pctRaw = payload && payload.percent;
                            const pct = Number(pctRaw);
                            const msg = (payload && payload.message) ? String(payload.message) : '';

                            if (Number.isFinite(pct)) {
                                const clamped = Math.max(0, Math.min(100, Math.floor(pct)));
                                ViewManager.updateProgress(clamped, msg || '아이폰 백업 및 분석 진행 중...', true);
                            } else if (msg) {
                                // percent가 없더라도 메시지는 갱신
                                const currentPctText = document.getElementById('progress-percent-text')?.textContent || '0%';
                                const currentPct = Number(String(currentPctText).replace('%', ''));
                                const safePct = Number.isFinite(currentPct) ? currentPct : 0;
                                ViewManager.updateProgress(safePct, msg, true);
                            }
                        } catch (_e) { }
                    });
                }
            } catch (_e) { }

            ViewManager.updateProgress(5, "아이폰 백업 및 분석 진행 중...");
            try {
                // 1. 실제 검사 수행
                const rawData = await window.electronAPI.runIosScan(State.currentUdid, State.userRole);
                if (rawData.error) throw new Error(rawData.error);

                // 2. 데이터 변환 및 결과 화면 렌더링
                const data = Utils.transformIosData(rawData);
                this.finishScan(data);

                // 3. [성공 시에만 삭제] 10초 뒤 보안 파기 실행
                console.log(`[Security] 검사 성공. 10초 후 백업 파기를 시도합니다.`);

                setTimeout(() => {
                    console.log(`[Renderer] 삭제 요청 발송 -> 대상 UDID: ${State.currentUdid}`);

                    window.electronAPI.deleteIosBackup(State.currentUdid)
                        .then(res => {
                            if (res.success) console.log("✅ [Security] 메인 프로세스에서 삭제 완료 응답을 받았습니다.");
                        })
                        .catch(err => console.error("❌ [Renderer] 삭제 명령 전달 실패:", err));
                }, 10000);

            } catch (error) {
                this.handleError(error);
            } finally {
                // iOS 진행률 리스너 정리
                try {
                    if (typeof offIosProgress === 'function') {
                        offIosProgress();
                    }
                } catch (_e) { }
            }
        },

        //  스마트폰 화면을 초기 상태로 되돌리는 함수
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

                icon.style.color = '';

            }

            // 3. 텍스트 초기화
            if (alertText) {
                alertText.textContent = 'SYSTEM SCANNING';
                        alertText.classList.add('sc-preline');
                alertText.style.color = '';
                alertText.style.textShadow = '';
            }

            // 4. 하단 목록 초기화
            if (statusList) {
                statusList.textContent = '[!] 비정상 권한 접근 탐지...\n\n                    [!] 실시간 프로세스 감시...\n\n                    [!] AI 기반 지능형 위협 분석 중...';
                statusList.classList.add('sc-preline');
            }

            // 5. 입자 재활성화
            const particles = document.querySelectorAll('.data-particle');
            particles.forEach(p => {
                p.style.display = 'block';
                p.style.opacity = '1';
            });

            console.log("[UI] 스마트폰 화면이 초기 상태로 리셋되었습니다.");
        },

        // ------------------------------
        // Android Live Dashboard Polling
        // ------------------------------
        startAndroidDashboardPolling() {
            this.stopAndroidDashboardPolling();
            if (State.currentDeviceMode !== 'android') return;

            // failure/disconnect guard (avoid alert spam)
            this._androidDashFailCount = 0;
            if (this._androidDashDisconnectedNotified === undefined) {
                this._androidDashDisconnectedNotified = false;
            }

            const notifyDisconnectedOnce = async () => {
                if (this._androidDashDisconnectedNotified) return;
                this._androidDashDisconnectedNotified = true;
                // keep dashboard visible but inform user
                try {
                    await CustomUI.alert('⚠️ 기기 연결이 끊겼습니다. USB 연결을 확인해주세요.');
                } catch (_) { }
            };

            const render = async () => {
                try {
                    const res = await window.electronAPI?.getAndroidDashboardData?.();
                    if (!res || !res.ok) {
                        this._androidDashFailCount++;
                        if (this._androidDashFailCount >= 3) await notifyDisconnectedOnce();
                        return;
                    }
                    this._androidDashFailCount = 0;
                    this._renderAndroidDashboard(res);

                    // hard disconnect signal from backend
                    if (res.metrics && res.metrics.connected === false) {
                        await notifyDisconnectedOnce();
                    }
                } catch (e) {
                    this._androidDashFailCount++;
                    if (this._androidDashFailCount >= 3) await notifyDisconnectedOnce();
                }
            };

            // First paint
            render();
            this._androidDashTimer = setInterval(render, 1000);
        },

        stopAndroidDashboardPolling() {
            if (this._androidDashTimer) {
                clearInterval(this._androidDashTimer);
                this._androidDashTimer = null;
            }
        },

        _renderAndroidDashboard({ metrics, spec, top }) {
            // Metrics
            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = (val === undefined || val === null || val === '') ? '-' : String(val);
            };

            const setGauge = (gaugeId, valId, percent,) => {
                const el = document.getElementById(gaugeId);
                const valEl = document.getElementById(valId);
                const p = Number(percent);
                const safe = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;

                if (valEl) {
                    valEl.textContent = String(Math.round(safe));
                }
                if (!el) {
                    return;
                }

                // SVG donut gauge (library)
                setCircularGauge(el, safe);
            };

            if (metrics) {
                // Battery
                const bat = (metrics.batteryLevel !== undefined) ? Number(metrics.batteryLevel) : null;
                setText('live-bat-text', (bat === null || !Number.isFinite(bat)) ? '--%' : `${bat}%`);
                setGauge('bat-gauge', 'live-bat-val', bat);

                // RAM
                const ram = (metrics.memUsagePercent !== undefined) ? Number(metrics.memUsagePercent) : null;
                setText('live-ram-text', (ram === null || !Number.isFinite(ram)) ? '--%' : `${ram}%`);
                setGauge('ram-gauge', 'live-ram-val', ram);

                // Temp
                const t = (metrics.deviceTempC !== undefined) ? Number(metrics.deviceTempC) : null;
                setText('live-temp-text', (t === null || !Number.isFinite(t)) ? '--.- °C' : `${t.toFixed(1)} °C`);

                const tPct = (t === null || !Number.isFinite(t)) ? 0 : (t / 100) * 100;
                if (document.getElementById('live-temp-val')) {
                    document.getElementById('live-temp-val').textContent = (t === null || !Number.isFinite(t)) ? '-' : String(Math.round(t));
                }
                setGauge('temp-gauge', 'live-temp-val', tPct);

                // Connection badge
                const status = document.getElementById('dash-connection');
                if (status) {
                    // Treat undefined as connected; only explicit false is disconnected.
                    const isConnected = metrics.connected !== false;
                    status.textContent = isConnected ? '● CONNECTION' : '● DISCONNECTED';
                    status.classList.toggle('is-disconnected', !isConnected);
                }
            }

            // Spec
            if (spec) {
                setText('live-model-name', spec.model || '-');
                setText('live-os-version', spec.android || 'ANDROID');
                setText('live-serial-number', spec.serial || '-');
                // rooted status
                const rootedEl = document.getElementById('live-rooted-status');
                if (rootedEl) {
                    const rooted = String(spec.rooted || '').toLowerCase();
                    const isSafe = (rooted === 'off' || rooted === 'false' || rooted.includes('safe'));
                    rootedEl.textContent = spec.rooted || 'UNKNOWN';
                    rootedEl.classList.toggle('status-safe', isSafe);
                    rootedEl.classList.toggle('status-danger', !isSafe);
                }
            }

            // Top processes
            const tbody = document.getElementById('dash-top-tbody');
            if (tbody) {
                BD_DOM.clear(tbody);

                if (Array.isArray(top) && top.length) {
                    const frag = document.createDocumentFragment();
                    top.forEach((p) => {
                        const tr = document.createElement('tr');

                        const tdPid = document.createElement('td');
                        tdPid.textContent = (p && p.pid != null) ? String(p.pid) : '-';

                        const tdCpu = document.createElement('td');
                        tdCpu.textContent = (p && p.cpu != null) ? String(p.cpu) : '-';

                        const tdMem = document.createElement('td');
                        tdMem.textContent = (p && p.mem != null) ? String(p.mem) : '-';

                        const tdName = document.createElement('td');
                        tdName.className = 'name';
                        tdName.textContent = (p && p.name != null) ? String(p.name) : '-';

                        tr.appendChild(tdPid);
                        tr.appendChild(tdCpu);
                        tr.appendChild(tdMem);
                        tr.appendChild(tdName);
                        frag.appendChild(tr);
                    });
                    tbody.appendChild(frag);
                } else {
                    const tr = document.createElement('tr');
                    const td = document.createElement('td');
                    td.colSpan = 4;
                    td.className = 'empty';
                    td.textContent = '데이터 대기 중...';
                    tr.appendChild(td);
                    tbody.appendChild(tr);
                }
            }
        },


        finishScan(data) {
            State.__bd_scanInProgress = false; // [Patch] scan finished

            console.log("--- 검사 종료: 결과 대시보드 준비 ---");

            this.endLogTransaction('completed');
            // 진행바를 100%로 만들고 완료 문구 출력
            ViewManager.updateProgress(100, "분석 완료! 결과 리포트를 생성합니다.");

            // 휴대폰 내부 비주얼 변경 (애니메이션 종료)

            // 1. 레이저 빔 즉시 정지
            this.toggleLaser(false);

            // 2. 입자 애니메이션 중단 및 숨김
            const particles = document.querySelectorAll('.data-particle');
            particles.forEach(p => {
                p.style.opacity = '0';
                p.style.display = 'none';
            });

            // 3. 스마트폰 내부 화면 요소 찾기 
            const hackIcon = document.querySelector('.hack-icon');
            const hackAlert = document.getElementById('phoneStatusAlert');

            if (hackIcon) {
                hackIcon.className = "fas fa-check-circle hack-icon";
                hackIcon.style.color = "var(--success-color)";
                hackIcon.style.animation = "none";
            }

            if (hackAlert) {
                hackAlert.textContent = 'SCAN COMPLETED';
                hackAlert.classList.add('sc-preline');
                hackAlert.style.color = 'var(--success-color)';
                hackAlert.style.textShadow = '0 0 15px var(--success-color)';
            }

            // 4. 대시보드 하단 텍스트 및 로그 처리
            const runningText = document.getElementById('android-scan-running-text');
            if (runningText) {
                runningText.textContent = '검사 완료';
                runningText.style.color = 'var(--success-color)';
            }

            const logContainer = document.getElementById('log-container');
            if (logContainer) {
                const doneLine = document.createElement('div');
                doneLine.className = 'log-line';
                const span = document.createElement('span');
                span.className = 'sc-success-text';
                span.textContent = '[SYSTEM] Security Scan Successfully Completed.';
                doneLine.appendChild(span);
                logContainer.appendChild(doneLine);
                logContainer.scrollTop = logContainer.scrollHeight;
            }

            // 3. 데이터 저장
            // [Patch] Persist 대상자 정보 into scan result for '검사 열기' / '검사 정보'
            try {
                data.meta = data.meta || {};
                const ci = State.clientInfo || {};
                // 익명(null)인 경우 저장하지 않고 '-'로 표시되게 함
                if (ci.name) data.meta.clientName = ci.name;
                if (ci.phone) data.meta.clientPhone = ci.phone;
            } catch (_e) { }
            State.lastScanData = data;
            window.lastScanData = data;

            // 4. 화면 전환 및 좌측 탭 하이라이트 정리
            setTimeout(() => {
                // 기존의 모든 하이라이트(대시보드 등)를 제거
                document.querySelectorAll('.nav-item, .res-tab').forEach(el => {
                    el.classList.remove('active');
                });

                // 결과 데이터 렌더링

                ViewManager.showScreen(loggedInView, 'scan-results-screen');
                requestAnimationFrame(() => {
                    // 결과 데이터 렌더링
                    ResultsRenderer.render(data);

                    // 결과 화면의 첫 번째 탭(요약)에 하이라이트 부여
                    const summaryTab = document.querySelector('.res-tab[data-target="res-summary"]');
                    if (summaryTab) {
                        summaryTab.classList.add('active');
                    }
                });
            }, 1500);
        },

        handleError(error) {
            State.__bd_scanInProgress = false; // [Patch] scan aborted

            console.error(error);
            this.endLogTransaction('error', error.message);
            const statusText = document.getElementById('scan-status-text');
            const statusBar = document.getElementById('progress-bar');
            if (statusText) statusText.textContent = "오류: " + error.message;
            if (statusBar) statusBar.style.backgroundColor = '#d9534f';
        }
    };

    const ResultsRenderer = {
        render(data) {
            console.log("ResultsRenderer.render 시작", data);


            window.__bd_lastScanData = data;
            const containers = [
                'app-grid-container',
                'bg-app-grid-container',
                'apk-grid-container',
                // 요약(보고서)
                'spyware-detail-container',
                'privacy-threat-detail-container',
                // (호환) 일부 탭/구버전 컨테이너
                'privacy-threat-list-container',
                // iOS 5대 핵심영역(분리된 메뉴) 컨테이너
                'ios-web-container',
                'ios-messages-container',
                'ios-system-container',
                'ios-appsprofiles-container',
                'ios-artifacts-container',
                // (구버전 호환) 단일 MVT 컨테이너
                'mvt-analysis-container'
            ];
            containers.forEach(id => {
                const el = document.getElementById(id);
                if (el) BD_DOM.clear(el);
            });

            // 2. 모든 결과 섹션을 일단 숨김 처리 
            document.querySelectorAll('.result-content-section').forEach(sec => {
                sec.style.display = 'none';
                sec.classList.remove('active');
            });

            // 3. 기기 정보 텍스트 초기화
            ['res-model', 'res-serial', 'res-phone', 'res-root'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '-';
            });

            // ✅ OS 모드 자동 판별 (검사 열기/로컬 파일 열기에서 State가 꼬여도 iOS/Android를 정확히 분기)
            const inferDeviceMode = (payload) => {
                const raw = payload?.deviceInfo?.os || payload?.deviceInfo?.osMode || payload?.osMode || payload?.deviceMode || payload?.deviceInfo?.type;
                const normalized = String(raw || '').toLowerCase();

                // 1) explicit markers
                if (normalized.includes('ios')) return 'ios';
                if (normalized.includes('android')) return 'android';

                // 2) device model hint (iPhone/iPad/iPod)
                const model = String(payload?.deviceInfo?.model || '').toLowerCase();
                if (model.includes('iphone') || model.includes('ipad') || model.includes('ipod')) return 'ios';

                // 3) payload shape hints
                if (payload?.mvtResults || payload?.mvtAnalysis || payload?.mvt) return 'ios';
                if (typeof payload?.runningCount === 'number') return 'android';
                if (Array.isArray(payload?.apkFiles) && payload.apkFiles.length > 0) return 'android';

                // 4) fallback
                return State.currentDeviceMode || 'android';
            };

            const detectedMode = inferDeviceMode(data);
            State.currentDeviceMode = detectedMode;
            if (data?.deviceInfo && !data.deviceInfo.os) data.deviceInfo.os = detectedMode;

            const isIos = detectedMode === 'ios';

            /* [BD-PATCH] IOS_CLEANUP_ANDROID_LISTENERS */
            // If previously bound Android search/sort listeners exist, remove them when rendering iOS to prevent UI corruption.
            if (isIos && Array.isArray(State.__bd_androidListCleanup)) {
                State.__bd_androidListCleanup.forEach(fn => { try { fn && fn(); } catch (_e) {} });
                State.__bd_androidListCleanup = [];
            }

            // [Patch] iOS mode cleanup for Android list listeners
            if (isIos && Array.isArray(State.__bd_androidListCleanup)) {
                State.__bd_androidListCleanup.forEach(fn => { try { fn && fn(); } catch (_) { } });
                State.__bd_androidListCleanup = [];
            }




            // --- [요약 UI 바인딩] (기기정보는 대시보드로 이동했으므로 여기서는 결과 요약 중심) ---
            try {
                const spywareCount = Array.isArray(data?.suspiciousApps) ? data.suspiciousApps.length : 0;
                const privacyCount = Array.isArray(data?.privacyThreatApps) ? data.privacyThreatApps.length : 0;
                const totalApps = Array.isArray(data?.allApps) ? data.allApps.length : 0;

                const setText = (id, value) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = String(value);
                };

                setText('res-spyware-count', spywareCount);
                setText('res-privacy-count', privacyCount);
                setText('res-total-apps', totalApps);

                const modeEl = document.getElementById('res-scan-mode');
                if (modeEl) modeEl.textContent = isIos ? 'MVT기반 분석 + BD_SFA 행동 분석' : 'ADB + BD_SFA 행동 분석';

                const narrationEl = document.getElementById('res-summary-narration');
                if (narrationEl) {
                    const apkCount = Array.isArray(data?.apkFiles) ? data.apkFiles.length : 0;
                    const runningCount = Number.isFinite(data?.runningCount) ? data.runningCount : 0;
                    const parts = [];
                    parts.push(`설치된 앱 ${totalApps}개`);
                    if (!isIos) parts.push(`백그라운드 실행 ${runningCount}개`);
                    if (!isIos && apkCount > 0) parts.push(`발견된 APK ${apkCount}개`);
                    const basis = parts.join(' · ');

                    if (spywareCount > 0 && privacyCount > 0) {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 스파이앱 <b>${spywareCount}건</b>, 개인정보 유출 위협 <b>${privacyCount}건</b>이 탐지되었습니다.`);
                    } else if (spywareCount > 0) {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 스파이앱 <b>${spywareCount}건</b>이 탐지되었습니다.`);
                    } else if (privacyCount > 0) {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 개인정보 유출 위협 <b>${privacyCount}건</b>이 탐지되었습니다.`);
                    } else {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 현재 결과 기준으로 명확한 스파이웨어 흔적은 확인되지 않았습니다.`);
                    }
                }

                const stepsEl = document.getElementById('res-scan-steps');
                if (stepsEl) {
                    const apkCount = Array.isArray(data?.apkFiles) ? data.apkFiles.length : 0;
                    const runningCount = Number.isFinite(data?.runningCount) ? data.runningCount : 0;

                    const steps = [];
                    if (isIos) {
                        steps.push('기기 백업과 로그(또는 MVT 결과)에서 웹 활동·메시지·시스템 로그·설치 앱/프로파일 등 핵심 아티팩트를 수집합니다.');
                        steps.push('IOC(의심 도메인/키워드/패턴) 매칭 및 정책 기반 규칙으로 위험 신호를 추출합니다.');
                        steps.push('수집된 메타데이터를 통해 BD-SFA가 정밀 분석합니다.');
                        steps.push('탐지된 단서를 근거로 요약/상세 영역에 설명을 생성해 제공합니다.');
                    } else {
                        steps.push(`ADB로 설치된 앱 ${totalApps}개, 백그라운드 실행 ${runningCount}개 정보를 수집합니다.`);
                        if (apkCount > 0) steps.push(`저장소에서 발견된 APK 파일 ${apkCount}개를 추가 수집해 설치 대기/유입 경로 위험을 평가합니다.`);
                        steps.push('권한(접근성/기기관리자/민감 권한), 서비스/리시버, 실행 지속성, 알려진 스턱웨어/스파이웨어 행위 신호를 정규화합니다.');
                        steps.push('<b>BD_SFA</b>가 행동 분석 기반으로 위험도를 산출하고, 정책 기반 규칙과 결합해 1차 분류합니다.');
                        steps.push('최종적으로 <b>접근성/기기관리자/지속성</b> 조합 신호가 강한 경우에만 스파이앱으로 확정(미탐 최소화)합니다.');
                    }

                    BD_DOM.clear(stepsEl);
                    const frag = document.createDocumentFragment();
                    steps.forEach((s) => {
                        const li = document.createElement('li');
                        // allow only <b> tags inside step text
                        BD_DOM.setBoldText(li, String(s));
                        frag.appendChild(li);
                    });
                    stepsEl.appendChild(frag);
                }
            } catch (e) {
                console.warn('[Summary] binding failed', e);
            }
            // 1. 공통 기기 정보 바인딩 (모델명, 시리얼 등)
            if (document.getElementById('res-model')) document.getElementById('res-model').textContent = data.deviceInfo?.model || '-';
            if (document.getElementById('res-serial')) document.getElementById('res-serial').textContent = data.deviceInfo?.serial || '-';
            if (document.getElementById('res-phone')) document.getElementById('res-phone').textContent = data.deviceInfo?.phoneNumber || '-';
            if (document.getElementById('res-root')) document.getElementById('res-root').textContent = data.deviceInfo?.isRooted ? "O" : 'X';


            // 주요 섹션 및 그리드 요소 가져오기
            const summarySection = document.getElementById('res-summary');
            const appsSection = document.getElementById('res-apps');
            const threatsSection = document.getElementById('res-threats');
            const appGrid = document.getElementById('app-grid-container');
            const bgAppGrid = document.getElementById('bg-app-grid-container');
            const apkGrid = document.getElementById('apk-grid-container');

            try {
                // 문구 변경을 위한 엘리먼트 참조 (공통으로 사용)
                const threatsTitle = document.getElementById('res-threats-title');
                const threatsDesc = document.getElementById('res-threats-desc');
                const iosAppDesc = document.getElementById('ios-app-list-description');
                const appsHeader = document.querySelector('#res-apps h3');

                if (isIos) {
                    // ==========================================
                    // --- [iOS 전용 렌더링 및 문구 설정] ---
                    // ==========================================

                    // 1. iOS 5대 핵심 영역 제목 및 설명 변경
                    if (threatsTitle) threatsTitle.textContent = "🔍 상세 분석 결과 (5대 핵심 영역)";
                    if (threatsDesc) threatsDesc.textContent = "스파이웨어 흔적 탐지를 위한 5가지 시스템 영역 분석 결과입니다.";

                    // 2. 검사 대상 앱 목록 설명 추가 및 제목 업데이트
                    const totalApps = data.allApps ? data.allApps.length : 0;
                    if (appsHeader) appsHeader.textContent = `📲 검사 대상 애플리케이션 목록 (총 ${totalApps}개)`;
                    if (iosAppDesc) {
                        iosAppDesc.style.display = 'block'; // iOS에서만 노출
                        iosAppDesc.textContent = `${totalApps}개의 앱 데이터베이스 및 파일 흔적**을 검사하는 데 활용되었습니다.`;
                    }

                    // 3. 데이터 렌더링 호출
                    // (1) 요약 탭: 기기정보 + 정밀 분석 결과
                    renderSuspiciousListView({ suspiciousApps: (data.suspiciousApps || []), isIos: true, Utils });
                    // (2) 5대 핵심영역: 영역별 상세 리포트(분리 메뉴)
                    this.renderIosCoreAreas(data.mvtResults || {});

                    // (2-1) iOS 개인정보 유출 위협: 정책 기반(앱 번들ID) + AI 안내
                    const iosPrivacyApps = this.buildIosPrivacyThreatApps(data.allApps || data.apps || data.applications || data.installedApps || data.appList || data.targetApps || data.mvtResults?.apps || data.mvtResults?.applications || [], data.privacyThreatApps || []);
                    this.renderPrivacyThreatList(iosPrivacyApps);

                    // (3) 앱 목록 탭: iOS 전용 리스트
                    if (appGrid) {
                        BD_DOM.clear(appGrid);
                        appGrid.className = ""; // iOS는 리스트 형태이므로 클래스 초기화
                        this.renderIosInstalledApps(data.allApps || data.apps || data.applications || data.installedApps || data.appList || data.targetApps || data.mvtResults?.apps || data.mvtResults?.applications || [], appGrid);
                        // [Patch] bind iOS search safely
                        this.initIosAppListControls(data.allApps || data.apps || data.applications || data.installedApps || data.appList || data.targetApps || data.mvtResults?.apps || data.mvtResults?.applications || [], appGrid);
                    }

                    // 초기 화면 설정: 요약 섹션만 보이고 나머지는 숨김
                    document.querySelectorAll('.result-content-section').forEach(sec => {
                        sec.style.display = (sec.id === 'res-summary') ? 'block' : 'none';
                    });

                } else {
                    // ==========================================
                    // --- [Android 전용 렌더링 및 문구 복구] ---
                    // ==========================================

                    // 1. 안드로이드 원래 문구로 복구 
                    if (threatsTitle) threatsTitle.textContent = "🔐 기기 보안 상태";
                    if (threatsDesc) threatsDesc.textContent = "스파이앱 침입 가능성을 높이는 설정을 점검합니다.";
                    if (iosAppDesc) iosAppDesc.style.display = 'none'; // 안드로이드에선 숨김

                    const totalApps = data.allApps ? data.allApps.length : 0; // 전체 앱 개수 계산
                    const runningApps = data.runningCount || 0;
                    if (appsHeader) {
                        appsHeader.textContent = `📲 설치된 애플리케이션 (총 ${totalApps}개)`;
                    }

                    const bgHeader = document.querySelector('#res-background h3');
                    if (bgHeader) {
                        bgHeader.textContent = `🚀 실행 중인 백그라운드 앱 (총 ${runningApps}개)`;
                    }

                    // 2. 데이터 렌더링 호출
                    // (1) 위협 탐지 목록 (요약 탭 상단)

                    renderSuspiciousListView({ suspiciousApps: (data.suspiciousApps || []), isIos: false, Utils });
                    this.renderPrivacyThreatList(data.privacyThreatApps || []);

                    // (2) 모든 설치된 앱 (앱 목록 탭)
                    const allAndroidApps = (data.allApps || data.apps || data.applications || data.installedApps || data.appList || data.targetApps || data.mvtResults?.apps || data.mvtResults?.applications || []);

                    if (appGrid) {
                        BD_DOM.clear(appGrid);
                        appGrid.className = 'app-grid';
                        allAndroidApps.forEach(app => this.createAppIcon(app, appGrid, 'installed'));
                    }

                    // (3) 백그라운드 앱 (백그라운드 탭)
                    if (bgAppGrid) {
                        BD_DOM.clear(bgAppGrid);
                        const bgApps = allAndroidApps.filter(a => a.isRunningBg);
                        if (bgApps.length > 0) {
                            bgApps.forEach(app => this.createAppIcon(app, bgAppGrid, 'bg'));
                        } else {
                            BD_DOM.clear(bgAppGrid);
                            bgAppGrid.appendChild(BD_DOM.emptyMessage('실행 중인 백그라운드 앱이 없습니다.'));
                        }
                    }


                    // ✅ Android 앱 리스트 검색/정렬 기능 바인딩 (검색/정렬 시 아이콘 재로딩 없음)
                    this.initAndroidAppListControls(allAndroidApps);

                    // (4) 발견된 설치 파일(APK) (설치 파일 탭)
                    if (apkGrid) {
                        // 💡 APK 섹션 제목 엘리먼트 참조
                        const apkHeader = document.querySelector('#res-apk h3');

                        if (apkHeader) {
                            // 개수 계산 (데이터가 없으면 0개)
                            const apkCount = data.apkFiles ? data.apkFiles.length : 0;

                            apkHeader.textContent = `📁 발견된 APK 파일 (총 ${apkCount}개)`;
                        }

                        this.renderApkList(data.apkFiles || [], apkGrid)
                    }

                    // (5) 🔐 기기 보안 상태 (Android 전용)
                    try {
                        const container = document.getElementById('device-security-container');
                        if (container && window.electronAPI?.getDeviceSecurityStatus) {
                            container.textContent = '상태 확인 중...';
                            window.electronAPI.getDeviceSecurityStatus()
                                .then((sec) => this.renderDeviceSecurityStatus(sec, container))
                                .catch((e) => {
                                    console.warn('[DeviceSecurityStatus] load failed', e);
                                    try { container.textContent = '기기 보안 상태를 불러오지 못했습니다.'; } catch (_e) { }
                                });
                        }
                    } catch (e) {
                        console.warn('[DeviceSecurityStatus] load failed', e);
                    }

                    // 초기 화면 설정: 요약 섹션만 보이고 나머지는 숨김
                    document.querySelectorAll('.result-content-section').forEach(sec => {
                        sec.style.display = (sec.id === 'res-summary') ? 'block' : 'none';
                    });
                }
            } catch (err) {
                console.error("렌더링 도중 오류 발생:", err);
            }

            // 2. 최종 화면 전환 (결과 스크린으로 이동)
            ViewManager.showScreen(document.getElementById('logged-in-view'), 'scan-results-screen');

            // 3. 좌측 탭 하이라이트 활성화 (iOS/Android 각각의 메뉴 뭉치에서 첫 번째 탭 선택)
            const targetMenuId = isIos ? 'ios-sub-menu' : 'result-sub-menu';
            const firstTab = document.querySelector(`#${targetMenuId} .res-tab[data-target="res-summary"]`);
            if (firstTab) {
                // 모든 탭의 활성화 클래스 제거
                document.querySelectorAll('.res-tab').forEach(t => t.classList.remove('active'));
                // 현재 모드에 맞는 첫 번째 탭만 활성화
                firstTab.classList.add('active');
            }
        },

        renderApkList(apkFiles, container) {
            if (!container) return;
            BD_DOM.clear(container);

            if (!apkFiles || apkFiles.length === 0) {
                container.innerHTML = '<p class="scs-d2055e02">발견된 APK 설치 파일이 없습니다.</p>';
                return;
            }

            apkFiles.forEach(apk => {
                const div = document.createElement('div');
                div.className = 'app-item apk-file-item'; // APK 전용 스타일 구분 가능하도록 클래스 추가

                // 권한 이름만 추출하여 콤마로 연결 (상세보기 전 요약용)
                const permSummary = apk.requestedList && apk.requestedList.length > 0
                    ? apk.requestedList.map(p => p.split('.').pop()).slice(0, 3).join(', ') + '...'
                    : '요구 권한 없음';

                div.innerHTML = `
                <div class="app-icon-wrapper">
                    <img src="./assets/systemAppLogo.png" class="scs-c35a5c87">
                </div>
                <div class="app-display-name">${apk.packageName}</div>
                <div class="app-package-sub">${apk.fileSize || '용량 확인 중'}</div>
                <div class="scs-72caaa65">요구권한 ${apk.requestedCount}개</div>
            `;

                // ✅ DOM 참조 캐싱(선택): APK 목록에서도 재렌더/필터 시 재사용할 수 있도록 저장
                // 기존 코드에서 app/listKey를 참조해 오류가 발생했으므로 apk 객체에 고정 키로 캐싱합니다.
                if (!apk.__bd_el) apk.__bd_el = {};
                apk.__bd_el.apk = div;

                // 클릭 시 AppDetailManager를 통해 상세 권한 목록 표시
                div.addEventListener('click', () => {
                    // 기존 상세 로직에 apk.isApkFile = true가 있으므로 
                    // AppDetailManager.show가 권한 리스트를 한글로 잘 보여줄 것입니다.
                    showAppDetail(apk, apk.packageName);
                });

                container.appendChild(div);
            });
        },

        // ---------------------------------------------
        // 🔐 Device Security Status (Android)
        // ---------------------------------------------
        renderDeviceSecurityStatus(payload, container) {
            if (!container) return;

            // If a Promise was accidentally passed, resolve it first.
            if (payload && typeof payload.then === 'function') {
                container.textContent = '상태 확인 중...';
                payload
                    .then((resolved) => this.renderDeviceSecurityStatus(resolved, container))
                    .catch((e) => {
                        console.warn('[DeviceSecurityStatus] load failed', e);
                        container.textContent = '기기 보안 상태를 불러오지 못했습니다.';
                    });
                return;
            }

            if (!payload || payload.ok === false) {
                container.textContent = payload?.error ? `불러오기 실패: ${payload.error}` : '불러오기 실패';
                return;
            }

            const items = Array.isArray(payload.items) ? payload.items : [];
            if (items.length === 0) {
                container.textContent = '표시할 점검 항목이 없습니다.';
                return;
            }

            const badge = (status, level) => {
                const raw = String(status || 'UNKNOWN');
                const upper = raw.toUpperCase();
                const s = upper.startsWith('ON') ? 'ON'
                    : upper.startsWith('OFF') ? 'OFF'
                        : upper.startsWith('UNKNOWN') ? 'UNKNOWN'
                            : upper;

                const sev = String(level || '').toLowerCase();
                let cls = 'pill';
                let style = '';
                if (s === 'ON' && (sev === 'high' || sev === 'medium')) {
                    cls += ' pill-danger';
                } else if (s === 'ON' && sev === 'info') {
                    cls += ' pill-warn';
                } else if (s === 'OFF') {
                    style = 'background:#ecfdf3;color:#027a48;border:1px solid #abefc6;';
                } else {
                    style = 'background:#f2f4f7;color:#344054;border:1px solid #eaecf0;';
                }
                // If status contains count (e.g., "ON (3)"), show it.
                const suffix = upper.startsWith('ON') && raw.includes('(') ? escapeHtml(raw.slice(2).trim()) : '';
                return `<span class="${cls}" style="${style}">${s}${suffix ? ` <span style="opacity:.8; font-weight:500;">${suffix}</span>` : ''}</span>`;
            };

            const escapeHtml = (v) => String(v ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');

            const renderChips = (list) => {
                if (!Array.isArray(list) || list.length === 0) return '';
                const chips = list.map((x) => `<span class="ds-chip">${escapeHtml(x)}</span>`).join('');
                return `<div class="ds-chip-row">${chips}</div>`;
            };


const renderActions = (actions, itemId) => {
    if (!Array.isArray(actions) || actions.length === 0) return '';
    const btns = actions.map((a) => {
        const kind = String(a.kind || '').toLowerCase();
        const label = escapeHtml(a.label || (kind === 'opensettings' ? '설정 열기' : '실행'));

        // IMPORTANT:
        // JSON 문자열을 escapeHtml()로 attribute에 넣으면 따옴표가 &quot;로 치환되어
        // JSON.parse가 실패 → 버튼이 "아무 반응 없음"처럼 보입니다.
        // 따라서 encodeURIComponent로 넣고, 클릭 시 decodeURIComponent 후 JSON.parse 합니다.
        const data = {
            kind: a.kind,
            target: a.target,
            value: a.value,
            intent: a.intent,
            component: a.component,

            itemId
        };
        const encoded = encodeURIComponent(JSON.stringify(data));
        return `<button class="ds-btn ds-action-btn" data-ds-kind="${escapeHtml(kind)}" data-ds-action="${encoded}">${label}</button>`;
    }).join('');
    return `<div class="ds-actions">${btns}</div>`;
};

            const rows = items.map((it) => {
                const note = it.note ? `<div class="ds-note">${escapeHtml(it.note)}</div>` : '';
                const detailText = it.detail || it.desc || '';
                const chips = renderChips(it.list);

                return `
                  <div class="ds-card ds-${escapeHtml(String(it.level || 'unknown').toLowerCase())}">
                    <div class="ds-head">
                      <div class="ds-title">${escapeHtml(it.title)}</div>
                      ${badge(it.status, it.level)}
                    </div>
                    ${detailText ? `<div class="ds-desc">${escapeHtml(detailText)}</div>` : ''}
                    ${chips}
                    ${renderActions(it.actions, it.id)}
                    ${note}
                  </div>
                `;
            }).join('');

            // Add a small guide card at top
            container.innerHTML = `
              <div class="ds-guide">
                <div class="ds-guide-title">안내</div>
                <div class="ds-guide-desc">
                  이 메뉴는 스파이앱 침입에 악용될 수 있는 설정을 점검합니다. 목록에 앱이 표시된다고 해서 <b>곧바로 스파이앱</b>을 의미하지는 않습니다.
                  다만 사용자가 설치/허용한 앱 중 <b>모르는 앱</b>이 있으면 점검이 필요합니다.
                  <br><br>
                  <b>USB 디버깅(ADB)</b>은 정밀 검사 수행을 위해 활성화될 수 있으며, 검사 종료 후에는 비활성화하는 것을 권장합니다.
                </div>
              </div>
              ${rows}
            `;

            // Bind action buttons once (event delegation)
            try {
                if (!container.__dsBound) {
                    container.addEventListener('click', async (ev) => {
                        const btn = ev.target && ev.target.closest ? ev.target.closest('.ds-action-btn') : null;
                        if (!btn) return;
                        const raw = btn.getAttribute('data-ds-action');
                        if (!raw) return;
                        let payload = null;
                        try {
                            payload = JSON.parse(decodeURIComponent(raw));
                        } catch (_e) {
                            payload = null;
                        }
                        if (!payload || !payload.kind) return;

                        if (!window.electronAPI || typeof window.electronAPI.performDeviceSecurityAction !== 'function') {
                            console.warn('[DeviceSecurityStatus] performDeviceSecurityAction not available');
                            return;
                        }

                        btn.disabled = true;
                        const oldText = btn.textContent;
                        btn.textContent = '처리 중...';
                        try {
                            await window.electronAPI.performDeviceSecurityAction({ action: payload });
                            // refresh
                            const refreshed = await window.electronAPI.getDeviceSecurityStatus();
                            this.renderDeviceSecurityStatus(refreshed, container);
                        } catch (e) {
                            console.warn('[DeviceSecurityStatus] action failed', e);
                            try { btn.textContent = oldText || '실패'; } catch(_e) {}
                        } finally {
                            try { btn.disabled = false; } catch(_e) {}
                            try { btn.textContent = oldText; } catch(_e) {}
                        }
                    });
                    container.__dsBound = true;
                }
            } catch (_e) {}
        },

        // [MVT 분석 박스 렌더링 함수]

        // =========================================================
        // [iOS 5대 핵심영역 - 메뉴 분리용 렌더링]
        // =========================================================
        renderIosCoreAreas(mvtResults) {
            const areaMap = [
                {
                    key: 'web',
                    sectionId: 'res-ios-web',
                    containerId: 'ios-web-container',
                    title: '🌐 브라우저 및 웹 활동',
                    files: ['History.db', 'Favicons.db', 'WebKit', 'LocalStorage'],
                    normal: [
                        '방문 기록/도메인 분포가 사용 패턴과 일치',
                        '웹뷰/캐시 파일이 정상 범위 내에서 생성/갱신',
                        '알 수 없는 리디렉션/피싱 도메인 단서 없음'
                    ],
                    hacked: [
                        '의심 도메인(피싱/추적/명령제어) 접속 흔적',
                        '짧은 시간 내 반복 접속/자동화된 패턴',
                        '웹뷰 저장소(LocalStorage/IndexedDB)에서 비정상 토큰/스크립트 흔적'
                    ],
                    aiSafe: '웹 활동 기록에서 악성/의심 도메인 단서가 확인되지 않았고, 데이터 갱신 패턴이 정상 사용 행태와 일치합니다.',
                    aiWarn: '웹 활동 영역에서 의심 도메인/패턴이 발견되어, 피싱·추적·원격제어와 연관된 가능성을 배제할 수 없습니다.'
                },
                {
                    key: 'messages',
                    sectionId: 'res-ios-messages',
                    containerId: 'ios-messages-container',
                    title: '💬 메시지 및 통신 기록',
                    files: ['sms.db', 'ChatStorage.sqlite', 'CallHistoryDB', 'Carrier'],
                    normal: [
                        '메시지/통화 기록 구조가 정상(필드 누락/손상 없음)',
                        '발신/수신 패턴이 사용자 사용 습관과 일치',
                        '의심 링크/단축URL/스미싱 IOC 단서 없음'
                    ],
                    hacked: [
                        '스미싱/피싱 URL 또는 악성 단축링크 흔적',
                        '짧은 시간 내 다수 번호로 반복 발신/수신',
                        '메시지 DB에서 비정상 레코드/손상/이상 타임스탬프'
                    ],
                    aiSafe: '통신 기록에서 스미싱/피싱 IOC 단서가 확인되지 않았고, DB 구조도 정상 범위로 판단됩니다.',
                    aiWarn: '통신 기록에서 의심 링크/패턴이 확인되어, 스미싱·계정 탈취 시나리오 점검이 필요합니다.'
                },
                {
                    key: 'system',
                    sectionId: 'res-ios-system',
                    containerId: 'ios-system-container',
                    title: '⚙️ 시스템 로그 및 프로세스',
                    files: ['DataUsage.sqlite', 'Crash Reports', 'System Logs', 'Analytics'],
                    normal: [
                        '크래시/로그가 일반적인 앱/시스템 이벤트 중심',
                        '비정상 프로세스/반복 크래시 패턴 없음',
                        '데이터 사용량 급증/이상 통신 단서 없음'
                    ],
                    hacked: [
                        '특정 앱/프로세스의 반복 크래시(은폐/후킹 가능성)',
                        '비정상 로그 패턴(권한 상승/설정 변경 시도)',
                        '데이터 사용량 DB에서 특정 호스트로의 과도한 트래픽 흔적'
                    ],
                    aiSafe: '시스템 로그/크래시 패턴이 정상 범위로 확인되어 침해 흔적이 낮은 것으로 판단됩니다.',
                    aiWarn: '시스템 로그/크래시 영역에서 이상 징후가 확인되어 정밀 진단이 권장됩니다.'
                },
                {
                    key: 'apps',
                    sectionId: 'res-ios-appsprofiles',
                    containerId: 'ios-appsprofiles-container',
                    title: '🗂️ 설치된 앱 및 프로파일',
                    files: ['Manifest.db', 'Installed Apps', 'Profiles', 'Certificates'],
                    normal: [
                        '설치 앱 목록이 사용자 인지 범위와 일치',
                        '구성 프로파일/인증서 설치 흔적이 제한적(또는 없음)',
                        '관리(MDM) 흔적이 확인되지 않음'
                    ],
                    hacked: [
                        '사용자 인지 없는 앱/프로파일 설치 흔적',
                        '신뢰된 인증서(루트 CA) 설치로 트래픽 감청 가능성',
                        'MDM/프로파일 기반 정책 강제(프록시/VPN) 단서'
                    ],
                    aiSafe: '앱/프로파일 영역에서 정책 강제 또는 감청 구성 단서가 확인되지 않았습니다.',
                    aiWarn: '앱/프로파일 영역에서 프로파일/인증서 관련 단서가 확인되어 개인정보 유출 위험이 증가할 수 있습니다.'
                },
                {
                    key: 'artifacts',
                    sectionId: 'res-ios-artifacts',
                    containerId: 'ios-artifacts-container',
                    title: '📁 기타 시스템 파일',
                    files: ['shutdown.log', 'LocalStorage', 'Caches', 'Artifacts'],
                    normal: [
                        '아티팩트 파일 구조/갱신이 정상 범위',
                        '특정 IOC/의심 문자열/도메인 단서 없음',
                        '비정상적인 잔존 파일(은폐 흔적) 없음'
                    ],
                    hacked: [
                        '의심 문자열/도메인/IOC 단서 발견',
                        '비정상적으로 유지되는 캐시/임시파일(은폐 가능성)',
                        '분석 도구가 알려진 악성 패턴과 매칭'
                    ],
                    aiSafe: '기타 시스템 아티팩트에서 알려진 악성 IOC 매칭이 확인되지 않았습니다.',
                    aiWarn: '기타 시스템 아티팩트에서 IOC 단서가 확인되어 정밀 분석이 필요합니다.'
                }
            ];

            areaMap.forEach(area => {
                const result = mvtResults?.[area.key] || { status: 'safe', warnings: [] };
                this.renderIosCoreArea(area, result);
            });
        },

        renderIosCoreArea(area, result) {
            const container = document.getElementById(area.containerId);
            if (!container) return;

            const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
            const warningCount = warnings.length;
            const isWarning = warningCount > 0;

            const statusBadge = isWarning
                ? `<span class="scs-19b6cd4a">경고</span>`
                : `<span class="scs-186eff43">안전</span>`;

            const evidenceHtml = isWarning
                ? `<div class="scs-a9e72425">
                            <div class="scs-a95df9ac">🔎 탐지된 단서</div>
                            <ul class="scs-54163068">
                                ${warnings.slice(0, 12).map(w => `<li>${w}</li>`).join('')}
                            </ul>
                            ${warningCount > 12 ? `<div class="scs-0f2749a6">외 ${warningCount - 12}건 단서가 더 있습니다.</div>` : ''}
                        </div>`
                : `<div class="scs-29934e59">
                            ✅ 발견된 이상 징후가 없습니다.
                        </div>`;

            const aiText = isWarning ? area.aiWarn : area.aiSafe;


            const filesToShow = (Array.isArray(result?.files) && result.files.length)
                ? result.files
                : (Array.isArray(area?.files) ? area.files : []);

            const filesHtml = filesToShow.length
                ? filesToShow.map(f => `<span class="ios-major-file">${String(f)}</span>`).join(`<span class="ios-major-file-sep">, </span>`)
                : `<span class="ios-major-file-empty">표시할 파일 목록이 없습니다.</span>`;

            container.innerHTML = `
                    <div class="scs-c6adeaee">
                        <div>
                            <div class="ios-major-files"><span class="ios-major-label">주요 검사 파일</span><div class="ios-major-files-text">${filesHtml}</div></div>
                        </div>
                        <div class="scs-f6e3d7fe">
                            ${statusBadge}
                            <div class="scs-ad985d83">단서 ${warningCount}건</div>
                        </div>
                    </div>

                    <div class="scs-ff4196fe">
                        <div class="scs-640ff1f9">
                            <div class="scs-e80f7011">정상 기기 특징</div>
                            <ul class="scs-8f2fd949">
                                ${area.normal.map(x => `<li>${x}</li>`).join('')}
                            </ul>
                        </div>
                        <div class="scs-4371676c">
                            <div class="scs-ad255a56">해킹 기기 특징</div>
                            <ul class="scs-2309330d">
                                ${area.hacked.map(x => `<li>${x}</li>`).join('')}
                            </ul>
                        </div>
                    </div>

                    <div class="scs-ccd73b55">
                        <div class="scs-0291ed2a">
                            <div class="scs-033e0808">🤖</div>
                            <div class="scs-da5cd676">
                                <div class="scs-797d93e9">AI 해석</div>
                                <div class="scs-97257567">${aiText}</div>
                            </div>
                        </div>
                    </div>

                    ${evidenceHtml}
                `;
        },

        buildIosPrivacyThreatApps(allApps, incomingPrivacyApps) {
            // main에서 이미 내려준 privacyThreatApps가 있으면 우선 사용(호환)
            if (Array.isArray(incomingPrivacyApps) && incomingPrivacyApps.length > 0) {
                return incomingPrivacyApps;
            }

            const POLICY_BUNDLE_IDS = new Set([
                'com.life360.safetymapd',
                'com.geozilla.family',
                'org.findmykids.app',
                'com.glympse.glympse',
                'com.wondershare.famisafe',
                'com.snapchat.Snapchat',
                'com.burbn.instagram'
            ]);

            const normalize = (pkg) => String(pkg || '').trim();

            const candidates = (Array.isArray(allApps) ? allApps : []).filter(app => {
                const pkg = normalize(app.packageName);
                return POLICY_BUNDLE_IDS.has(pkg);
            });

            return candidates.map(app => {
                const pkg = normalize(app.packageName);
                const isInstagram = pkg === 'com.burbn.instagram';

                return {
                    ...app,
                    riskLevel: 'PRIVACY_RISK',
                    aiNarration: isInstagram
                        ? '인스타그램은 위치 공유 기능이 존재하여 사용 방식에 따라 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.'
                        : '위치 공유/가족 보호 등 위치 기반 기능 특성상 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.',
                    riskReasons: [
                        {
                            code: isInstagram ? 'INSTAGRAM_LOCATION_FEATURE' : 'LOCATION_SHARING_APP',
                            title: isInstagram ? '위치 공유 기능(인스타그램)' : '위치 공유 기능 중심 앱',
                            detail: '앱 기능 특성상 위치 기반 정보가 외부로 공유될 수 있습니다. 공유 설정/권한을 점검하는 것을 권장합니다.',
                            severity: 'LOW'
                        }
                    ],
                    recommendation: [
                        { action: 'REVIEW_SHARING', label: '공유 설정 점검' },
                        { action: 'DISABLE_LOCATION', label: '위치 접근 최소화' },
                        { action: 'LIMIT_BACKGROUND', label: '백그라운드 제한' }
                    ],
                    reason: '[개인정보 유출 위협] 위치 기반 정보 공유 가능성이 있습니다.'
                };
            });
        },
        renderMvtAnalysis(mvtResults, isIos) {
            const mvtContainer = document.getElementById('mvt-analysis-container');
            if (!mvtContainer) return;
            const sections = [
                { id: 'web', title: '🌐 1. 브라우저 및 웹 활동', files: 'History.db, Favicons.db' },
                { id: 'messages', title: '💬 2. 메시지 및 통신 기록', files: 'sms.db, ChatStorage.sqlite' },
                { id: 'system', title: '⚙️ 3. 시스템 로그 및 프로세스 활동', files: 'DataUsage.sqlite, Crash Reports' },
                { id: 'apps', title: '🗂️ 4. 설치된 앱 및 프로파일', files: 'Manifest.db, Profiles' },
                { id: 'artifacts', title: '📁 5. 기타 시스템 파일', files: 'shutdown.log, LocalStorage' }
            ];
            let html = '';
            sections.forEach(section => {
                const result = mvtResults[section.id] || { status: 'safe', warnings: [] };
                const isWarning = result.warnings && result.warnings.length > 0;
                html += `
                    <div class="analysis-section scs-034955b6">
                        <div class="analysis-header" onclick="window.toggleAnalysis(this)" class="scs-570575cd">
                            <span class="scs-2031001f">${section.title}</span>
                            <span class="scs-c08f1310">${isWarning ? '경고' : '안전'}</span>
                        </div>
                        <div class="analysis-content scs-bc9d24cf">
                            <p>주요 검사 파일: ${section.files}</p>
                            ${isWarning ? `<ul class="scs-c1939deb">${result.warnings.map(w => `<li>${w}</li>`).join('')}</ul>` : '<p class="scs-43252e92">발견된 이상 징후가 없습니다.</p>'}
                        </div>
                    </div>`;
            });
            mvtContainer.innerHTML = html;
        },

        // [아이폰용 앱 리스트 렌더링 함수]
        renderIosInstalledApps(apps, container) {
            if (!container) return;

            const list = Array.isArray(apps) ? apps : [];
            BD_DOM.clear(container);

            if (!list.length) {
                container.innerHTML = `
                        <div class="scs-49866b83">
                            검사 대상 애플리케이션이 없습니다.
                        </div>
                    `;
                return;
            }

            const sorted = [...list].sort((a, b) => {
                const an = (a.cachedTitle || a.name || a.displayName || a.packageName || a.bundleId || '').toString();
                const bn = (b.cachedTitle || b.name || b.displayName || b.packageName || b.bundleId || '').toString();
                return an.localeCompare(bn);
            });

            const grid = document.createElement('div');
            grid.className = 'ios-app-grid';

            sorted.forEach(app => {
                const name = app.cachedTitle || app.name || app.displayName || Utils.formatAppName(app.packageName || app.bundleId || '');
                const bundle = app.packageName || app.bundleId || '';

                const card = document.createElement('div');
                card.className = 'ios-app-card';

                const titleEl = document.createElement('div');
                titleEl.className = 'ios-app-name';
                titleEl.textContent = name;

                card.appendChild(titleEl);

                if (bundle) {
                    const subEl = document.createElement('div');
                    subEl.className = 'ios-app-bundle';
                    subEl.textContent = bundle;
                    card.appendChild(subEl);
                }

                grid.appendChild(card);
            });

            container.appendChild(grid);
        },

        // -------------------------------------------------
        // MVT 상세 분석 렌더링 함수 (iOS 전용)
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
                        <li class="scs-117ea7fb">
                            <span class="scs-0a152536">[IOC Match]</span> ${warning}
                        </li>
                    `).join('');
                    warningList = `<ul class="scs-df53a407">${warningList}</ul>`;
                }

                // 
                html += `
                    <div class="analysis-section" data-status="${isWarning ? 'warning' : 'safe'}" class="scs-c1a7e9ad">
                        <div class="analysis-header" onclick="toggleAnalysis(this)" class="scs-2250f14c">
                            <span class="scs-2031001f">${section.title}</span>
                            <div class="scs-72200502">
                                 <span class="scs-ed440f63">주요 검사 파일: <code>${section.files.split(',')[0].trim()}...</code></span>
                                <span class="analysis-status ${statusClass}">${statusText} (${result.warnings ? result.warnings.length : 0}건)</span>
                            </div>
                        </div>
                        <div class="analysis-content scs-5661eca1">
                            <p class="scs-271a6ab4">
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

        // 아이콘 생성 로직 (Android 전용)
        createAppIcon(app, container, listKey = 'installed') {
            const div = document.createElement('div');

            // ✅ 검색/정렬 시 아이콘 재로딩 방지: listKey 별 DOM 캐시
            if (!app.__bd_el) app.__bd_el = {};
            const cachedEl = app.__bd_el[listKey];
            // 파일에서 불러온 데이터에는 __bd_el이 "{}" 같은 일반 객체로 남아 있을 수 있어 DOM 재사용을 막아야 합니다.
            if (cachedEl && typeof cachedEl === 'object' && cachedEl.nodeType === 1) {
                // 이미 만들어진 DOM이 있으면 재사용 (아이콘/타이틀 재요청 없음)
                container.appendChild(cachedEl);
                return;
            } else if (cachedEl) {
                // 잘못된 캐시(plain object 등) 제거 후 정상 생성 흐름으로 진행
                try { delete app.__bd_el[listKey]; } catch (_) {}
            }

            const isSuspicious = app.reason ? true : false;
            div.className = `app-item ${isSuspicious ? 'suspicious' : ''}`;

            const initialName = app.cachedTitle || Utils.formatAppName(app.packageName);

            div.innerHTML = `
                    <div class="app-icon-wrapper">
                        <img src="" class="app-real-icon scs-cb458930" alt="${initialName}">
                        <span class="app-fallback-icon scs-412ba910">📱</span>
                    </div>
                    <div class="app-display-name">${initialName}</div>
                `;

            const imgTag = div.querySelector('.app-real-icon');
            const spanTag = div.querySelector('.app-fallback-icon');

            // 1. 위협 수준 판별 (VT 미사용 버전 포함)
            // - 스파이앱(빨간색): 최종필터 확정/스파이 관련 키워드/플래그
            // - 개인정보 유출 위협(노란색): PRIVACY_RISK/riskLevel/키워드
            const reasonStr = String(app?.reason || '');
            const verdictStr = String(app?.finalVerdict || app?.verdict || '').toUpperCase();
            const riskLevelStr = String(app?.riskLevel || '').toUpperCase();

            const isSpyApp = (
                app?.isSpyware === true ||
                verdictStr.includes('SPY') ||
                verdictStr.includes('MAL') ||
                reasonStr.includes('[최종 필터 확진]') ||
                (reasonStr.includes('스파이') && !reasonStr.includes('개인정보'))
            );

            const isPrivacyRisk = (
                app?.isPrivacyRisk === true ||
                riskLevelStr.includes('PRIVACY') ||
                reasonStr.includes('[개인정보') ||
                reasonStr.includes('개인정보 유출')
            );

            // 2. 테두리 클래스 결정
            let riskClass = '';
            if (isSpyApp) riskClass = 'suspicious';        // 빨간 테두리
            else if (isPrivacyRisk) riskClass = 'warning'; // 노란 테두리

            div.className = `app-item ${riskClass}`;

            // 3. 아이콘 이미지 결정 로직
            const getLocalIconPath = (appData) => {
                if (isSpyApp) return './assets/SpyAppLogo.png';

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
                // ✅ 동일 앱에 대해 아이콘/타이틀을 중복 조회하지 않도록 Promise 공유
                const ensureAppData = () => {
                    if (app.__bd_fetchPromise) return app.__bd_fetchPromise;
                    app.__bd_fetchPromise = window.electronAPI.getAppData(app.packageName);
                    return app.__bd_fetchPromise;
                };

                ensureAppData().then(result => {
                    if (!result) {
                        handleImageError(false);
                        return;
                    }

                    if (result.icon) {
                        app.cachedIconUrl = result.icon;
                        imgTag.src = result.icon;
                        imgTag.onload = () => {
                            imgTag.style.display = 'block';
                            spanTag.style.display = 'none';
                        };
                    } else {
                        handleImageError(false);
                    }

                    if (result.title) {
                        app.cachedTitle = result.title;
                        const nameEl = div.querySelector('.app-display-name');
                        if (nameEl) nameEl.textContent = result.title;
                    }
                }).catch(() => {
                    handleImageError(false);
                });
            }

            div.addEventListener
                ('click', () => {
                    showAppDetail(app, div.querySelector('.app-display-name').textContent);
                });

            app.__bd_el[listKey] = div;
            container.appendChild(div);
        },


        // -------------------------------------------------
        // ✅ Android 앱 리스트 검색/정렬 (DOM 재생성 없이 재배치만)
        // -------------------------------------------------

        // -------------------------------------------------
        // [Patch] iOS installed apps search (prevents Android grid takeover)
        // -------------------------------------------------
        initIosAppListControls(apps, container) {
            // remove any Android list listeners that might still be attached
            if (Array.isArray(State.__bd_androidListCleanup)) {
                State.__bd_androidListCleanup.forEach(fn => { try { fn && fn(); } catch (_) { } });
            }
            State.__bd_androidListCleanup = [];

            const input = document.getElementById('apps-search');
            if (!input || !container) return;

            const getName = (app) => {
                const name = app?.cachedTitle || app?.name || app?.displayName || Utils.formatAppName(app?.packageName || app?.bundleId || '');
                return String(name || '');
            };

            const list = Array.isArray(apps) ? apps : [];

            const apply = () => {
                const q = String(input.value || '').trim().toLowerCase();
                // Keep iOS layout: do NOT change container className here
                const cards = container.querySelectorAll('.ios-app-card');
                if (!cards.length) return;

                cards.forEach(card => {
                    const titleEl = card.querySelector('.ios-app-name');
                    const title = titleEl ? titleEl.textContent.toLowerCase() : '';
                    card.style.display = (!q || title.includes(q)) ? '' : 'none';
                });
            };

            const onInput = () => apply();
            input.addEventListener('input', onInput);
            State.__bd_androidListCleanup.push(() => input.removeEventListener('input', onInput));

            apply();
        },

        initAndroidAppListControls(allAndroidApps) {
            // 이전 바인딩 정리 (스캔을 여러 번 실행해도 이벤트 중복 방지)
            if (Array.isArray(State.__bd_androidListCleanup)) {
                State.__bd_androidListCleanup.forEach(fn => {
                    try { fn && fn(); } catch (_e) { }
                });
            }
            State.__bd_androidListCleanup = [];

            const appGrid = document.getElementById('app-grid-container');
            const bgGrid = document.getElementById('bg-app-grid-container');
            const appsSearch = document.getElementById('apps-search');
            const appsSort = document.getElementById('apps-sort');
            const bgSearch = document.getElementById('bg-search');
            const bgSort = document.getElementById('bg-sort');

            // iOS 모드이거나 화면 요소가 없으면 종료
            if (!appGrid || !appsSearch || !appsSort) return;

            const baseAll = Array.isArray(allAndroidApps) ? allAndroidApps : [];
            const baseBg = baseAll.filter(a => a && a.isRunningBg);

            // 안정 정렬을 위한 원본 인덱스 부여
            baseAll.forEach((app, i) => {
                if (app && app.__bd_index === undefined) app.__bd_index = i;
            });

            const getName = (app) => {
                const name = app?.cachedTitle || Utils.formatAppName(app?.packageName || '');
                return String(name || '');
            };

            const getPkg = (app) => String(app?.packageName || '');

            const getPermCount = (app) => {
                const req = Array.isArray(app?.requestedList) ? app.requestedList : [];
                const grt = Array.isArray(app?.grantedList) ? app.grantedList : [];
                return new Set([...req, ...grt]).size;
            };

            const compare = (sortKey) => (a, b) => {
                const ai = a?.__bd_index ?? 0;
                const bi = b?.__bd_index ?? 0;

                if (sortKey === 'permDesc' || sortKey === 'permAsc') {
                    const ap = getPermCount(a);
                    const bp = getPermCount(b);
                    const diff = sortKey === 'permDesc' ? (bp - ap) : (ap - bp);
                    if (diff !== 0) return diff;

                    const n = getName(a).localeCompare(getName(b));
                    if (n !== 0) return n;
                    const p = getPkg(a).localeCompare(getPkg(b));
                    if (p !== 0) return p;
                    return ai - bi;
                }

                if (sortKey === 'nameAsc') {

                    const n = getName(a).localeCompare(getName(b));
                    if (n !== 0) return n;
                    const p = getPkg(a).localeCompare(getPkg(b));
                    if (p !== 0) return p;
                    return ai - bi;
                }

                // 기본: pkgAsc
                const p = getPkg(a).localeCompare(getPkg(b));
                if (p !== 0) return p;
                const n = getName(a).localeCompare(getName(b));
                if (n !== 0) return n;
                return ai - bi;
            };

            const renderList = ({ base, container, listKey, query, sortKey, emptyMessage }) => {
                const q = String(query || '').trim().toLowerCase();

                const filtered = q.length === 0
                    ? base
                    : base.filter(app => getName(app).toLowerCase().includes(q));

                const sorted = [...filtered].sort(compare(sortKey || 'permDesc'));

                BD_DOM.clear(container);
                if (sorted.length === 0) {
                    container.innerHTML = `<p class="scs-8a8fe311">${emptyMessage}</p>`;
                    return;
                }

                sorted.forEach(app => {
                    const el = app?.__bd_el?.[listKey];
                    if (el) container.appendChild(el);
                });
            };

            const bind = ({ inputEl, selectEl, container, base, listKey, emptyMessage }) => {
                if (!inputEl || !selectEl || !container) return;

                const apply = () => renderList({
                    base,
                    container,
                    listKey,
                    query: inputEl.value,
                    sortKey: selectEl.value,
                    emptyMessage
                });

                const onInput = () => apply();
                const onChange = () => apply();

                inputEl.addEventListener('input', onInput);
                selectEl.addEventListener('change', onChange);

                State.__bd_androidListCleanup.push(() => inputEl.removeEventListener('input', onInput));
                State.__bd_androidListCleanup.push(() => selectEl.removeEventListener('change', onChange));

                // 초기 1회 반영
                apply();
            };

            bind({
                inputEl: appsSearch,
                selectEl: appsSort,
                container: appGrid,
                base: baseAll,
                listKey: 'installed',
                emptyMessage: '검색 결과가 없습니다.'
            });

            // bg UI가 존재할 때만 바인딩
            if (bgGrid && bgSearch && bgSort) {
                bind({
                    inputEl: bgSearch,
                    selectEl: bgSort,
                    container: bgGrid,
                    base: baseBg,
                    listKey: 'bg',
                    emptyMessage: '검색 결과가 없습니다.'
                });
            }
        },

        // 위협 리스트 렌더링 (iOS/Android 공통 - 로직 개선)

        // 위협 리스트 렌더링 (요약 탭: 스파이앱 탐지 근거)
        renderSuspiciousList(suspiciousApps, isIos = false) {
            // 요약 탭 전용 컨테이너(신규 UI) 우선 사용, 없으면 구버전 컨테이너 사용
            const container = document.getElementById('spyware-detail-container') || document.getElementById('suspicious-list-container');
            if (!container) return;

            const list = Array.isArray(suspiciousApps) ? suspiciousApps.slice() : [];

            if (list.length === 0) {
                const safeMessage = isIos
                    ? '정밀 분석 결과, 알려진 스파이웨어 흔적이 발견되지 않았습니다.'
                    : '정밀 분석 결과, 스파이앱으로 확정된 항목이 없습니다.';
                container.innerHTML = `
                    <div class="empty-soft scs-1ca3ba3c">
                        <div class="scs-568eaa97">✅</div>
                        <div class="scs-8e18acb2">안전함 (Clean)</div>
                        <div class="scs-6503d6d6">${safeMessage}</div>
                    </div>
                `;
                return;
            }

            const escapeHtml = (v) => String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');

            const normalizeReasons = (app) => {
                const reasons = Array.isArray(app?.riskReasons) ? app.riskReasons : [];
                if (reasons.length) {
                    return reasons.map(r => {
                        const title = r?.title || r?.code || '탐지 근거';
                        const detail = r?.detail || r?.description || '';
                        const sev = String(r?.severity || '').toUpperCase();
                        return { title, detail, sev };
                    });
                }
                // fallback: reason 문자열을 하나의 근거로 노출
                const fallback = app?.reason ? String(app.reason) : '';
                return fallback ? [{ title: '탐지 근거', detail: fallback, sev: 'HIGH' }] : [];
            };

            const sevBadge = (sev) => {
                const s = String(sev || '').toUpperCase();
                const color = (s === 'HIGH') ? '#d9534f' : (s === 'MEDIUM' ? '#f0ad4e' : '#5bc0de');
                const label = (s === 'HIGH') ? '높음' : (s === 'MEDIUM' ? '중간' : '참고');
                return `<span class="scs-e2f81c9f">${label}</span>`;
            };

            const actionChips = `
                <div class="scs-4b8a213c">
                    <span class="scs-31de4950">🛡️ 권한 무력화</span>
                    <span class="scs-31de4950">🗑️ 강제 삭제</span>
                </div>
                <div class="scs-06b90fa5">
                    <b>증거 보존을 원하신다면</b> 우선 <b>권한을 무력화</b>하여 증거를 보존하세요. 핵심 권한이 차단되면 스파이앱은 실질적인 활동을 수행하기 어렵습니다.<br/>
                    <b>강제 삭제</b>는 증거 보존에는 불리할 수 있지만, 보고서(PDF)가 출력되므로 "찝찝함"을 해소하려면 삭제가 가장 확실한 방법입니다.
                </div>
            `;

            const html = [`<div class="evidence-list scs-1be5ad5c">`];
            list.forEach(app => {
                const name = app.cachedTitle || Utils.formatAppName(app.packageName);
                const pkg = app.packageName || app.bundleId || '-';
                const narration = app.aiNarration || app.ai || app.reason || '';
                const reasons = normalizeReasons(app);

                const reasonsHtml = reasons.length ? `
                    <div class="scs-5371db16">
                        <div class="scs-481a87d1">🤖 탐지 근거</div>
                        <div class="scs-5ba2fd66">
                            ${reasons.slice(0, 10).map(r => `
                                <div class="scs-c2a105f8">
                                    <div class="scs-d03ad3be">
                                        <div class="scs-9e326a8b">${escapeHtml(r.title)}</div>
                                        ${sevBadge(r.sev)}
                                    </div>
                                    ${r.detail ? `<div class="scs-59def752">${escapeHtml(r.detail)}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : '';

                html.push(`
                    <details class="evidence-item" open class="scs-840eea4c">
                        <summary class="scs-172f5022">
                            <div class="scs-088b1b25">🚨 ${escapeHtml(name)} <span class="scs-275677d5">(${escapeHtml(pkg)})</span></div>
                            <span class="scs-b169df12">최종 확정</span>
                        </summary>
                        ${narration ? `<div class="scs-df496d2a"><b>BD_SFA 해석</b><br/>${escapeHtml(narration)}</div>` : ''}
                        ${reasonsHtml}
                        <div class="scs-002535c2">
                            <div class="scs-9e326a8b">✅ 권장 조치</div>
                            ${actionChips}
                        </div>
                    </details>
                `);
            });
            html.push(`</div>`);
            container.innerHTML = html.join('');
        },
        renderPrivacyThreatList(privacyApps) {
            // 요약 탭(privacy-threat-detail-container)과 개인정보 탭(privacy-threat-list-container) 모두 갱신
            const containers = [
                document.getElementById('privacy-threat-detail-container'),
                document.getElementById('privacy-threat-list-container')
            ].filter(Boolean);
            if (containers.length === 0) return;

            containers.forEach(c => { BD_DOM.clear(c); });

            if (!Array.isArray(privacyApps) || privacyApps.length === 0) {
                const emptyHtml = `
                                    <div class="scs-3116fb7c">
                                        ✅ 탐지된 개인정보 유출 위협이 없습니다.
                                    </div>`;
                containers.forEach(c => { c.innerHTML = emptyHtml; });
                return;
            }

            const buildChips = (items) => {
                if (!Array.isArray(items) || items.length === 0) return '';
                return items.map(x => `<span class="scs-a0b0d84f">${x.label || x}</span>`).join('');
            };

            const buildReasons = (reasons) => {
                // reasons가 문자열 배열이 아닐 수 있어(예: {title, detail} 객체). 안전하게 문자열로 정규화
                const escapeHtml = (v) => String(v)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');

                if (!Array.isArray(reasons) || reasons.length === 0) return '';

                const toReasonText = (r) => {
                    if (r == null) return '';
                    if (typeof r === 'string') return r;
                    if (typeof r === 'number' || typeof r === 'boolean') return String(r);

                    if (typeof r === 'object') {
                        // 다양한 키 케이스를 흡수
                        const title = r.title ?? r.name ?? r.rule ?? r.label ?? r.type ?? r.code ?? '';
                        const detail = r.detail ?? r.desc ?? r.description ?? r.reason ?? r.value ?? '';

                        if (title && detail) return `${title} - ${detail}`;
                        if (title) return String(title);
                        if (detail) return String(detail);

                        try {
                            return JSON.stringify(r);
                        } catch (e) {
                            return String(r);
                        }
                    }

                    return String(r);
                };

                return reasons
                    .filter(Boolean)
                    .slice(0, 8)
                    .map((r) => {
                        const t = toReasonText(r).trim();
                        if (!t) return '';

                        // title/desc 분리 (예: "타이틀 - 설명", "타이틀: 설명")
                        let title = t;
                        let desc = '';
                        const separators = [' - ', ' — ', ' – ', ': ', ' : '];
                        for (const sep of separators) {
                            const idx = t.indexOf(sep);
                            if (idx > 0 && idx < t.length - sep.length) {
                                title = t.slice(0, idx).trim();
                                desc = t.slice(idx + sep.length).trim();
                                break;
                            }
                        }

                        // 오른쪽(초기 디자인)처럼: 굵은 제목 + 얇은 설명(있을 때만)
                        return `<li class="scs-dddb9c88">
            <span class="scs-9f4a211c"></span>
            <div class="scs-3f9f96c6">
                <div class="scs-a6341b0b">${escapeHtml(title)}</div>
                ${desc ? `<div class="scs-56d5d3f9">${escapeHtml(desc)}</div>` : ''}
            </div>
        </li>`;
                    })
                    .filter(Boolean)
                    .join('');
            };

            const html = privacyApps.map(app => {
                const dName = app.cachedTitle || Utils.formatAppName(app.packageName);
                const policyLabel = app.policyLabel || app.policy || '';
                const aiText = app.aiNarration || app.ai || app.reason || '[개인정보 유출 위협] 위치 기반 정보 공유 가능성이 있습니다.';
                const reasons = app.riskReasons || app.reasons || [];
                const recs = app.recommendation || app.recommendations || [
                    { label: '공유 설정/기록 점검' },
                    { label: '백그라운드 실행 제한' }
                ];

                return `
                                    <div class="scs-51065922">
                                        <div class="scs-ca5e0e95">
                                            <div class="scs-84b9e4a2">
                                                ⚠️ ${dName} <span class="scs-0fcb4300">(${app.packageName})</span>
                                            </div>
                                            ${policyLabel ? `<div class="scs-c3c4423e">정책: ${policyLabel}</div>` : ''}
                                        </div>

                                        <div class="scs-6551985d">
                                            <div class="scs-989b00fa">🤖 AI 안내</div>
                                            <div class="scs-a73acd8b">${aiText}</div>
                                        </div>

                                        <div class="scs-6b9902a8">
                                            <div class="scs-989b00fa">🤖 AI 판단 근거</div>
                                            ${buildReasons(reasons)}
                                        </div>

                                        <div class="scs-5371db16">
                                            <div class="scs-3493d013">✅ 권장 조치</div>
                                            <div>${buildChips(recs)}</div>
                                        </div>
                                    </div>
                                `;
            }).join('');

            containers.forEach(c => { c.innerHTML = html; });
        },


        forceRenderIosCoreAreas() {
            try {
                const data = window.__bd_lastScanData || window.lastScanData || {};
                this.renderIosCoreAreas(data.mvtResults || {});
            } catch (e) {
                console.error('[iOS] forceRenderIosCoreAreas failed:', e);
            }
        }
    };

    window.__bd_forceRenderIosCoreAreas = () => {
        try { ResultsRenderer.forceRenderIosCoreAreas(); } catch (e) { }
    };

    window.__bd_resetAndroidDashboardUI = bdResetAndroidDashboardUI;
    window.__bd_stopAndroidDashboardPolling = () => {
        try { ScanController.stopAndroidDashboardPolling && ScanController.stopAndroidDashboardPolling(); } catch (_) { }
    };

}