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
                window.location.reload();
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

        const icon = document.getElementById('connection-status-icon');
        const title = document.getElementById('connection-status-title');
        const desc = document.getElementById('connection-status-desc');

        // 1. 안드로이드 확인
        try {
            const android = await window.electronAPI.checkDeviceConnection();
            
            if (android.status === 'connected') {
                setConnectedUI('android', android.model);
                
                // 안드로이드 검사 버튼 연결
                realStartScanBtn.onclick = async () => {
                    stopDevicePolling();
                    showScreen(loggedInView, 'scan-progress-screen');
                    await startScan(); // 기존 안드로이드 검사 함수
                };
                return; // 안드로이드 잡혔으면 종료
            } 
            else if (android.status === 'unauthorized') {
                // ... (기존 안드로이드 승인 대기 UI) ...
                return;
            }
        } catch (e) {}

        // 2. iOS 확인 (안드로이드가 없을 때만 실행)
        try {
            const ios = await window.electronAPI.checkIosConnection();
            
            if (ios.status === 'connected') {
                setConnectedUI('ios', ios.model);
                
                // iOS 검사 버튼 연결
                realStartScanBtn.onclick = async () => {
                    stopDevicePolling();
                    showScreen(loggedInView, 'scan-progress-screen');
                    
                    // 진행바 텍스트 변경 (iOS는 오래 걸리므로 안내)
                    const statusText = document.getElementById('scan-status-text');
                    statusText.textContent = "아이폰 백업 및 정밀 분석 중... (시간이 소요됩니다)";
                    
                    // iOS 스캔 실행
                    try {
                        const data = await window.electronAPI.runIosScan(ios.udid);
                        if (data.error) throw new Error(data.error);
                        
                        // iOS 결과 렌더링 (별도 함수 필요하거나 기존 renderResults 개조)
                        // 여기서는 편의상 기존 구조에 맞춰 데이터 변환 후 렌더링
                        renderResults(transformIosData(data));
                        showScreen(loggedInView, 'scan-results-screen');
                    } catch (err) {
                        statusText.textContent = "오류: " + err.message;
                        document.getElementById('progress-bar').style.backgroundColor = '#d9534f';
                    }
                };
                return;
            }
        } catch (e) {}

        // 3. 둘 다 없음
        icon.textContent = '🔌';
        title.textContent = '기기를 연결해주세요';
        desc.innerHTML = "Android 또는 iOS 기기를 USB로 연결하세요.";
        title.style.color = '#333';
        startScanContainer.style.display = 'none';
    }

    // [Helper] 연결 UI 설정 함수
    function setConnectedUI(type, modelName) {
        const icon = document.getElementById('connection-status-icon');
        const title = document.getElementById('connection-status-title');
        const desc = document.getElementById('connection-status-desc');
        
        icon.textContent = type === 'android' ? '✅' : '🍎';
        title.textContent = `${type === 'android' ? 'Android' : 'iPhone'} 연결됨`;
        title.style.color = '#5CB85C';
        desc.innerHTML = `모델: <strong>${modelName}</strong><br>검사를 시작할 수 있습니다.`;
        document.getElementById('start-scan-container').style.display = 'block';
    }

    // [Helper] iOS MVT 데이터를 안드로이드 화면 포맷에 맞게 변환
    function transformIosData(iosData) {
        // MVT 결과를 기존 renderResults가 알아먹을 수 있게 변환
        const suspiciousApps = iosData.suspiciousItems.map(item => {
            return {
                packageName: item.module || item.source_file, // 패키지명 대신 모듈명
                reason: `[MVT 탐지] ${item.message || item.process_name || 'Suspicious Artifact'}`,
                isSideloaded: true // 빨간색 표시를 위해
            };
        });

        // 앱 목록 변환
        const allApps = (iosData.allApps || []).map(app => {
            return {
                packageName: app.bundle_id || 'Unknown',
                isSideloaded: false,
                isRunningBg: false
            };
        });

        return {
            deviceInfo: {
                model: iosData.deviceInfo.model,
                serial: 'iOS-Device',
                isRooted: false, // 탈옥 여부는 별도 체크 필요
                phoneNumber: '-'
            },
            allApps: allApps,
            suspiciousApps: suspiciousApps,
            apkFiles: [] // iOS는 APK 없음
        };
    }

    // async function checkDevice() {
    //     if (!deviceConnectionScreen.classList.contains('active')) {
    //         stopDevicePolling();
    //         return;
    //     }
    //     try {
    //         const result = await window.electronAPI.checkDeviceConnection();
    //         const icon = document.getElementById('connection-status-icon');
    //         const title = document.getElementById('connection-status-title');
    //         const desc = document.getElementById('connection-status-desc');

    //         if (result.status === 'connected') {
    //             icon.textContent = '✅';
    //             title.textContent = '기기 연결됨';
    //             title.style.color = '#5CB85C';
    //             desc.innerHTML = `모델: <strong>${result.model}</strong>`;
    //             startScanContainer.style.display = 'block';
    //         } else if (result.status === 'unauthorized') {
    //             icon.textContent = '🔒';
    //             title.textContent = '승인 대기 중';
    //             title.style.color = '#F0AD4E';
    //             desc.innerHTML = '휴대폰에서 <strong>USB 디버깅 허용</strong>을 눌러주세요.';
    //             startScanContainer.style.display = 'none';
    //         } else {
    //             icon.textContent = '🔌';
    //             title.textContent = '기기 연결 필요';
    //             title.style.color = '#333';
    //             startScanContainer.style.display = 'none';
    //         }
    //     } catch (e) { console.error(e); }
    // }

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

            window.lastScanData = data; // 인쇄를 위해 데이터 백업

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

        // 2. 설치된 애플리케이션 그리드 생성
        const grid = document.getElementById('app-grid-container');
        grid.innerHTML = '';
        
        data.allApps.forEach(app => {
            // ★ 헬퍼 함수를 사용하여 아이콘 로직 적용
            createAppIcon(app, grid);
        });

        // 3. 백그라운드 앱 그리드 생성
        const bgGrid = document.getElementById('bg-app-grid-container');
        if (bgGrid) {
            bgGrid.innerHTML = '';
            const runningApps = data.allApps ? data.allApps.filter(app => app.isRunningBg) : [];
            
            if (runningApps.length === 0) {
                bgGrid.innerHTML = '<p style="color:#888; padding:10px;">백그라운드 실행 앱 없음</p>';
            } else {
                runningApps.forEach(app => {
                    // ★ 헬퍼 함수를 사용하여 아이콘 로직 적용
                    createAppIcon(app, bgGrid);
                });
            }
        }

        // 4. 파일 리스트
        const apkList = document.getElementById('res-apk-list');
        apkList.innerHTML = data.apkFiles.length ? data.apkFiles.map(f => `<li>${f}</li>`).join('') : '<li>없음</li>';

        // 5. 의심 앱 리스트
        const suspList = document.getElementById('suspicious-list-container');
        if (data.suspiciousApps && data.suspiciousApps.length > 0) {
            let html = '<ul style="list-style:none; padding:0;">';
            data.suspiciousApps.forEach(app => {
                const dName = formatAppName(app.packageName);
                const reason = app.reason || "알 수 없는 위협";
                
                // VT 배지
                let vtBadge = '';
                if (app.vtResult && app.vtResult.malicious > 0) {
                    vtBadge = `<span style="background:#d9534f; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🦠 VT: ${app.vtResult.malicious}</span>`;
                }

                html += `
                    <li style="padding:15px; border-bottom:1px solid #eee; border-left: 4px solid #D9534F; background-color: #fff5f5; margin-bottom: 10px; border-radius: 4px;">
                        <div style="color:#D9534F; font-weight:bold; font-size: 15px; margin-bottom: 4px;">
                            🚨 ${dName} ${vtBadge} <span style="font-size:12px; font-weight:normal; color:#888;">(${app.packageName})</span>
                        </div>
                        <div style="font-size:13px; color:#555;">${reason}</div>
                    </li>`;
            });
            html += '</ul>';
            suspList.innerHTML = html;
        } else {
            suspList.innerHTML = '<p style="color:#5CB85C; padding:10px;">✅ 탐지된 위협이 없습니다.</p>';
        }
    }

    // ★★★ [핵심] 아이콘 생성 및 로딩 헬퍼 함수 ★★★
    function createAppIcon(app, container) {
        const div = document.createElement('div');
        const isSuspicious = app.reason ? true : false;
        div.className = `app-item ${isSuspicious ? 'suspicious' : ''}`;
        
        const name = formatAppName(app.packageName);
        
        // 1. HTML 구조: 이미지 태그(숨김) + 이모지 태그(보임)
        div.innerHTML = `
            <div class="app-icon-wrapper">
                <img src="" class="app-real-icon" id="icon-${app.packageName}" 
                     style="display:none;" alt="${name}">
                
                <span class="app-fallback-icon" id="fallback-${app.packageName}"
                      style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:24px;">
                    📱
                </span>
            </div>
            <div class="app-display-name">${name}</div>
            <div class="app-package-sub">${app.packageName}</div>
        `;

        // 2. 비동기 아이콘 요청 (플레이 스토어 검색)
        // 사이드로딩된 앱(시스템 앱, 스파이앱)은 검색해도 안 나오니 요청하지 않음 (속도 향상)
        if (!app.isSideloaded) {
            // main.js의 get-app-icon 핸들러 호출
            console.log("앙 기모띠");
            window.electronAPI.getAppIcon(app.packageName).then(iconUrl => {
                if (iconUrl) {
                    const imgTag = div.querySelector(`#icon-${app.packageName}`);
                    const spanTag = div.querySelector(`#fallback-${app.packageName}`);
                    
                    if (imgTag && spanTag) {
                        imgTag.src = iconUrl; // URL 설정
                        
                        // 이미지가 로딩 완료되면 교체
                        imgTag.onload = () => {
                            imgTag.style.display = 'block';
                            spanTag.style.display = 'none';
                        };
                    }
                }
            }).catch(() => {
                // 실패하면 그냥 📱 아이콘 유지
            });
        }

        // 3. 클릭 이벤트
        div.addEventListener('click', () => showAppDetail(app, name));
        container.appendChild(div);
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

        const uninstallBtn = document.getElementById('uninstall-btn');
        if (uninstallBtn) {
            // 버튼에 현재 보고 있는 앱의 패키지명을 저장해둠
            uninstallBtn.dataset.package = app.packageName;
            uninstallBtn.dataset.appName = displayName; // 이름도 저장 (알림창용)
            
            // 버튼 초기화 (혹시 이전에 '삭제 중...' 상태였을 수 있으므로)
            uninstallBtn.disabled = false;
            uninstallBtn.textContent = "🗑️ 앱 강제 삭제";
        }

        const neutralizeBtn = document.getElementById('neutralize-btn');
        if (neutralizeBtn) {
            neutralizeBtn.dataset.package = app.packageName;
            neutralizeBtn.dataset.appName = displayName;
            neutralizeBtn.disabled = false;
            neutralizeBtn.textContent = "🛡️ 무력화 (권한 박탈)";
        }

        // ★★★ [추가] 데이터 사용량 표시
        const usage = app.dataUsage || { rx: 0, tx: 0 };
        const total = usage.rx + usage.tx;

        const usageText = `총 ${formatBytes(total)}`;
        const usageDetail = `(수신: ${formatBytes(usage.rx)} / 송신: ${formatBytes(usage.tx)})`;

        const netEl = document.getElementById('detail-network');
        netEl.innerHTML = `${usageText}<br><span style="font-size:12px; color:#888; font-weight:normal;">${usageDetail}</span>`;

        // 데이터 사용량이 비정상적으로 많으면(예: 100MB 이상) 빨간색 강조
        if (total > 100 * 1024 * 1024) {
            netEl.style.color = '#333'; // 
        } else {
            netEl.style.color = '#333';
        }

        const list = document.getElementById('detail-permission-list');
        list.innerHTML = '';

        if (app.requestedList && app.requestedList.length > 0) {
            app.requestedList.forEach(perm => {
                const isGranted = app.grantedList.includes(perm);
                const span = document.createElement('span');

                // [적용] 한글 이름으로 변환
                const koreanName = getKoreanPermission(perm);

                span.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                span.textContent = (isGranted ? '✅ ' : '🚫 ') + koreanName;
                list.appendChild(span);
            });
        } else {
            list.innerHTML = '<p style="color:#999; padding:5px;">요청된 권한이 없습니다.</p>';
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
                // ★★★ [추가] ADB 폴링 중단 로직 (안전성 강화) ★★★
                stopDevicePolling();
                // ★★★ [추가 끝] ★★★

                // 1. 사이드바 원상복구
                // ... (생략: 사이드바 복구 로직) ...
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


                window.electronAPI.forceWindowReset(); // 메인 프로세스에 최소화/복원 요청

                // 최소화/복원 트릭이 완료될 시간을 충분히 확보 (100ms 트릭 + 200ms 안정 마진)
            }
        });
    }

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

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
                
                // [수정됨] 클래스 결정 로직
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

            // 7. 인쇄 실행
            setTimeout(() => window.print(), 200);
        });
    }

    // ★★★ 앱 삭제 버튼 클릭 로직 ★★★
    const uninstallBtn = document.getElementById('uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', async () => {
            const packageName = uninstallBtn.dataset.package;
            const appName = uninstallBtn.dataset.appName || packageName;

            if (!packageName) return;

            // 1. 사용자 확인
            const confirmMsg = `[경고] 정말로 '${appName}' 앱을 삭제하시겠습니까?\n\n패키지명: ${packageName}\n\n※ 삭제가 안 될 경우 강제로 작동을 중지시킵니다.`;
            if (!confirm(confirmMsg)) return;

            // 2. 버튼 잠금 (중복 클릭 방지)
            uninstallBtn.disabled = true;
            uninstallBtn.textContent = "처리 중...";

            try {
                // 3. 삭제 요청
                const result = await window.electronAPI.uninstallApp(packageName);

                if (result.success) {
                    // 성공 시 알림
                    alert(result.message);
                    
                    // 4. 목록 화면으로 돌아가기 (새로고침 효과를 위해)
                    document.getElementById('back-to-dashboard-btn').click();
                    
                    // (선택사항) 완벽하게 하려면 여기서 재검사(startScan)를 한 번 돌려주면 좋습니다.
                    // startScan(); 
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                // 실패 시 가이드 제공
                const guideMsg = `삭제 실패: 권한이 부족합니다.\n\n` +
                                 `[해결 방법]\n` +
                                 `1. 휴대폰 설정 > 보안 > 기기 관리자 앱\n` +
                                 `2. '${appName}' 체크 해제 후 다시 시도하세요.`;
                alert(guideMsg);
            } finally {
                // 버튼 복구
                uninstallBtn.disabled = false;
                uninstallBtn.textContent = "🗑️ 앱 강제 삭제";
            }
        });
    }

    const neutralizeBtn = document.getElementById('neutralize-btn');
    if (neutralizeBtn) {
        neutralizeBtn.addEventListener('click', async () => {
            const packageName = neutralizeBtn.dataset.package;
            const appName = neutralizeBtn.dataset.appName;

            if (!packageName) return;

            const confirmMsg = `[주의] '${appName}' 앱을 무력화하시겠습니까?\n\n` +
                               `- 모든 권한(카메라, 마이크 등)을 강제로 회수합니다.\n` +
                               `- 앱을 강제 종료시킵니다.\n` +
                               `\n(증거 보존을 위해 삭제하지 않고 기능만 정지시킬 때 사용합니다.)`;
            
            if (!confirm(confirmMsg)) return;

            neutralizeBtn.disabled = true;
            neutralizeBtn.textContent = "무력화 중...";

            try {
                const result = await window.electronAPI.neutralizeApp(packageName);

                if (result.success) {
                    alert(`✅ 무력화 성공!\n\n총 ${result.count}개의 권한을 박탈하고 앱을 강제 종료했습니다.`);
                    // (선택사항) 권한 상태가 바뀌었으므로 상세화면을 갱신하거나 목록으로 나갑니다.
                    document.getElementById('back-to-dashboard-btn').click();
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                alert(`무력화 실패: ${err.message}`);
            } finally {
                neutralizeBtn.disabled = false;
                neutralizeBtn.textContent = "🛡️ 무력화 (권한 박탈)";
            }
        });
    }

    const PERMISSION_MAP = {
        'CAMERA': '📷 카메라',
        'RECORD_AUDIO': '🎤 마이크 (녹음)',
        'READ_CONTACTS': '📒 연락처 읽기',
        'WRITE_CONTACTS': '📒 연락처 쓰기',
        'ACCESS_FINE_LOCATION': '📍 정밀 위치 (GPS)',
        'ACCESS_COARSE_LOCATION': '📍 대략 위치 (네트워크)',
        'READ_SMS': '✉️ 문자 읽기',
        'SEND_SMS': '✉️ 문자 보내기',
        'RECEIVE_SMS': '✉️ 문자 수신',
        'READ_CALL_LOG': '📞 통화기록 읽기',
        'WRITE_CALL_LOG': '📞 통화기록 쓰기',
        'CALL_PHONE': '📞 전화 걸기',
        'READ_PHONE_STATE': '📱 전화/기기 상태 확인',
        'PROCESS_OUTGOING_CALLS': '📞 발신 전화 가로채기',
        'READ_EXTERNAL_STORAGE': '💾 저장소 읽기',
        'WRITE_EXTERNAL_STORAGE': '💾 저장소 쓰기',
        'MANAGE_EXTERNAL_STORAGE': '💾 모든 파일 관리',
        'READ_MEDIA_IMAGES': '🖼️ 사진/이미지 접근',
        'READ_MEDIA_VIDEO': '🎬 동영상 접근',
        'READ_MEDIA_AUDIO': '🎵 오디오 접근',
        'RECEIVE_BOOT_COMPLETED': '🔌 부팅 시 자동 실행',
        'BIND_DEVICE_ADMIN': '🛡️ 기기 관리자 (삭제 방지)',
        'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS': '🔋 배터리 최적화 무시',
        'BLUETOOTH_SCAN': '🔵 블루투스 스캔',
        'BLUETOOTH_CONNECT': '🔵 블루투스 연결',
        'INTERNET': '🌐 인터넷 사용',
        'SCHEDULE_EXACT_ALARM': '⏰ 정확한 알람 예약',
        'USE_EXACT_ALARM': '⏰ 정확한 알람 사용',
        'SET_ALARM': '⏰ 알람 설정'
    };

    // 2. [신규] 권한 이름을 한글로 변환하는 함수
    function getKoreanPermission(permString) {
        // "android.permission.CAMERA" -> "CAMERA" 로 자름
        const shortName = permString.split('.').pop();

        // 사전에 있으면 한글 반환, 없으면 영어 그대로 반환
        return PERMISSION_MAP[shortName] || shortName;
    }
});