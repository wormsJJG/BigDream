// Auto-split module: scanController

import { Utils } from '../core/utils.js';
import { setCircularGauge } from '../lib/circularGauge.js';
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
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

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

            const isLogged = await ScanController.startLogTransaction(State.currentDeviceMode);

            if (!isLogged) {

                CustomUI.alert('서버 통신 오류로 검사를 시작할 수 없습니다. 네트워크를 연결해주세요.');
                // 로그 기록 실패 시 버튼 상태 복구
                realStartScanBtn.disabled = false;
                realStartScanBtn.textContent = '검사 시작하기';
                return;
            }

            ((ctx.services && ctx.services.deviceManager) ? ctx.services.deviceManager.stopPolling() : undefined);

            const createBtn = document.getElementById('nav-create');
            const openBtn = document.getElementById('nav-open');
            const subMenu = document.getElementById('result-sub-menu');

            if (createBtn) createBtn.classList.add('hidden');
            if (openBtn) openBtn.classList.add('hidden');

            if (subMenu) {
                subMenu.classList.add('hidden');
                subMenu.classList.remove('active');
            }

            // Android: use dedicated dashboard screen, iOS: keep legacy progress screen
            if (State.currentDeviceMode === 'android') {
                // show Android dashboard nav
                const dashNav = document.getElementById('nav-android-dashboard');
                if (dashNav) {
                    dashNav.classList.remove('hidden');
                    dashNav.style.display = '';
                }
                ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');
            } else {
                ViewManager.showScreen(loggedInView, 'scan-progress-screen');
            }

            if (State.currentDeviceMode === 'android') {
                // 1. 좌측 네비게이션 메뉴 중 '대시보드' 탭 하이라이트 활성화
                ViewManager.activateMenu('nav-android-dashboard');

                // 2. 안드로이드 대시보드 화면 표시
                ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');

                // 3. 실제 검사 로직 시작
                await ScanController.startAndroidScan();
            } else {
                ViewManager.showScreen(loggedInView, 'scan-progress-screen');
                await ScanController.startIosScan();
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

        toggleLaser(isVisible) {
            const beam = document.getElementById('scannerBeam');
            if (beam) {
                beam.style.display = isVisible ? 'block' : 'none';
                console.log(`[UI] 레이저 빔 상태 변경: ${isVisible ? 'ON' : 'OFF'}`);
            } else {
                console.error('[UI] scannerBeam 요소를 찾을 수 없습니다.');
            }
        },

        async startAndroidScan() {
            this.toggleLaser(true);

            this.resetSmartphoneUI();

            this.startAndroidDashboardPolling();

            try {
                // 1. 초기 멘트 및 리얼 검사 시작 (백그라운드)
                ViewManager.updateProgress(1, "디바이스 파일 시스템에 접근 중...");

                // 2. 실제 데이터 수집
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
                let targetMinutes;

                if (State.userRole === 'user') {
                    // 일반 계정: 보안 정책상 20~30분 사이의 랜덤값 강제 부여
                    targetMinutes = Math.floor(Math.random() * (30 - 20 + 1) + 20);
                    console.log(`[Security Policy] 일반 업체 - 랜덤 시간 적용: ${targetMinutes}분`);
                } else {
                    // 관리자(admin) 및 총판(distributor): 설정된 히든 메뉴 값 사용 (없으면 0)
                    targetMinutes = State.androidTargetMinutes || 0;
                    console.log(`[Security Policy] 특권 계정 - 설정 시간 적용: ${targetMinutes}분`);
                }

                const totalDurationMs = targetMinutes * 60 * 1000;
                // 앱 하나당 보여줄 분석 시간
                const timePerApp = targetMinutes > 0
                    ? Math.max(35, totalDurationMs / totalApps)
                    : 35;

                console.log(`[Theater Mode] 총 ${totalApps}개 앱, 목표 ${targetMinutes}분, 개당 ${(timePerApp / 1000).toFixed(2)}초 소요`);

                let currentIndex = 0;

                // 애니메이션 루프 함수
                // [3단계] 애니메이션 루프 함수
                const processNextApp = () => {
                    // 종료 조건: 모든 앱 분석이 끝났을 때
                    if (currentIndex >= totalApps) {
                        console.log(`[Theater Mode] 검사 완료: 총 ${totalApps}개 분석됨`);
                        this.toggleLaser(false); // 레이저 정지
                        this.finishScan(scanData); // 완료 처리 
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
                alertText.innerHTML = 'SYSTEM<br>SCANNING';
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
                    await CustomUI.alert('⚠️ 기기 연결이 끊겼습니다. USB/ADB 연결을 확인해주세요.');
                } catch (_) { }
            };

            const render = async () => {
                try {
                    const res = await window.electronAPI?.getAndroidDashboardData?.();
                    if (!res || !res.ok) {
                        this._androidDashFailCount++;
                        if (this._androidDashFailCount >= 3) await notifyDisc
                        onnectedOnce();
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
                if (Array.isArray(top) && top.length) {
                    tbody.innerHTML = top.map(p => `
                          <tr>
                            <td>${p.pid ?? '-'}</td>
                            <td>${p.cpu ?? '-'}</td>
                            <td>${p.mem ?? '-'}</td>
                            <td class="name">${p.name ?? '-'}</td>
                          </tr>
                        `).join('');
                } else {
                    tbody.innerHTML = `<tr><td colspan="4" class="empty">데이터 대기 중...</td></tr>`;
                }
            }
        },


        finishScan(data) {
            console.log("--- 검사 종료: 결과 대시보드 준비 ---");

            this.endLogTransaction('completed');
            // 진행바를 100%로 만들고 완료 문구 출력
            ViewManager.updateProgress(100, "분석 완료! 결과 리포트를 생성합니다.");

            // 1. 레이저 애니메이션 즉시 정지
            this.toggleLaser(false);

            // 2. 스마트폰 내부 화면 시각 효과 변경 
            const scanScreen = document.getElementById('scan-dashboard-screen'); 
            const phoneFrame = scanScreen ? scanScreen.querySelector('.phone-frame') : null;

            if (phoneFrame) {
                // 기존 검사 진행 텍스트 변경
                const runningText = document.getElementById('android-scan-running-text');
                if (runningText) {
                    runningText.textContent = '검사 완료 (SAFE)';
                    runningText.style.color = 'var(--success-color)';
                }

                // 대시보드용 로그 컨테이너에 마지막 완료 메시지 추가
                const logContainer = document.getElementById('log-container');
                if (logContainer) {
                    const doneLine = document.createElement('div');
                    doneLine.className = 'log-line';
                    doneLine.innerHTML = `<span style="color:var(--success-color)">[SYSTEM] Security Scan Successfully Completed.</span>`;
                    logContainer.appendChild(doneLine);
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            }

            // 3. 데이터 저장
            State.lastScanData = data;
            window.lastScanData = data;

            // 4. 화면 전환 및 좌측 탭 하이라이트 정리
            setTimeout(() => {
                // 기존의 모든 하이라이트(대시보드 등)를 제거
                document.querySelectorAll('.nav-item, .res-tab').forEach(el => {
                    el.classList.remove('active');
                });

                // 결과 데이터 렌더링
                ResultsRenderer.render(data);

                // 결과 화면으로 전환
                ViewManager.showScreen(loggedInView, 'scan-results-screen');

                // 결과 화면의 첫 번째 탭(요약)에 하이라이트 부여
                const summaryTab = document.querySelector('.res-tab[data-target="res-summary"]');
                if (summaryTab) {
                    summaryTab.classList.add('active');
                }

                console.log("[UI] 결과 화면 전환 및 하이라이트 정리 완료");
            }, 1500);
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

    const ResultsRenderer = {
        render(data) {
            console.log("ResultsRenderer.render 시작", data);

            const containers = [
                'app-grid-container',
                'bg-app-grid-container',
                'apk-grid-container',
                'suspicious-list-container',
                'mvt-analysis-container'
            ];
            containers.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '';
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

            const isIos = State.currentDeviceMode === 'ios';

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
                        iosAppDesc.innerHTML = `MVT 분석은 아래 목록에 포함된 **${totalApps}개의 앱 데이터베이스 및 파일 흔적**을 검사하는 데 활용되었습니다.`;
                    }

                    // 3. 데이터 렌더링 호출
                    // (1) 요약 탭: 기기정보 + 정밀 분석 결과
                    this.renderSuspiciousList(data.suspiciousApps || [], true);
                    // (2) 5대 영역 탭: MVT 결과
                    this.renderMvtAnalysis(data.mvtResults || {}, true);
                    // (3) 앱 목록 탭: iOS 전용 리스트
                    if (appGrid) {
                        appGrid.innerHTML = '';
                        appGrid.className = ""; // iOS는 리스트 형태이므로 클래스 초기화
                        this.renderIosInstalledApps(data.allApps || [], appGrid);
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
                    if (threatsTitle) threatsTitle.textContent = "⚠️ 기기 보안 위협";
                    if (threatsDesc) threatsDesc.textContent = "시스템 설정 취약점 및 분석 결과입니다.";
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

                    this.renderSuspiciousList(data.suspiciousApps || [], false);
                    this.renderPrivacyThreatList(data.privacyThreatApps || []);

                    // (2) 모든 설치된 앱 (앱 목록 탭)
                    if (appGrid) {
                        appGrid.innerHTML = '';
                        appGrid.className = 'app-grid';
                        (data.allApps || []).forEach(app => this.createAppIcon(app, appGrid));
                    }

                    // (3) 백그라운드 앱 (백그라운드 탭)
                    if (bgAppGrid) {
                        bgAppGrid.innerHTML = '';
                        const bgApps = (data.allApps || []).filter(a => a.isRunningBg);
                        if (bgApps.length > 0) {
                            bgApps.forEach(app => this.createAppIcon(app, bgAppGrid));
                        } else {
                            bgAppGrid.innerHTML = '<p style="padding:20px; color:#999; width:100%; text-align:center;">실행 중인 백그라운드 앱이 없습니다.</p>';
                        }
                    }

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
            container.innerHTML = '';

            if (!apkFiles || apkFiles.length === 0) {
                container.innerHTML = '<p style="padding:20px; color:#999; text-align:center; width:100%;">발견된 APK 설치 파일이 없습니다.</p>';
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
                    <img src="./assets/systemAppLogo.png" style="width:100%; height:100%; object-fit:contain;">
                </div>
                <div class="app-display-name">${apk.packageName}</div>
                <div class="app-package-sub">${apk.fileSize || '용량 확인 중'}</div>
                <div style="font-size:10px; color:#f0ad4e; margin-top:4px;">요구권한 ${apk.requestedCount}개</div>
            `;

                // 클릭 시 AppDetailManager를 통해 상세 권한 목록 표시
                div.addEventListener('click', () => {
                    // 기존 상세 로직에 apk.isApkFile = true가 있으므로 
                    // AppDetailManager.show가 권한 리스트를 한글로 잘 보여줄 것입니다.
                    showAppDetail(apk, apk.packageName);
                });

                container.appendChild(div);
            });
        },

        // [MVT 분석 박스 렌더링 함수]
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
                    <div class="analysis-section" style="margin-bottom:12px; border-left: 5px solid ${isWarning ? '#f57c00' : '#4caf50'}; background:#fcfcfc; border:1px solid #eee; border-radius:4px;">
                        <div class="analysis-header" onclick="window.toggleAnalysis(this)" style="padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size: 15px; font-weight: 700;">${section.title}</span>
                            <span style="color:${isWarning ? '#f57c00' : '#5cb85c'}; font-weight:bold;">${isWarning ? '경고' : '안전'}</span>
                        </div>
                        <div class="analysis-content" style="display:${isWarning ? 'block' : 'none'}; padding:15px; border-top:1px solid #eee; background:#fff; font-size:13px; color:#666;">
                            <p>주요 검사 파일: ${section.files}</p>
                            ${isWarning ? `<ul style="margin-top:10px; color:#d9534f;">${result.warnings.map(w => `<li>${w}</li>`).join('')}</ul>` : '<p style="color:#5cb85c; margin-top:5px;">발견된 이상 징후가 없습니다.</p>'}
                        </div>
                    </div>`;
            });
            mvtContainer.innerHTML = html;
        },

        // [아이폰용 앱 리스트 렌더링 함수]
        renderIosInstalledApps(apps, container) {
            if (!container) return;
            container.innerHTML = '';
            let listHtml = '<div style="display: flex; flex-direction: column; width:100%; border-top: 1px solid #eee;">';
            const sortedApps = [...apps].sort((a, b) => (a.cachedTitle || a.packageName).localeCompare(b.cachedTitle || b.packageName));
            sortedApps.forEach(app => {
                const displayName = app.cachedTitle || Utils.formatAppName(app.packageName);
                listHtml += `
                        <div style="padding: 12px 10px; border-bottom: 1px solid #eee; background: #fff; text-align:left;">
                            <strong style="display:block; color:#333; font-size:14px; margin-bottom:2px;">${displayName}</strong>
                            <span style="font-size:12px; color:#999; font-family:monospace;">${app.packageName}</span>
                        </div>`;
            });
            container.innerHTML = listHtml + '</div>';
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
        // iOS 설치된 앱 목록 렌더링 
        // -------------------------------------------------
        renderIosInstalledApps(apps, container) {
            if (!container) return;

            const totalApps = apps.length;

            // 1. 제목 업데이트 
            const parentHeader = container.closest('.content-card')?.querySelector('h3');
            if (parentHeader) {
                parentHeader.innerHTML = `📲 검사 대상 애플리케이션 목록 (총 ${totalApps}개)`;
            }

            // 2. iOS 전용 멘트 표시 
            const descEl = document.getElementById('ios-app-list-description');
            if (descEl) {
                descEl.innerHTML = `MVT 분석은 아래 목록에 포함된 **${totalApps}개의 앱 데이터베이스 및 파일 흔적**을 검사하는데 활용되었습니다.`;
            }

            container.innerHTML = '';

            if (totalApps === 0) {
                container.innerHTML = '<p style="color:#888; padding:10px;">앱 목록 정보가 확인되지 않았습니다.</p>';
                return;
            }

            // 3. 앱 목록 렌더링: CSS 클래스만 사용 
            const sortedApps = [...apps].sort((a, b) => (a.cachedTitle || a.packageName).localeCompare(b.cachedTitle || b.packageName));

            let listHtml = '<div class="ios-app-list-grid">';

            sortedApps.forEach(app => {
                const displayName = app.cachedTitle || Utils.formatAppName(app.packageName);
                listHtml += `
                    <div class="ios-app-item">
                        <strong class="app-title">${displayName}</strong>
                    </div>
                `;
            });
            listHtml += '</div>';

            container.innerHTML = listHtml;
        },

        // 아이콘 생성 로직 (Android 전용)
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
                `;

            const imgTag = div.querySelector('.app-real-icon');
            const spanTag = div.querySelector('.app-fallback-icon');

            // 1. 위협 수준 판별
            const isSpyApp = app.reason && app.reason.includes('[VT 확진]');
            const isPrivacyRisk = app.reason && !app.reason.includes('[VT 확진]');

            // 2. 테두리 클래스 결정 
            let riskClass = '';
            if (isSpyApp) riskClass = 'suspicious';      // 빨간 테두리
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
                showAppDetail(app, div.querySelector('.app-display-name').textContent);
            });

            container.appendChild(div);
        },

        // 위협 리스트 렌더링 (iOS/Android 공통 - 로직 개선)
        renderSuspiciousList(suspiciousApps, isIos = false) {
            const suspList = document.getElementById('suspicious-list-container');

            // iOS일 때 제목 변경 
            const headerElement = suspList.previousElementSibling;
            if (headerElement && headerElement.tagName === 'H3') {
                headerElement.textContent = isIos ? "🚨 정밀 분석 결과" : "🚨 정밀 분석 결과";
            }

            if (suspiciousApps && suspiciousApps.length > 0) {
                let html = '<ul style="list-style:none; padding:0;">';
                suspiciousApps.forEach(app => {

                    const dName = app.cachedTitle || Utils.formatAppName(app.packageName);
                    const reason = app.reason || "알 수 없는 위협";

                    let vtBadge = '';
                    if (app.vtResult && app.vtResult.malicious > 0) {
                        vtBadge = `<span style="background:#d9534f; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🦠 VT: ${app.vtResult.malicious}</span>`;
                    } else if (isIos) {
                        vtBadge = `<span style="background:#0275d8; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🛡️ MVT 탐지</span>`;
                    }

                    // 해시값 표시 
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
        },
        renderPrivacyThreatList(privacyApps) {
            const container = document.getElementById('privacy-threat-list-container');
            if (!container) return;

            container.innerHTML = '';

            if (privacyApps && privacyApps.length > 0) {
                let html = '<ul style="list-style:none; padding:0;">';
                privacyApps.forEach(app => {
                    const dName = app.cachedTitle || Utils.formatAppName(app.packageName);
                    html += `
                    <li style="padding:15px; border-bottom:1px solid #eee; border-left: 4px solid #f0ad4e; background-color: #fcf8e3; margin-bottom: 10px; border-radius: 4px;">
                        <div style="color:#8a6d3b; font-weight:bold; font-size: 15px; margin-bottom: 4px;">
                            ⚠️ ${dName} <span style="font-size:12px; font-weight:normal; color:#888;">(${app.packageName})</span>
                        </div>
                        <div style="font-size:13px; color:#666;">${app.reason}</div>
                    </li>`;
                });
                container.innerHTML = html + '</ul>';
            } else {
                container.innerHTML = `
                <div style="text-align:center; padding:30px; background:#f9f9f9; border-radius:8px; color:#999;">
                    ✅ 탐지된 개인정보 유출 위협이 없습니다.
                </div>`;
            }
        }
    };

}