// renderer.js (오류 수정 완료된 최종본)

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', () => {

    console.log('--- renderer.js: DOM 로드 완료 ---');

    // --- 상태 관리 ---
    let isLoggedIn = false;
    let connectionCheckInterval = null;

    // --- 뷰(View) 참조 ---
    const loggedOutView = document.getElementById('logged-out-view');
    const loggedInView = document.getElementById('logged-in-view');

    // --- 화면 전환 함수 ---
    function showView(viewId) {
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) viewToShow.classList.add('active');
    }

    function showScreen(parentView, screenId) {
        if (!parentView) return;
        parentView.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screenToShow = parentView.querySelector(`#${screenId}`);
        if (screenToShow) screenToShow.classList.add('active');
    }

    // =========================================================
    // 1. 로그인 및 네비게이션
    // =========================================================

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            if (username === 'admin' && password === '1234') {
                showView('logged-in-view');
                showScreen(loggedInView, 'create-scan-screen');
                document.getElementById('nav-create').classList.add('active');
            } else {
                document.getElementById('login-error').textContent = '아이디 또는 비밀번호 불일치';
            }
        });
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('로그아웃 하시겠습니까?')) {
                stopDevicePolling();
                showView('logged-out-view');
                showScreen(document.getElementById('logged-out-view'), 'login-screen');
            }
        });
    }

    function activateMenu(targetId) {
        // 모든 메뉴의 active 클래스 제거
        document.querySelectorAll('#logged-in-view .nav-item').forEach(item => {
            item.classList.remove('active');
        });

        // 클릭한 메뉴에만 active 추가
        const target = document.getElementById(targetId);
        if (target) {
            target.classList.add('active');
            console.log(`메뉴 활성화됨: ${targetId}`); // 확인용 로그
        }
    }

    // 2. [검사생성] 클릭 이벤트
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            activateMenu('nav-create'); // 메뉴 색상 변경
            showScreen(loggedInView, 'create-scan-screen'); // 화면 전환
            stopDevicePolling(); // 폴링 중단
        });
    }

    // 3. [검사열기] 클릭 이벤트 (이 부분이 안 되던 부분)
    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            activateMenu('nav-open'); // 메뉴 색상 변경
            showScreen(loggedInView, 'open-scan-screen'); // 화면 전환
            stopDevicePolling(); // 폴링 중단
        });
    }
    const logoutNavItems = document.querySelectorAll('#logged-out-view .nav-item');

    if (logoutNavItems.length > 0) {
        logoutNavItems.forEach(item => {
            item.addEventListener('click', () => {
                console.log(`클릭됨: ${item.dataset.screen}`); // 클릭 확인용 로그

                // 1. 모든 메뉴 활성화 끄기
                logoutNavItems.forEach(i => i.classList.remove('active'));
                // 2. 클릭한 메뉴 활성화
                item.classList.add('active');

                // 3. 화면 전환 (loggedOutView 변수가 위에서 정의되어 있어야 함)
                const loggedOutView = document.getElementById('logged-out-view');
                if (loggedOutView) {
                    showScreen(loggedOutView, item.dataset.screen);
                } else {
                    console.error("오류: logged-out-view를 찾을 수 없습니다.");
                }
            });
        });
    } else {
        console.error("오류: 로그인 화면의 네비게이션 메뉴(.nav-item)를 찾을 수 없습니다.");
    }

    // =========================================================
    // 2. 검사 생성 -> 기기 연결 -> 검사 시작
    // =========================================================

    const clientInfoForm = document.getElementById('client-info-form');
    const toConnectionScreenBtn = document.getElementById('to-connection-screen-btn');
    const resetClientInfoBtn = document.getElementById('reset-client-info-btn');
    const clientNameInput = document.getElementById('client-name');
    const clientDobInput = document.getElementById('client-dob');
    const clientPhoneInput = document.getElementById('client-phone');

    if (clientInfoForm) {
        resetClientInfoBtn.addEventListener('click', () => {
            clientNameInput.value = '';
            clientDobInput.value = '';
            clientPhoneInput.value = '';
            toConnectionScreenBtn.disabled = true;
        });

        clientInfoForm.addEventListener('input', () => {
            const isFilled = clientNameInput.value && clientDobInput.value && clientPhoneInput.value;
            toConnectionScreenBtn.disabled = !isFilled;
        });

        clientInfoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            showScreen(loggedInView, 'device-connection-screen');
            startDevicePolling();
        });
    }

    // =========================================================
    // 3. 기기 감지 (Polling)
    // =========================================================

    const deviceConnectionScreen = document.getElementById('device-connection-screen');
    const startScanContainer = document.getElementById('start-scan-container');
    const realStartScanBtn = document.getElementById('real-start-scan-btn');
    const backToInfoBtn = document.getElementById('back-to-info-btn');

    function startDevicePolling() {
        if (connectionCheckInterval) clearInterval(connectionCheckInterval);
        checkDevice();
        connectionCheckInterval = setInterval(checkDevice, 1000);
    }

    function stopDevicePolling() {
        if (connectionCheckInterval) clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }

    async function checkDevice() {
        if (!deviceConnectionScreen.classList.contains('active')) {
            stopDevicePolling();
            return;
        }
        try {
            const result = await window.electronAPI.checkDeviceConnection();
            const icon = document.getElementById('connection-status-icon');
            const title = document.getElementById('connection-status-title');
            const desc = document.getElementById('connection-status-desc');

            if (result.status === 'connected') {
                icon.textContent = '✅';
                title.textContent = '기기 연결됨';
                title.style.color = '#5CB85C';
                desc.innerHTML = `모델: <strong>${result.model}</strong>`;
                startScanContainer.style.display = 'block';
            } else if (result.status === 'unauthorized') {
                icon.textContent = '🔒';
                title.textContent = '승인 대기 중';
                title.style.color = '#F0AD4E';
                desc.innerHTML = '휴대폰에서 <strong>USB 디버깅 허용</strong>을 눌러주세요.';
                startScanContainer.style.display = 'none';
            } else {
                icon.textContent = '🔌';
                title.textContent = '기기 연결 필요';
                title.style.color = '#333';
                startScanContainer.style.display = 'none';
            }
        } catch (e) { console.error(e); }
    }

    if (realStartScanBtn) {
        realStartScanBtn.addEventListener('click', async () => {
            stopDevicePolling(); // 검사 중에는 폴링 중단

            // [사이드바 변경 로직 추가]
            // 1. '검사생성' 숨김
            document.getElementById('nav-create').classList.add('hidden');
            // 2. '검사열기' 숨김
            document.getElementById('nav-open').classList.add('hidden');
            // 3. '검사결과' 보이기 및 활성화
            const navResult = document.getElementById('nav-result');
            navResult.classList.remove('hidden');
            navResult.classList.add('active');

            showScreen(loggedInView, 'scan-progress-screen'); // 진행 화면으로 이동
            await startScan(); // 검사 로직 실행
        });
    }

    if (backToInfoBtn) {
        backToInfoBtn.addEventListener('click', () => {
            stopDevicePolling();
            showScreen(loggedInView, 'create-scan-screen');
        });
    }

    // =========================================================
    // 4. 검사 실행 및 결과 렌더링 (여기가 중요합니다!)
    // =========================================================

    async function startScan() {
        const statusBar = document.getElementById('progress-bar');
        const statusText = document.getElementById('scan-status-text');

        statusBar.style.width = '10%';
        statusText.textContent = "분석 시작...";

        try {
            const data = await window.electronAPI.runScan();

            statusBar.style.width = '100%';
            statusText.textContent = "분석 완료!";

            setTimeout(() => {
                renderResults(data);
                showScreen(loggedInView, 'scan-results-screen');
            }, 1000);
        } catch (error) {
            statusText.textContent = "오류 발생: " + error.message;
            statusBar.style.backgroundColor = '#d9534f';
        }
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

    // renderer.js - renderResults 함수 교체

    function renderResults(data) {
        // 화면 초기화 (대시보드 보이기)
        document.getElementById('results-dashboard-view').classList.remove('hidden');
        document.getElementById('app-detail-view').classList.add('hidden');

        // 1. 기기 정보
        document.getElementById('res-model').textContent = data.deviceInfo.model;
        document.getElementById('res-serial').textContent = data.deviceInfo.serial;
        const rootEl = document.getElementById('res-root');
        rootEl.textContent = data.deviceInfo.isRooted ? '⚠️ 발견됨 (ROOTED)' : '✅ 안전함';
        rootEl.style.color = data.deviceInfo.isRooted ? '#D9534F' : '#5CB85C';
        document.getElementById('res-phone').textContent = data.deviceInfo.phoneNumber;

        // 2. 설치된 애플리케이션 그리드 생성
        const grid = document.getElementById('app-grid-container');
        grid.innerHTML = '';

        data.allApps.forEach(app => {
            createAppIcon(app, grid); // (하단 헬퍼 함수 사용)
        });

        // ★★★ [3. 신규 추가] 백그라운드 실행 앱 그리드 생성 ★★★
        const bgGrid = document.getElementById('bg-app-grid-container');
        bgGrid.innerHTML = '';

        // 백그라운드 실행 중(isRunningBg === true)인 앱만 필터링
        const runningApps = data.allApps.filter(app => app.isRunningBg);

        if (runningApps.length === 0) {
            bgGrid.innerHTML = '<p style="color:#888; padding:10px;">백그라운드 실행 앱 없음</p>';
        } else {
            runningApps.forEach(app => {
                createAppIcon(app, bgGrid); // (하단 헬퍼 함수 사용)
            });
        }

        // 4. 파일 리스트
        const apkList = document.getElementById('res-apk-list');
        apkList.innerHTML = data.apkFiles.length ? data.apkFiles.map(f => `<li>${f}</li>`).join('') : '<li>없음</li>';

        // 5. 의심 앱 리스트
        const suspList = document.getElementById('suspicious-list-container');
        suspList.innerHTML = data.suspiciousApps.length
            ? data.suspiciousApps.map(a => {
                const dName = formatAppName(a.packageName);
                const reason = a.reason || "알 수 없는 위협";
                return `
                <li style="padding:15px; border-bottom:1px solid #eee; border-left: 4px solid #D9534F; background-color: #fff5f5; margin-bottom: 10px; border-radius: 4px;">
                    <div style="color:#D9534F; font-weight:bold; font-size: 15px; margin-bottom: 4px;">
                        🚨 ${dName} <span style="font-size:12px; font-weight:normal; color:#888;">(${a.packageName})</span>
                    </div>
                    <div style="font-size:13px; color:#555;">${reason}</div>
                </li>`;
            }).join('')
            : '<p style="color:#5cb85c;">✅ 위협 없음</p>';
    }

    // [Helper] 아이콘 생성 중복 제거를 위한 내부 함수
    function createAppIcon(app, container) {
        const div = document.createElement('div');
        // 의심 앱이면 빨간 테두리, 아니면 일반
        const isSuspicious = app.reason ? true : false;
        div.className = `app-item ${isSuspicious ? 'suspicious' : ''}`;

        const name = formatAppName(app.packageName);
        const iconChar = name.charAt(0);

        div.innerHTML = `
            <div class="app-icon-placeholder">${iconChar}</div>
            <div class="app-display-name">${name}</div>
            <div class="app-package-sub">${app.packageName}</div>
        `;
        // 클릭 시 상세화면 이동
        div.addEventListener('click', () => showAppDetail(app, name));
        container.appendChild(div);
    }

    // =========================================================
    // 5. 상세 화면 및 뒤로가기 (이벤트 리스너가 드디어 연결됩니다)
    // =========================================================

    function showAppDetail(app, displayName) {
        document.getElementById('results-dashboard-view').classList.add('hidden');
        document.getElementById('app-detail-view').classList.remove('hidden');

        document.getElementById('detail-app-name').textContent = displayName;
        document.getElementById('detail-package-name').textContent = app.packageName;

        document.getElementById('detail-sideload').textContent = app.isSideloaded ? '외부 설치' : 'Play Store';
        document.getElementById('detail-bg').textContent = app.isRunningBg ? '실행 중' : '중지됨';

        document.getElementById('detail-req-count').textContent = app.requestedCount || 0;
        document.getElementById('detail-grant-count').textContent = app.grantedCount || 0;

        const list = document.getElementById('detail-permission-list');
        list.innerHTML = '';
        if (app.requestedList) {
            app.requestedList.forEach(perm => {
                const isGranted = app.grantedList.includes(perm);
                const span = document.createElement('span');
                span.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                span.textContent = (isGranted ? '✅ ' : '🚫 ') + perm.replace('android.permission.', '');
                list.appendChild(span);
            });
        }
    }

    // ★★★ 뒤로가기 버튼 ★★★
    const backToDashboardBtn = document.getElementById('back-to-dashboard-btn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            console.log('뒤로가기 클릭됨'); // 확인용 로그
            document.getElementById('app-detail-view').classList.add('hidden');
            document.getElementById('results-dashboard-view').classList.remove('hidden');
        });
    } else {
        console.error("뒤로가기 버튼을 찾을 수 없음");
    }

    // 연결 끊기 버튼
    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => {
            if (confirm('기기 연결을 끊고 초기 화면으로 돌아가시겠습니까?')) {
                // 1. 사이드바 원상복구
                document.getElementById('nav-create').classList.remove('hidden');
                document.getElementById('nav-open').classList.remove('hidden');

                const navResult = document.getElementById('nav-result');
                if (navResult) {
                    navResult.classList.add('hidden');
                    navResult.classList.remove('active');
                }

                // 2. 화면 이동 및 폼 초기화
                showScreen(loggedInView, 'create-scan-screen');

                // (선택사항) 입력 폼 내용 비우기
                const resetBtn = document.getElementById('reset-client-info-btn');
                if (resetBtn) resetBtn.click();
            }
        });
    }

    // 초기화
    showView('logged-out-view');
    showScreen(document.getElementById('logged-out-view'), 'login-screen');
});