
// Auto-split module: scanController

import { Utils } from '../core/utils.js';
import { renderSuspiciousListView } from '../features/scan/scanView.js';
import { createAndroidDashboardController } from '../features/scan/androidDashboardController.js';
import { createAndroidAppListController } from '../features/scan/androidAppListController.js';
import { buildIosPrivacyThreatApps, renderApkList } from '../features/scan/appCollections.js';
import { createDeviceSecurityStatusController } from '../features/scan/deviceSecurityStatus.js';
import { createIosCoreAreasRenderer } from '../features/scan/iosCoreAreas.js';
import { renderIosInstalledApps } from '../features/scan/iosInstalledApps.js';
import { renderMvtAnalysis as renderMvtAnalysisPanel } from '../features/scan/mvtAnalysis.js';
import { initIosAppListControls as bindIosAppListControls, renderPrivacyThreatList as renderPrivacyThreatPanel, renderSuspiciousList as renderSuspiciousPanel } from '../features/scan/resultPanels.js';
import { getNormalizedScanApps, normalizeDeviceMode, normalizeLoadedScanData, renderScanInfo } from '../features/scan/scanInfo.js';
export function initScanController(ctx) {
    const IOS_TRUST_PROMPT_MESSAGE = "검사를 위해 iPhone에서 PIN 입력 후 '이 컴퓨터 신뢰'를 승인해주세요.";

    // Shared access to AppDetailManager (module-safe)
    function showAppDetail(appData, displayName) {
        const mgr = ctx.services && ctx.services.appDetailManager;
        if (!mgr || typeof mgr.show !== 'function') {
            console.error('[BD-Scanner] AppDetailManager is not available yet.');
            return;
        }
        mgr.show(appData, displayName);
    }
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;

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

const androidDashboardController = createAndroidDashboardController({
    State,
    CustomUI,
    clear: (el) => BD_DOM.clear(el)
});
const androidAppListController = createAndroidAppListController({
    State,
    Utils,
    clear: (el) => BD_DOM.clear(el),
    showAppDetail,
    getAppData: (packageName) => window.electronAPI.getAppData(packageName)
});
const deviceSecurityStatusController = createDeviceSecurityStatusController();
const iosCoreAreasRenderer = createIosCoreAreasRenderer();

    ctx.helpers = ctx.helpers || {};
    ctx.helpers.renderScanInfo = (payload, fileMeta) => renderScanInfo(payload, fileMeta);
    ctx.helpers.setDashboardScrollLock = (on) => bdSetDashboardScrollLock(on);

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

                // iOS 결과 화면:
                // - 실시간 검사 결과: 기존 iOS 서브메뉴만 노출
                // - '검사 열기'로 불러온 결과: Android와 동일하게 '검사 정보' 탭도 노출
                if (State.isLoadedScan) {
                    show(scanInfoNav);
                } else {
                    hide(scanInfoNav);
                }
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
    try { bdSetMenuState('preScan'); } catch (_e) { }

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

            State.scanRuntime.inProgress = true;
            State.scanRuntime.phase = 'starting';

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
            State.lastScanData = null;
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

                    State.lastScanFileMeta = result.fileMeta || null;

                    try {
                        ctx.helpers.renderScanInfo?.(data, State.lastScanFileMeta);
                    } catch (e) {
                        console.warn('[BD-Scanner] scan-info render failed:', e);
                    }

                    // 2) UI 전환
                    // 만약 에러가 여기서 난다면 아래 줄을 주석 처리해보세요.
                    try { ViewManager.activateMenu('nav-result'); } catch (e) { }

                    bdSetDashboardScrollLock(false);
                    ViewManager.showScreen(loggedInView, 'scan-results-screen');

                    const applyInitialResultTabHighlight = () => {
                        const mode = normalizeDeviceMode(State.currentDeviceMode || osMode);
                        const isIos = mode === 'ios';
                        const activeMenuId = isIos ? 'ios-sub-menu' : 'result-sub-menu';
                        const inactiveMenuId = isIos ? 'result-sub-menu' : 'ios-sub-menu';

                        const activeMenu = document.getElementById(activeMenuId);
                        const inactiveMenu = document.getElementById(inactiveMenuId);

                        if (inactiveMenu) {
                            inactiveMenu.classList.add('hidden');
                            inactiveMenu.style.display = 'none';
                        }

                        if (activeMenu) {
                            activeMenu.classList.remove('hidden');
                            activeMenu.style.display = 'block';
                        }

                        const firstTab = document.querySelector(`#${activeMenuId} .res-tab[data-target="res-summary"]`);
                        if (firstTab) {
                            document.querySelectorAll(`#${activeMenuId} .res-tab`).forEach(t => t.classList.remove('active'));
                            firstTab.classList.add('active');
                        }
                    };

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
                        applyInitialResultTabHighlight();
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

                    // '검사 열기'로 결과 파일을 불러온 경우: OS와 무관하게 실시간 대시보드는 숨기고, 정보 탭을 노출
                    if (navAndroidDash) {
                        navAndroidDash.classList.add('hidden');
                        navAndroidDash.style.display = 'none';
                    }
                    if (navScanInfo) {
                        // 검사 열기 모드에서는 OS와 무관하게 '검사 정보' 라벨 유지
                        const labelSpan = navScanInfo.querySelector('span');
                        const mode = String(osMode).toLowerCase();
                        if (labelSpan) {
                            labelSpan.textContent = '📝 검사 정보';
                        }
                        navScanInfo.classList.remove('hidden');
                        navScanInfo.style.display = 'block';
                    }

                    await CustomUI.alert(`✅ 검사 결과 로드 완료!\n모델: ${data.deviceInfo?.model || '-'}`);

                    // 알림 확인 후에도 첫 결과 탭 하이라이트가 유지되도록 한 번 더 보정
                    setTimeout(() => {
                        try { applyInitialResultTabHighlight(); } catch (_) { }
                    }, 0);

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
            State.lastScanData = null;

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

                const apps = getNormalizedScanApps(scanData);

                const totalApps = apps.length;

                if (totalApps === 0) {
                    this.toggleLaser(false);
                    this.finishScan(scanData);
                    console.log('[Security] 검사 성공. 결과 화면 진입 후 10초 뒤 임시 분석 데이터 정리 안내를 표시합니다. ANDROID');
                    setTimeout(async () => {
                        try {
                            await CustomUI.alert(
                                `✅ 검사 수집 데이터 삭제 완료
검사에 사용된 안드로이드 수집 데이터가 안전하게 삭제되었습니다.`
                            );
                        } catch (_e) { }
                    }, 10000);
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
                            console.log('[Security] 검사 성공. 결과 화면 진입 후 10초 뒤 임시 분석 데이터 정리 안내를 표시합니다. ANDROID');
                            setTimeout(async () => {
                                try {
                                    await CustomUI.alert(
                                        `✅ 검사 수집 데이터 삭제 완료
검사에 사용된 안드로이드 수집 데이터가 안전하게 삭제되었습니다.`
                                    );
                                } catch (_e) { }
                            }, 10000);
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
                            console.log('[Security] 검사 성공. 결과 화면 진입 후 10초 뒤 임시 분석 데이터 정리 안내를 표시합니다. ANDROID');
                            setTimeout(async () => {
                                try {
                                    await CustomUI.alert(
                                        `✅ 검사 수집 데이터 삭제 완료
검사에 사용된 안드로이드 수집 데이터가 안전하게 삭제되었습니다.`
                                    );
                                } catch (_e) { }
                            }, 10000);
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
            State.lastScanData = null;
            State.lastScanData = null;
            this.toggleLaser(true);
            let iosBackupStageLatched = false;

            const setIosStep = (step, text) => {
                const statusText = document.getElementById('scan-status-text');
                const progressLine = document.getElementById('ios-stepper-progress');

                if (statusText && text) {
                    statusText.textContent = text;
                }

                const widthMap = {
                    1: '0%',
                    2: '25%',
                    3: '50%',
                    4: '75%'
                };

                if (progressLine) {
                    progressLine.style.width = widthMap[step] || '0%';
                }

                for (let i = 1; i <= 4; i += 1) {
                    const el = document.getElementById(`ios-step-${i}`);
                    if (!el) continue;

                    el.classList.remove('done', 'current', 'pending');

                    if (i < step) {
                        el.classList.add('done');
                    } else if (i === step) {
                        el.classList.add('current');
                    } else {
                        el.classList.add('pending');
                    }
                }
            };

            let offIosProgress = null;
            const hasMeaningfulBackupSignal = (payload) => {
                const bytes = Number(payload?.bytes) || 0;
                const files = Number(payload?.files) || 0;
                const current = Number(payload?.current) || 0;
                const total = Number(payload?.total) || 0;
                const minBackupBytes = 24 * 1024 * 1024;
                const minBackupFiles = 25;
                const minBackupCount = 25;

                return (
                    (current >= minBackupCount && total > 0)
                    || bytes >= minBackupBytes
                    || files >= minBackupFiles
                );
            };
            const resolveIosStageMessage = (payload) => {
                const stage = String(payload?.stage || '').trim().toLowerCase();
                const rawMessage = payload?.message ? String(payload.message) : '';
                const bytes = Number(payload?.bytes) || 0;
                const files = Number(payload?.files) || 0;
                const hasBackupSignal = hasMeaningfulBackupSignal(payload);
                const trustConfirmed = payload?.trustConfirmed === true;

                if (stage === 'mvt') {
                    return rawMessage || '수집된 데이터를 기반으로 정밀 분석을 진행하는 중...';
                }

                if (!trustConfirmed) {
                    return rawMessage || IOS_TRUST_PROMPT_MESSAGE;
                }

                if (stage === 'backup' && hasBackupSignal) {
                    if (bytes > 0 || files > 0) {
                        return `검사 데이터 수집 중... (파일 ${files.toLocaleString('en-US')}개 / ${Utils.formatBytes(bytes)})`;
                    }
                    return rawMessage || IOS_TRUST_PROMPT_MESSAGE;
                }

                return rawMessage || IOS_TRUST_PROMPT_MESSAGE;
            };
            setIosStep(1, IOS_TRUST_PROMPT_MESSAGE);

            try {
                if (window.electronAPI && typeof window.electronAPI.onIosScanProgress === 'function') {
                    offIosProgress = window.electronAPI.onIosScanProgress((payload) => {
                        try {
                            const stage = String(payload?.stage || '').trim().toLowerCase();
                            const msg = resolveIosStageMessage(payload);
                            const rawMessage = String(payload?.message || '');
                            const trustConfirmed = payload?.trustConfirmed === true;
                            const shouldLatchBackup =
                                trustConfirmed
                                && (
                                    hasMeaningfulBackupSignal(payload)
                                    || /백업|데이터 수집/i.test(rawMessage)
                                );

                            if (stage === 'mvt') {
                                iosBackupStageLatched = true;
                                setIosStep(3, '정밀 분석 진행 중...');
                                return;
                            }

                            if (stage === 'backup') {
                                if (shouldLatchBackup) {
                                    iosBackupStageLatched = true;
                                }

                                if (iosBackupStageLatched) {
                                    setIosStep(2, msg || '검사 데이터 수집 중...');
                                } else if (shouldLatchBackup) {
                                    setIosStep(2, msg || '검사 데이터 수집 중...');
                                } else {
                                    setIosStep(1, IOS_TRUST_PROMPT_MESSAGE);
                                }
                                return;
                            }

                            if (iosBackupStageLatched) {
                                setIosStep(2, msg || '검사 데이터 수집 중...');
                                return;
                            }

                            if (!trustConfirmed) {
                                setIosStep(1, msg || IOS_TRUST_PROMPT_MESSAGE);
                                return;
                            }

                            setIosStep(1, msg || IOS_TRUST_PROMPT_MESSAGE);
                        } catch (_e) { }
                    });
                }
            } catch (_e) { }

            try {
                const isPrivilegedRole = State.userRole === 'admin' || State.userRole === 'distributor';
                const iosProgressPolicy = isPrivilegedRole
                    ? (State.iosProgressMode || 'real')
                    : 'random_20_30';

                const rawData = await window.electronAPI.runIosScan(State.currentUdid, {
                    progressPolicy: iosProgressPolicy,
                    userRole: State.userRole || 'user'
                });
                if (rawData.error) throw new Error(rawData.error);

                const data = Utils.transformIosData(rawData);
                setIosStep(4, '결과 정리 중...');
                await new Promise((resolve) => setTimeout(resolve, 400));
                this.finishScan(data);

                const finishedUdid = State.currentUdid;
                console.log(`[Security] 검사 성공. 결과 화면 진입 후 10초 뒤 백업 삭제를 시도합니다. UDID=${finishedUdid}`);

                setTimeout(async () => {
                    try {
                        const res = await window.electronAPI.deleteIosBackup(finishedUdid);

                        if (res?.success && res?.deleted) {
                            await CustomUI.alert(
                                `✅ 임시 백업 데이터 삭제 완료
                            검사에 사용된 iPhone 임시 백업 데이터가 안전하게 삭제되었습니다.`
                            );
                            return;
                        }

                        if (res?.success && !res?.deleted) {
                            return;
                        }

                        await CustomUI.alert(
                            `⚠️ 임시 백업 데이터 자동 삭제 확인 필요

                            이번 검사에 사용된 로컬 임시 백업 파일을
                            자동으로 삭제하지 못했습니다.

                            개인정보 보호를 위해 백업 폴더 상태를 확인해주세요.
                            오류: ${res?.error || '알 수 없는 오류'}`
                        );
                    } catch (err) {
                        await CustomUI.alert(
                            `⚠️ 임시 백업 데이터 자동 삭제 확인 필요

                            이번 검사에 사용된 로컬 임시 백업 파일 삭제 중
                            오류가 발생했습니다.

                            개인정보 보호를 위해 백업 폴더 상태를 확인해주세요.
                            오류: ${err?.message || err}`
                        );
                    }
                }, 10000);

            } catch (error) {
                this.handleError(error);
            } finally {
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
            androidDashboardController.start();
        },

        stopAndroidDashboardPolling() {
            androidDashboardController.stop();
        },

        _renderAndroidDashboard({ metrics, spec, top }) {
            androidDashboardController.render({ metrics, spec, top });
        },


        finishScan(data) {
            State.scanRuntime.inProgress = false;
            State.scanRuntime.phase = 'completed';

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
            State.lastScanData = data;

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
            State.scanRuntime.inProgress = false;
            State.scanRuntime.phase = 'error';

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


            State.lastScanData = data;
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
            if (isIos && Array.isArray(State.scanRuntime?.androidListCleanup)) {
                State.scanRuntime.androidListCleanup.forEach(fn => { try { fn && fn(); } catch (_) { } });
                State.scanRuntime.androidListCleanup = [];
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
                    try {
                        renderSuspiciousListView({ suspiciousApps: (data.suspiciousApps || []), isIos: true, Utils });
                    } catch (e) {
                        console.warn('[IosResults] suspicious list render failed', e);
                    }
                    // (2) 5대 핵심영역: 영역별 상세 리포트(분리 메뉴)
                    try {
                        this.renderIosCoreAreas(data.mvtResults || {});
                    } catch (e) {
                        console.warn('[IosResults] core areas render failed', e);
                    }

                    // (2-1) iOS 개인정보 유출 위협: 정책 기반(앱 번들ID) + AI 안내
                    const normalizedApps = getNormalizedScanApps(data).filter((app) => app && typeof app === 'object');
                    const iosPrivacyApps = buildIosPrivacyThreatApps(
                        normalizedApps,
                        Array.isArray(data.privacyThreatApps) ? data.privacyThreatApps : []
                    );
                    try {
                        renderPrivacyThreatPanel({
                            privacyApps: iosPrivacyApps,
                            clear: (el) => BD_DOM.clear(el),
                            formatAppName: (name) => Utils.formatAppName(name)
                        });
                    } catch (e) {
                        console.warn('[IosResults] privacy list render failed', e);
                    }

                    // (3) 앱 목록 탭: iOS 전용 리스트
                    if (appGrid) {
                        try {
                            BD_DOM.clear(appGrid);
                            appGrid.className = ""; // iOS는 리스트 형태이므로 클래스 초기화
                            renderIosInstalledApps({
                                apps: normalizedApps,
                                container: appGrid,
                                clear: (el) => BD_DOM.clear(el),
                                formatAppName: (name) => Utils.formatAppName(name)
                            });
                            bindIosAppListControls({
                                State,
                                Utils,
                                apps: normalizedApps,
                                container: appGrid
                            });
                        } catch (e) {
                            console.warn('[IosResults] installed apps render failed', e);
                            BD_DOM.clear(appGrid);
                            appGrid.appendChild(BD_DOM.emptyMessage('iOS 앱 목록을 렌더링하지 못했습니다.'));
                        }
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

                    try {
                        renderSuspiciousListView({ suspiciousApps: (data.suspiciousApps || []), isIos: false, Utils });
                    } catch (e) {
                        console.warn('[AndroidResults] suspicious list render failed', e);
                    }
                    try {
                        renderPrivacyThreatPanel({
                            privacyApps: Array.isArray(data.privacyThreatApps) ? data.privacyThreatApps : [],
                            clear: (el) => BD_DOM.clear(el),
                            formatAppName: (name) => Utils.formatAppName(name)
                        });
                    } catch (e) {
                        console.warn('[AndroidResults] privacy list render failed', e);
                    }

                    // (2) 모든 설치된 앱 (앱 목록 탭)
                    const allAndroidApps = getNormalizedScanApps(data).filter((app) => app && typeof app === 'object');

                    if (appGrid) {
                        try {
                            BD_DOM.clear(appGrid);
                            appGrid.className = 'app-grid';
                            if (allAndroidApps.length > 0) {
                                allAndroidApps.forEach(app => androidAppListController.createAppIcon(app, appGrid, 'installed'));
                            } else {
                                appGrid.appendChild(BD_DOM.emptyMessage('설치된 앱 데이터를 불러오지 못했습니다.'));
                            }
                        } catch (e) {
                            console.warn('[AndroidResults] installed apps render failed', e);
                            BD_DOM.clear(appGrid);
                            appGrid.appendChild(BD_DOM.emptyMessage('설치된 앱 화면을 렌더링하지 못했습니다.'));
                        }
                    }

                    // (3) 백그라운드 앱 (백그라운드 탭)
                    if (bgAppGrid) {
                        try {
                            BD_DOM.clear(bgAppGrid);
                            const bgApps = allAndroidApps.filter(a => a.isRunningBg);
                            if (bgApps.length > 0) {
                                bgApps.forEach(app => androidAppListController.createAppIcon(app, bgAppGrid, 'bg'));
                            } else {
                                bgAppGrid.appendChild(BD_DOM.emptyMessage('실행 중인 백그라운드 앱이 없습니다.'));
                            }
                        } catch (e) {
                            console.warn('[AndroidResults] background apps render failed', e);
                            BD_DOM.clear(bgAppGrid);
                            bgAppGrid.appendChild(BD_DOM.emptyMessage('백그라운드 앱 화면을 렌더링하지 못했습니다.'));
                        }
                    }


                    // ✅ Android 앱 리스트 검색/정렬 기능 바인딩 (검색/정렬 시 아이콘 재로딩 없음)
                    try {
                        androidAppListController.initAndroidAppListControls(allAndroidApps);
                    } catch (e) {
                        console.warn('[AndroidResults] app list controls bind failed', e);
                    }

                    // (4) 발견된 설치 파일(APK) (설치 파일 탭)
                    if (apkGrid) {
                        try {
                            const apkHeader = document.querySelector('#res-apk h3');
                            const apkFiles = Array.isArray(data.apkFiles) ? data.apkFiles.filter((apk) => apk && typeof apk === 'object') : [];

                            if (apkHeader) {
                                apkHeader.textContent = `📁 발견된 APK 파일 (총 ${apkFiles.length}개)`;
                            }

                            renderApkList({
                                apkFiles,
                                container: apkGrid,
                                clear: (el) => BD_DOM.clear(el),
                                showAppDetail
                            });
                        } catch (e) {
                            console.warn('[AndroidResults] apk list render failed', e);
                            BD_DOM.clear(apkGrid);
                            apkGrid.appendChild(BD_DOM.emptyMessage('APK 목록을 렌더링하지 못했습니다.'));
                        }
                    }

                    // (5) 🔐 기기 보안 상태 (Android 전용)
                    try {
                        const container = document.getElementById('device-security-container');
                        if (container && window.electronAPI?.getDeviceSecurityStatus) {
                            deviceSecurityStatusController.load(container);
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

        // [MVT 분석 박스 렌더링 함수]

        // =========================================================
        // [iOS 5대 핵심영역 - 메뉴 분리용 렌더링]
        // =========================================================
        renderIosCoreAreas(mvtResults) {
            iosCoreAreasRenderer.render(mvtResults);
        },

        // -------------------------------------------------
        // MVT 상세 분석 렌더링 함수 (iOS 전용)
        // -------------------------------------------------
        renderMvtAnalysis(mvtResults, isIos) {
            renderMvtAnalysisPanel({ mvtResults, isIos });
        },

        renderSuspiciousList(suspiciousApps, isIos = false) {
            renderSuspiciousPanel({
                suspiciousApps,
                isIos,
                formatAppName: (name) => Utils.formatAppName(name)
            });
        },
        renderPrivacyThreatList(privacyApps) {
            renderPrivacyThreatPanel({
                privacyApps,
                clear: (el) => BD_DOM.clear(el),
                formatAppName: (name) => Utils.formatAppName(name)
            });
        },


        forceRenderIosCoreAreas() {
            try {
                const data = State.lastScanData || {};
                this.renderIosCoreAreas(data.mvtResults || {});
            } catch (e) {
                console.error('[iOS] forceRenderIosCoreAreas failed:', e);
            }
        }
    };

    ctx.helpers.forceRenderIosCoreAreas = () => {
        try { ResultsRenderer.forceRenderIosCoreAreas(); } catch (e) { }
    };
    ctx.helpers.resetAndroidDashboardUI = bdResetAndroidDashboardUI;
    ctx.helpers.stopAndroidDashboardPolling = () => {
        try { ScanController.stopAndroidDashboardPolling && ScanController.stopAndroidDashboardPolling(); } catch (_) { }
    };

}
