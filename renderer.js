// renderer.js (기기 연결 로직이 포함된 최종 완성본)

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', () => {

    console.log('--- renderer.js: DOM 로드 완료, 스크립트 실행 시작 ---');

    // --- 상태 관리 ---
    let isLoggedIn = false;
    let connectionCheckInterval = null; // [추가] 기기 연결 감지용 타이머 변수

    // --- 뷰(View) 참조 ---
    const loggedOutView = document.getElementById('logged-out-view');
    const loggedInView = document.getElementById('logged-in-view');

    // --- 뷰/화면 전환 함수 ---
    function showView(viewId) {
        console.log(`showView 호출: ${viewId}`);
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.classList.add('active');
        } else {
            console.error(`${viewId} 뷰를 찾을 수 없습니다.`);
        }
    }

    function showScreen(parentView, screenId) {
        console.log(`showScreen 호출: ${screenId}`);
        if (!parentView) {
            console.error('parentView가 null입니다.');
            return;
        }
        parentView.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screenToShow = parentView.querySelector(`#${screenId}`);
        if (screenToShow) {
            screenToShow.classList.add('active');
        } else {
            console.error(`${screenId} 스크린을 찾을 수 없습니다.`);
        }
    }

    // --- 이벤트 리스너 ---

    // [로그아웃 뷰] 네비게이션
    document.querySelectorAll('#logged-out-view .nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('#logged-out-view .nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            showScreen(loggedOutView, item.dataset.screen);
        });
    });

    // 로그인 처리
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const loginError = document.getElementById('login-error');

            if (username === 'admin' && password === '1234') { // MVP 하드코딩
                console.log('로그인 성공');
                loginError.textContent = '';
                isLoggedIn = true;
                showView('logged-in-view');
                showScreen(loggedInView, 'create-scan-screen');
                document.getElementById('nav-create').classList.add('active');
                document.getElementById('nav-open').classList.remove('active');
            } else {
                loginError.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
            }
        });
    }

    // [로그인 뷰] 네비게이션
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            document.querySelectorAll('#logged-in-view .nav-item').forEach(i => i.classList.remove('active'));
            navCreate.classList.add('active');
            showScreen(loggedInView, 'create-scan-screen');
            stopDevicePolling(); // 화면 이동 시 폴링 중단
        });
    }

    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            document.querySelectorAll('#logged-in-view .nav-item').forEach(i => i.classList.remove('active'));
            navOpen.classList.add('active');
            showScreen(loggedInView, 'open-scan-screen');
            stopDevicePolling(); // 화면 이동 시 폴링 중단
        });
    }

    // 로그아웃
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('정말 로그아웃을 하시겠습니까?')) {
                isLoggedIn = false;
                stopDevicePolling(); // 로그아웃 시 폴링 중단
                showView('logged-out-view');
                showScreen(loggedOutView, 'login-screen');
                document.getElementById('nav-login').classList.add('active');
                document.getElementById('nav-support').classList.remove('active');
            }
        });
    }

    // 검사자 정보 입력 후 다음

    // =================================================================
    // [수정됨] 검사 생성 -> 기기 연결 -> 검사 시작 로직 (핵심 변경 구간)
    // =================================================================

    const clientInfoForm = document.getElementById('client-info-form');
    // HTML에서 버튼 ID가 변경되었습니다: start-scan-setup-btn -> to-connection-screen-btn
    const toConnectionScreenBtn = document.getElementById('to-connection-screen-btn');
    const resetClientInfoBtn = document.getElementById('reset-client-info-btn');
    
    // 입력 필드
    const clientNameInput = document.getElementById('client-name');
    const clientDobInput = document.getElementById('client-dob');
    const clientPhoneInput = document.getElementById('client-phone');

    // [신규] 기기 연결 화면 요소 참조
    const deviceConnectionScreen = document.getElementById('device-connection-screen');
    const connectionStatusIcon = document.getElementById('connection-status-icon');
    const connectionStatusTitle = document.getElementById('connection-status-title');
    const connectionStatusDesc = document.getElementById('connection-status-desc');
    const startScanContainer = document.getElementById('start-scan-container');
    const realStartScanBtn = document.getElementById('real-start-scan-btn');
    const backToInfoBtn = document.getElementById('back-to-info-btn');

    if (clientInfoForm) {
        
        // 1. 정보 초기화 버튼
        resetClientInfoBtn.addEventListener('click', () => {
            console.log('검사자 정보 초기화');
            clientNameInput.value = '';
            clientDobInput.value = '';
            clientPhoneInput.value = '';
            if (toConnectionScreenBtn) toConnectionScreenBtn.disabled = true;
        });

        // 2. 입력 감지 (다음 단계 버튼 활성화)
        clientInfoForm.addEventListener('input', () => {
            const name = clientNameInput.value;
            const dob = clientDobInput.value;
            const phone = clientPhoneInput.value;
            if (toConnectionScreenBtn) toConnectionScreenBtn.disabled = !(name && dob && phone);
        });

        // 3. "다음 단계" 클릭 -> 기기 연결 화면으로 이동
        clientInfoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log("정보 입력 완료. 기기 연결 화면으로 이동.");
            
            showScreen(loggedInView, 'device-connection-screen');
            startDevicePolling(); // [중요] 기기 감지 시작
        });
    }

    // --- [신규 기능] 기기 감지 로직 ---

    function startDevicePolling() {
        if (connectionCheckInterval) clearInterval(connectionCheckInterval); // 기존 타이머 제거
        checkDevice(); // 즉시 실행
        connectionCheckInterval = setInterval(checkDevice, 1000); // 1초마다 실행
        console.log("기기 감지 시작됨 (Polling)");
    }

    function stopDevicePolling() {
        if (connectionCheckInterval) {
            clearInterval(connectionCheckInterval);
            connectionCheckInterval = null;
            console.log("기기 감지 중단됨");
        }
    }

    async function checkDevice() {
        // 현재 화면이 연결 화면이 아니면 폴링 중지
        console.log("checkDevice func")
        if (!deviceConnectionScreen.classList.contains('active')) {
            stopDevicePolling();
            return;
        }

        try {
            const result = await window.electronAPI.checkDeviceConnection();
            
            // 상태에 따른 UI 처리
            if (result.status === 'connected') {
                // [1. 연결 성공]
                connectionStatusIcon.textContent = '✅';
                connectionStatusTitle.textContent = '기기가 연결되었습니다!';
                connectionStatusDesc.innerHTML = `모델명: <strong>${result.model}</strong><br>검사를 시작할 수 있습니다.`;
                connectionStatusTitle.style.color = '#5CB85C'; // 초록색
                startScanContainer.style.display = 'block'; // 버튼 보이기

            } else if (result.status === 'unauthorized') {
                // [2. 승인 대기 중 (팝업 뜬 상태)]
                connectionStatusIcon.textContent = '🔒'; // 자물쇠 아이콘
                connectionStatusTitle.textContent = '승인 대기 중...';
                connectionStatusDesc.innerHTML = `휴대폰 화면을 켜고<br><strong>"USB 디버깅 허용"</strong> 버튼을 눌러주세요!`;
                connectionStatusTitle.style.color = '#F0AD4E'; // 주황색
                startScanContainer.style.display = 'none';

            } else {
                // [3. 연결 안 됨 (disconnected, offline, error)]
                connectionStatusIcon.textContent = '🔌';
                connectionStatusTitle.textContent = '기기를 연결해주세요';
                connectionStatusDesc.innerHTML = "Android 기기를 USB 케이블로 연결하고<br>화면에서 <strong>'USB 디버깅 허용'</strong>을 눌러주세요.";
                connectionStatusTitle.style.color = '#333';
                startScanContainer.style.display = 'none';
            }

        } catch (err) {
            console.error("기기 확인 중 오류:", err);
        }
    }

    // 4. "검사 시작하기" 버튼 (진짜 검사 시작)
    if (realStartScanBtn) {
        realStartScanBtn.addEventListener('click', async () => {
            console.log("실제 검사 시작 버튼 클릭됨");
            stopDevicePolling(); // 검사 중에는 폴링 중단
            
            showScreen(loggedInView, 'scan-progress-screen'); // 진행 화면으로 이동
            await startScan(); // 검사 로직 실행
        });
    }

    // 5. "뒤로 가기" 버튼
    if (backToInfoBtn) {
        backToInfoBtn.addEventListener('click', () => {
            stopDevicePolling();
            showScreen(loggedInView, 'create-scan-screen');
        });
    }

    // =================================================================

    // 검사 열기 버튼
    const selectFileBtn = document.getElementById('select-file-btn');
    if (selectFileBtn) {
        selectFileBtn.addEventListener('click', async () => {
            if (window.electronAPI && window.electronAPI.openScanFile) {
                const resultData = await window.electronAPI.openScanFile(); 
                if (resultData) {
                    renderResults(resultData);
                    showScreen(loggedInView, 'scan-results-screen');
                }
            }
        });
    }

    // 결과 출력 버튼
    const printResultsBtn = document.getElementById('print-results-btn');
    if (printResultsBtn) {
        printResultsBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // --- 기능 함수 (검사 실행 및 렌더링) ---
    async function startScan() {
        const statusBar = document.getElementById('progress-bar');
        const statusText = document.getElementById('scan-status-text');
        
        statusBar.style.width = '0%';
        statusText.textContent = "검사 초기화 중...";

        try {
            // 1단계: 시각적 피드백
            statusBar.style.width = '10%';
            statusText.textContent = "ADB/iOS 기기 스캔 중...";

            // 2단계: 실제 스캔 호출
            if (!window.electronAPI || !window.electronAPI.runScan) {
                throw new Error('electronAPI.runScan이 정의되지 않았습니다.');
            }
            const scanResultData = await window.electronAPI.runScan();

            // 3단계: 완료 처리
            statusBar.style.width = '100%';
            statusText.textContent = "검사 완료!";

            // 4단계: 결과 화면 이동
            setTimeout(() => {
                renderResults(scanResultData);
                showScreen(loggedInView, 'scan-results-screen');
            }, 1000);

        } catch (error) {
            console.error('스캔 중 오류 발생:', error);
            statusText.textContent = `스캔 실패: ${error.message}`;
            statusBar.style.backgroundColor = '#D9534F';
        }
    }

    function formatAppName(packageName) {
        if (!packageName) return "Unknown";
        const parts = packageName.split('.');
        // 마지막 단어를 가져옴 (예: com.kakao.talk -> talk)
        let name = parts[parts.length - 1];
        
        // "android"나 "app" 처럼 너무 일반적인 단어면 그 앞 단어 사용
        if ((name === 'android' || name === 'app') && parts.length > 1) {
            name = parts[parts.length - 2];
        }
        
        // 첫 글자 대문자로 (talk -> Talk)
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    function renderResults(data) {
        // 1. 기기 정보 바인딩
        document.getElementById('res-model').textContent = data.deviceInfo.model;
        document.getElementById('res-serial').textContent = data.deviceInfo.serial;
        
        const rootEl = document.getElementById('res-root');
        rootEl.textContent = data.deviceInfo.isRooted ? '⚠️ 발견됨 (ROOTED)' : '✅ 안전함';
        rootEl.style.color = data.deviceInfo.isRooted ? '#D9534F' : '#5CB85C';
        
        document.getElementById('res-phone').textContent = data.deviceInfo.phoneNumber;

        // 2. 앱 그리드 (설치된 어플들) - 순서 변경됨 (2순위)
        const gridContainer = document.getElementById('app-grid-container');
        gridContainer.innerHTML = ''; 

        data.allApps.forEach(app => {
            const appDiv = document.createElement('div');
            appDiv.className = `app-item ${app.isSideloaded || app.isRunningBg ? 'suspicious' : ''}`;
            
            // 앱 이름 가공 (패키지명 -> 이름)
            const displayName = formatAppName(app.packageName);
            const iconChar = displayName.charAt(0);
            
            appDiv.innerHTML = `
                <div class="app-icon-placeholder">${iconChar}</div>
                <div class="app-display-name">${displayName}</div>
                <div class="app-package-sub">${app.packageName}</div>
            `;

            appDiv.addEventListener('click', () => {
                showAppDetail(app, displayName); // displayName도 전달
            });

            gridContainer.appendChild(appDiv);
        });

        // 3. APK 파일 리스트
        const apkList = document.getElementById('res-apk-list');
        if (data.apkFiles.length === 0) {
            apkList.innerHTML = '<li style="color:#aaa;">발견된 파일 없음</li>';
        } else {
            apkList.innerHTML = data.apkFiles.map(f => `<li>${f}</li>`).join('');
        }

        // 4. 위협 탐지 요약
        const suspContainer = document.getElementById('suspicious-list-container');
        if (data.suspiciousApps.length === 0) {
            suspContainer.innerHTML = '<p style="color:#5CB85C; padding:10px;">✅ 탐지된 위협이 없습니다.</p>';
        } else {
            let html = '<ul style="list-style:none; padding:0;">';
            data.suspiciousApps.forEach(app => {
                const dName = formatAppName(app.packageName);
                html += `
                    <li style="padding:10px; border-bottom:1px solid #eee; color:#D9534F;">
                        <strong>🚨 ${dName}</strong> (${app.packageName})
                        <br>
                        <span style="font-size:12px; color:#666;">
                            이유: ${app.isSideloaded ? '사이드로딩' : ''} ${app.isRunningBg ? '백그라운드 실행' : ''} ${app.allPermissionsGranted ? '모든 권한 허용' : ''}
                        </span>
                    </li>`;
            });
            html += '</ul>';
            suspContainer.innerHTML = html;
        }
    }
        // 4. [핵심] 앱 그리드 생성 및 클릭 이벤트 연결
        const gridContainer = document.getElementById('app-grid-container');
        gridContainer.innerHTML = ''; // 초기화

        // 모든 앱을 순회하며 아이콘 생성
        data.allApps.forEach(app => {
            const appDiv = document.createElement('div');
            appDiv.className = `app-item ${app.isSideloaded || app.isRunningBg ? 'suspicious' : ''}`;
            
            // 아이콘 (실제 아이콘 추출은 느리므로, 글자로 대체하거나 기본 아이콘 사용)
            // 'suspicious' 클래스가 있으면 빨간색, 아니면 기본색
            const iconChar = app.packageName.charAt(0).toUpperCase();
            
            appDiv.innerHTML = `
                <div class="app-icon-placeholder">${iconChar}</div>
                <div class="app-name">${app.packageName}</div>
            `;

            // 클릭 시 상세 화면으로 이동
            appDiv.addEventListener('click', () => {
                showAppDetail(app);
            });

            gridContainer.appendChild(appDiv);
        });
    

    // [New] 앱 상세 정보 보여주기 함수
    function showAppDetail(app, displayName) {
        const dashboard = document.getElementById('results-dashboard-view');
        const detailView = document.getElementById('app-detail-view');
        
        // 헤더 정보
        document.getElementById('detail-app-name').textContent = displayName;
        document.getElementById('detail-package-name').textContent = app.packageName;
        
        // 상태 정보
        const sideEl = document.getElementById('detail-sideload');
        sideEl.textContent = app.isSideloaded ? '외부 설치 (위험)' : 'Play Store';
        sideEl.className = `d-value ${app.isSideloaded ? 'status-danger' : 'status-safe'}`;

        const bgEl = document.getElementById('detail-bg');
        bgEl.textContent = app.isRunningBg ? '실행 중' : '중지됨';
        bgEl.className = `d-value ${app.isRunningBg ? 'status-danger' : 'status-safe'}`;

        const permEl = document.getElementById('detail-perm-status');
        permEl.textContent = app.allPermissionsGranted ? '모두 허용됨 (주의)' : '제한적 허용';
        permEl.className = `d-value ${app.allPermissionsGranted ? 'status-danger' : 'status-safe'}`;

        document.getElementById('detail-req-count').textContent = app.requestedCount;
        document.getElementById('detail-grant-count').textContent = app.grantedCount;

        // ★★★ [핵심] 권한 상세 리스트 렌더링 ★★★
        const permListContainer = document.getElementById('detail-permission-list');
        permListContainer.innerHTML = ''; // 초기화

        if (app.requestedList && app.requestedList.length > 0) {
            // 요청된 모든 권한을 순회
            app.requestedList.forEach(perm => {
                // 해당 권한이 grantedList에 있는지 확인
                const isGranted = app.grantedList.includes(perm);
                
                const span = document.createElement('span');
                // android.permission.CAMERA -> CAMERA (보기 좋게 자름)
                const shortName = perm.replace('android.permission.', '');
                
                span.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                span.textContent = `${isGranted ? '✅' : '🚫'} ${shortName}`;
                
                permListContainer.appendChild(span);
            });
        } else {
            permListContainer.innerHTML = '<p style="color:#999;">요청된 권한이 없습니다.</p>';
        }

        // 화면 전환
        dashboard.classList.add('hidden');
        detailView.classList.remove('hidden');
    }

    // [New] 뒤로가기 버튼 로직
    const backBtn = document.getElementById('back-to-dashboard-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('results-dashboard-view').classList.remove('hidden');
            document.getElementById('app-detail-view').classList.add('hidden');
        });
    }

    // [New] 새 검사 버튼 로직
    const newScanBtn = document.getElementById('new-scan-btn');
    if (newScanBtn) {
        newScanBtn.addEventListener('click', () => {
             showScreen(loggedInView, 'create-scan-screen');
        });
    }

    // --- 초기화 ---
    console.log('--- renderer.js: 스크립트 초기화 완료. 로그인 화면 표시 ---');
    showView('logged-out-view');
    showScreen(loggedOutView, 'login-screen');

});