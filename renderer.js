// renderer.js
// BD (Big Dream) Security Solution - Renderer Process
import { auth, db } from './firebaseConfig.js';
import { signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', () => {
    console.log('--- renderer.js: DOM 로드 완료 ---');

    const ID_DOMAIN = "@bd.com";
    // =========================================================
    // [1] 상태 관리 (STATE MANAGEMENT)
    // =========================================================
    const State = {
        isLoggedIn: false,
        connectionCheckInterval: null,
        currentDeviceMode: null, // 'android' or 'ios'
        currentUdid: null,       // iOS UDID
        lastScanData: null,       // 인쇄용 데이터 백업
        androidTargetMinutes: 0 // 기본값 0 (즉시 완료), 히든 메뉴로 변경 가능
    };

    // =========================================================
    // [2] 뷰 관리자 (VIEW MANAGER)
    // =========================================================
    const ViewManager = {
        // 큰 뷰 전환 (로그인 전/후)
        showView(viewId) {
            document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
            const viewToShow = document.getElementById(viewId);
            if (viewToShow) viewToShow.classList.add('active');
        },

        // 내부 스크린 전환 (로그인 후 콘텐츠)
        showScreen(parentView, screenId) {
            if (!parentView) return;
            parentView.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            const screenToShow = parentView.querySelector(`#${screenId}`);
            if (screenToShow) screenToShow.classList.add('active');
        },

        // 사이드바 메뉴 활성화
        activateMenu(targetId) {
            document.querySelectorAll('#logged-in-view .nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const target = document.getElementById(targetId);
            if (target) {
                target.classList.add('active');
                console.log(`메뉴 활성화됨: ${targetId}`);
            }
        },

        // 진행바 업데이트
        updateProgress(percent, text) {
            const statusBar = document.getElementById('progress-bar');
            const statusText = document.getElementById('scan-status-text');
            if (statusBar) statusBar.style.width = `${percent}%`;
            if (statusText) statusText.textContent = text;
            if (statusBar) statusBar.style.backgroundColor = '#5CB85C'; // 초기화
        }
    };

    // DOM 참조 캐싱 (자주 쓰는 뷰)
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');


    // =========================================================
    // [3] 인증 및 설정 불러오기 (AUTH & SETTINGS)
    // =========================================================

    //사용자 권한 확인 함수
    async function checkUserRole(uid) {
        try {
            const userDocRef = doc(db, "users", uid);
            const userSnap = await getDoc(userDocRef);

            if (userSnap.exists()) {
                const userData = userSnap.data();

                if (userData.isLocked) {
                    throw new Error("LOCKED_ACCOUNT"); // 에러 발생시킴
                }

                return userData.role || 'user'; // role이 없으면 기본 'user'
            } else {
                // 문서가 없으면(최초 로그인 등) 기본 user로 생성 (선택사항)
                // 보안을 위해 여기서는 그냥 'user' 리턴
                return 'user';
            }
        } catch (e) {
            console.error("권한 확인 실패:", e);
            return 'user'; // 에러 나면 안전하게 일반 유저로
        }
    }

    //  Firestore에서 시간 설정 가져오기 함수
    async function fetchScanSettings() {
        try {
            console.log("📥 서버에서 설정값 불러오는 중...");
            const docRef = doc(db, "settings", "config"); // settings 컬렉션의 config 문서
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                // DB 필드명: android_scan_duration
                State.androidTargetMinutes = data.android_scan_duration || 0;
                console.log(`✅ 설정 로드 완료: ${State.androidTargetMinutes}분`);
            } else {
                console.log("⚠️ 설정 문서가 존재하지 않음 (기본값 0분 사용)");
                State.androidTargetMinutes = 0;
            }
        } catch (error) {
            console.error("❌ 설정 불러오기 실패:", error);
            // 실패해도 앱은 작동해야 하므로 기본값 유지
        }
    }
    // 로그인 처리
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const inputId = document.getElementById('username').value.trim();
            const email = inputId + ID_DOMAIN;
            const password = document.getElementById('password').value;
            const errorMsg = document.getElementById('login-error');

            errorMsg.textContent = "로그인 중...";

            try {
                // 1. Firebase 로그인
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 2. 권한 확인 (DB 조회)
                const role = await checkUserRole(user.uid);
                console.log(`로그인 성공! UID: ${user.uid}, Role: ${role}`);

                // 3. 설정값 불러오기
                await fetchScanSettings();

                // 4. 화면 전환 분기 처리
                State.isLoggedIn = true;
                State.userRole = role; // 상태에 저장

                if (role === 'admin') {
                    // ★ 관리자라면 관리자 전용 화면으로 (또는 일반화면에 관리자 기능 추가)
                    ViewManager.showView('logged-in-view');
                    ViewManager.showScreen(loggedInView, 'create-scan-screen'); // 일단 메인으로 가되
                    
                    // [관리자 전용 UI 활성화 예시]
                    document.body.classList.add('is-admin'); // CSS로 관리자 버튼 보이게 처리 가능
                    alert(`관리자 계정(${email})으로 접속했습니다.`);
                    
                    setTimeout(() => {
                        console.log("⏳ 관리자 메뉴 생성 시도...");
                        AdminManager.init();
                    }, 500);
                } else {
                    // ★ 일반 사용자
                    ViewManager.showView('logged-in-view');
                    ViewManager.showScreen(loggedInView, 'create-scan-screen');
                    document.body.classList.remove('is-admin');
                }
                
                document.getElementById('nav-create').classList.add('active');
                errorMsg.textContent = "";

            } catch (error) {
                console.error(error);
                if (error.message === "LOCKED_ACCOUNT") {
                    errorMsg.textContent = "🚫 관리자에 의해 이용이 정지된 계정입니다.";
                    await signOut(auth); // 강제 로그아웃
                    return;
                }
                if (error.code === 'auth/invalid-credential') {
                    errorMsg.textContent = "이메일 또는 비밀번호가 잘못되었습니다.";
                } else {
                    errorMsg.textContent = "로그인 오류: " + error.code;
                }
            }
        });
    }

    // 로그아웃 처리
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm('로그아웃 하시겠습니까?')) {
                try {
                    await signOut(auth);
                    DeviceManager.stopPolling();
                    State.isLoggedIn = false;
                    State.androidTargetMinutes = 0; // 설정값 초기화
                    
                    ViewManager.showView('logged-out-view');
                    ViewManager.showScreen(loggedOutView, 'login-screen');
                    window.location.reload();
                } catch (error) {
                    alert("로그아웃 실패: " + error.message);
                }
            }
        });
    }

    // 사이드바: 검사 생성
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            ViewManager.activateMenu('nav-create');
            ViewManager.showScreen(loggedInView, 'create-scan-screen');
            DeviceManager.stopPolling();
        });
    }

    // 사이드바: 검사 열기
    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            ViewManager.activateMenu('nav-open');
            ViewManager.showScreen(loggedInView, 'open-scan-screen');
            DeviceManager.stopPolling();
        });
    }

    // =========================================================
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

    if (clientInfoForm) {
        // 입력 감지 (버튼 활성화)
        clientInfoForm.addEventListener('input', () => {
            const isFilled = clientInputs.name.value && clientInputs.dob.value && clientInputs.phone.value;
            toConnectionScreenBtn.disabled = !isFilled;
        });

        // 초기화 버튼
        document.getElementById('reset-client-info-btn').addEventListener('click', () => {
            Object.values(clientInputs).forEach(input => input.value = '');
            toConnectionScreenBtn.disabled = true;
        });

        // 폼 제출 -> 연결 화면 이동
        clientInfoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            ViewManager.showScreen(loggedInView, 'device-connection-screen');
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
        disconnectBtn.addEventListener('click', () => {
            if (confirm('기기 연결을 끊고 초기 화면으로 돌아가시겠습니까?')) {
                // UI 초기화
                document.getElementById('nav-create').classList.remove('hidden');
                document.getElementById('nav-open').classList.remove('hidden');
                const navResult = document.getElementById('nav-result');
                if (navResult) {
                    navResult.classList.add('hidden');
                    navResult.classList.remove('active');
                }

                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'create-scan-screen');

                // 폼 리셋 및 윈도우 리프레시 효과
                const resetBtn = document.getElementById('reset-client-info-btn');
                if (resetBtn) resetBtn.click();
                window.electronAPI.forceWindowReset();
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
            if (!screen.classList.contains('active')) {
                this.stopPolling();
                return;
            }

            const ui = {
                icon: document.getElementById('connection-status-icon'),
                title: document.getElementById('connection-status-title'),
                desc: document.getElementById('connection-status-desc')
            };

            // 1. Android 확인
            try {
                const android = await window.electronAPI.checkDeviceConnection();
                if (android.status === 'connected') {
                    State.currentDeviceMode = 'android';
                    this.setUI(ui, '✅', 'Android 연결됨', android.model, '#5CB85C');
                    return;
                } else if (android.status === 'unauthorized') {
                    State.currentDeviceMode = null;
                    this.setUI(ui, '🔒', '승인 대기 중', '휴대폰에서 USB 디버깅을 허용해주세요.', '#F0AD4E', false);
                    return;
                }
            } catch (e) { }

            // 2. iOS 확인
            try {
                const ios = await window.electronAPI.checkIosConnection();
                if (ios.status === 'connected') {
                    State.currentDeviceMode = 'ios';
                    State.currentUdid = ios.udid;
                    this.setUI(ui, '🍎', 'iPhone 연결됨', ios.model, '#5CB85C');
                    return;
                }
            } catch (e) { }

            // 3. 연결 없음
            State.currentDeviceMode = null;
            this.setUI(ui, '🔌', '기기를 연결해주세요', 'Android 또는 iOS 기기를 USB로 연결하세요.', '#333', false);
        },

        setUI(ui, iconText, titleText, descText, color, showBtn = true) {
            ui.icon.textContent = iconText;
            ui.title.textContent = titleText;
            ui.title.style.color = color;
            ui.desc.innerHTML = descText.includes('연결') || descText.includes('허용') ? descText : `모델: <strong>${descText}</strong>`;

            const btnContainer = document.getElementById('start-scan-container');
            btnContainer.style.display = showBtn ? 'block' : 'none';

            // 잔상 방지 리셋
            if (showBtn && !btnContainer.dataset.visible) {
                window.electronAPI.forceWindowReset();
                btnContainer.dataset.visible = "true";
            }
        }
    };

    // =========================================================
    // [6] 검사 실행 (SCAN CONTROLLER)
    // =========================================================

    // 검사 시작 버튼 클릭
    const realStartScanBtn = document.getElementById('real-start-scan-btn');
    if (realStartScanBtn) {
        realStartScanBtn.addEventListener('click', async () => {
            DeviceManager.stopPolling();

            // 사이드바 UI 변경
            document.getElementById('nav-create').classList.add('hidden');
            document.getElementById('nav-open').classList.add('hidden');
            const navResult = document.getElementById('nav-result');
            navResult.classList.remove('hidden');
            navResult.classList.add('active');

            ViewManager.showScreen(loggedInView, 'scan-progress-screen');

            // 모드별 검사 시작
            if (State.currentDeviceMode === 'android') {
                await ScanController.startAndroidScan();
            } else if (State.currentDeviceMode === 'ios') {
                await ScanController.startIosScan();
            } else {
                alert("연결된 기기가 없습니다.");
                DeviceManager.stopPolling();
                ViewManager.showScreen(loggedInView, 'device-connection-screen');
            }
        });
    }

    const ScanController = {
        async startAndroidScan() {
            ViewManager.updateProgress(10, "안드로이드 정밀 분석 시작...");
            try {
                const data = await window.electronAPI.runScan();
                this.finishScan(data);
            } catch (error) {
                this.handleError(error);
            }
        },

        async startIosScan() {
            ViewManager.updateProgress(5, "아이폰 백업 준비 중... (시간이 소요됩니다)");
            try {
                const rawData = await window.electronAPI.runIosScan(State.currentUdid);
                if (rawData.error) throw new Error(rawData.error);

                // 데이터 변환 (iOS -> Android 포맷)
                const data = Utils.transformIosData(rawData);
                this.finishScan(data);
            } catch (error) {
                this.handleError(error);
            }
        },

        finishScan(data) {
            ViewManager.updateProgress(100, "분석 완료!");
            State.lastScanData = data; // 인쇄용 저장
            window.lastScanData = data;

            setTimeout(() => {
                ResultsRenderer.render(data);
                ViewManager.showScreen(loggedInView, 'scan-results-screen');
            }, 1000);
        },

        handleError(error) {
            console.error(error);
            const statusText = document.getElementById('scan-status-text');
            const statusBar = document.getElementById('progress-bar');
            statusText.textContent = "오류: " + error.message;
            statusBar.style.backgroundColor = '#d9534f';
        }
    };

    // =========================================================
    // [7] 결과 렌더링 (RESULTS RENDERER)
    // =========================================================
    const ResultsRenderer = {
        render(data) {
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

            // 2. 앱 그리드 (전체)
            const grid = document.getElementById('app-grid-container');
            grid.innerHTML = '';
            data.allApps.forEach(app => this.createAppIcon(app, grid));

            // 3. 백그라운드 앱 그리드
            const bgGrid = document.getElementById('bg-app-grid-container');
            if (bgGrid) {
                bgGrid.innerHTML = '';
                const runningApps = data.allApps ? data.allApps.filter(app => app.isRunningBg) : [];
                if (runningApps.length === 0) bgGrid.innerHTML = '<p style="color:#888; padding:10px;">백그라운드 실행 앱 없음</p>';
                else runningApps.forEach(app => this.createAppIcon(app, bgGrid));
            }

            // 4. 파일 리스트
            const apkList = document.getElementById('res-apk-list');
            apkList.innerHTML = data.apkFiles.length ? data.apkFiles.map(f => `<li>${f}</li>`).join('') : '<li>없음</li>';

            // 5. 의심 앱 리스트
            this.renderSuspiciousList(data.suspiciousApps);
        },

        // 아이콘 생성 로직 (이미지 로딩 + 폴백)
        createAppIcon(app, container) {
            const div = document.createElement('div');
            const isSuspicious = app.reason ? true : false;
            div.className = `app-item ${isSuspicious ? 'suspicious' : ''}`;

            // 초기 이름 설정 (캐시된 것 우선, 없으면 포맷팅된 이름)
            const initialName = app.cachedTitle || Utils.formatAppName(app.packageName);

            div.innerHTML = `
        <div class="app-icon-wrapper">
            <img src="" class="app-real-icon" style="display:none;" alt="${initialName}">
            <span class="app-fallback-icon" style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:24px;">📱</span>
        </div>
        <div class="app-display-name">${initialName}</div>
        <div class="app-package-sub">${app.packageName}</div>
    `;

            // 1. [캐시 확인] 이미 정보가 있는 경우
            if (app.cachedIconUrl) {
                const imgTag = div.querySelector('.app-real-icon');
                const spanTag = div.querySelector('.app-fallback-icon');
                imgTag.src = app.cachedIconUrl;
                imgTag.style.display = 'block';
                spanTag.style.display = 'none';
            }

            // 2. [API 요청] 정보가 부족하고 외부 앱이 아니면 요청
            // (캐시된 아이콘이 없거나, 캐시된 타이틀이 없으면 시도해볼 가치가 있음)
            if ((!app.cachedIconUrl || !app.cachedTitle)) {
                window.electronAPI.getAppData(app.packageName).then(result => {
                    if (!result) return; // 결과가 아예 없으면 종료
                    // [A] 아이콘 처리 (독립적)
                    if (result.icon) {
                        app.cachedIconUrl = result.icon; // 캐싱
                        const imgTag = div.querySelector('.app-real-icon');
                        const spanTag = div.querySelector('.app-fallback-icon');

                        if (imgTag && spanTag) {
                            imgTag.src = result.icon;
                            imgTag.onload = () => {
                                imgTag.style.display = 'block';
                                spanTag.style.display = 'none';
                            };
                            imgTag.onerror = () => {
                                imgTag.style.display = 'none';
                                spanTag.style.display = 'flex';
                            };
                        }
                    }

                    // [B] 타이틀 처리 (독립적)
                    if (result.title) {
                        app.cachedTitle = result.title; // 캐싱
                        const nameTag = div.querySelector('.app-display-name');
                        if (nameTag) {
                            nameTag.textContent = result.title;
                        }
                    }
                }).catch(() => { });
            }

            // 클릭 이벤트
            div.addEventListener('click', () => {
                // 클릭 시점의 최신 이름 사용
                const currentName = div.querySelector('.app-display-name').textContent;
                AppDetailManager.show(app, currentName);
            });

            container.appendChild(div);
        },

        renderSuspiciousList(suspiciousApps) {
            const suspList = document.getElementById('suspicious-list-container');
            if (suspiciousApps && suspiciousApps.length > 0) {
                let html = '<ul style="list-style:none; padding:0;">';
                suspiciousApps.forEach(app => {
                    // 여기도 캐시된 타이틀이 있으면 사용
                    const dName = app.cachedTitle || Utils.formatAppName(app.packageName);
                    const reason = app.reason || "알 수 없는 위협";
                    let vtBadge = app.vtResult && app.vtResult.malicious > 0 ? `<span style="background:#d9534f; color:white; padding:2px 5px; border-radius:4px; font-size:11px; margin-left:5px;">🦠 VT: ${app.vtResult.malicious}</span>` : '';
                    html += `
                        <li style="padding:15px; border-bottom:1px solid #eee; border-left: 4px solid #D9534F; background-color: #fff5f5; margin-bottom: 10px; border-radius: 4px;">
                            <div style="color:#D9534F; font-weight:bold; font-size: 15px; margin-bottom: 4px;">
                                🚨 ${dName} ${vtBadge} <span style="font-size:12px; font-weight:normal; color:#888;">(${app.packageName})</span>
                            </div>
                            <div style="font-size:13px; color:#555;">${reason}</div>
                        </li>`;
                });
                suspList.innerHTML = html + '</ul>';
            } else {
                suspList.innerHTML = '<p style="color:#5CB85C; padding:10px;">✅ 탐지된 위협이 없습니다.</p>';
            }
        }
    };

    // =========================================================
    // [8] 앱 상세 화면 (APP DETAIL MANAGER)
    // =========================================================
    const AppDetailManager = {
        show(app, displayName) {
            document.getElementById('results-dashboard-view').classList.add('hidden');
            document.getElementById('app-detail-view').classList.remove('hidden');

            // 1. 이름 표시 (캐시된 타이틀 우선, 없으면 넘겨받은 이름)
            const finalName = app.cachedTitle || displayName;
            document.getElementById('detail-app-name').textContent = finalName;

            // 나머지 텍스트 정보 채우기
            document.getElementById('detail-package-name').textContent = app.packageName;
            document.getElementById('detail-sideload').textContent = app.isSideloaded ? '외부 설치' : 'Play Store';
            document.getElementById('detail-bg').textContent = app.isRunningBg ? '실행 중' : '중지됨';
            document.getElementById('detail-req-count').textContent = app.requestedCount || 0;
            document.getElementById('detail-grant-count').textContent = app.grantedCount || 0;

            // 2. 아이콘 DOM 초기화
            const iconWrapper = document.querySelector('.detail-icon-wrapper');
            iconWrapper.innerHTML = `
        <img class="detail-real-img" src="" style="width:100%; height:100%; object-fit:cover; display:none; border-radius: 12px;">
        <span class="detail-fallback-span" style="font-size:32px;">📱</span>
    `;
            const img = iconWrapper.querySelector('.detail-real-img');
            const span = iconWrapper.querySelector('.detail-fallback-span');

            // [Case A] 캐시된 아이콘이 있으면 즉시 표시
            if (app.cachedIconUrl) {
                img.src = app.cachedIconUrl;
                img.style.display = 'block';
                span.style.display = 'none';
            }

            // [Case B] 정보가 부족하면 API 요청
            // (아이콘이 없거나 타이틀이 없으면 요청 시도)
            if ((!app.cachedIconUrl || !app.cachedTitle)) {
                window.electronAPI.getAppData(app.packageName).then(result => {
                    if (!result) return;

                    // [A] 아이콘 처리 (독립적)
                    if (result.icon) {
                        app.cachedIconUrl = result.icon; // 캐싱
                        img.src = result.icon;
                        img.onload = () => {
                            img.style.display = 'block';
                            span.style.display = 'none';
                        };
                    }

                    // [B] 타이틀 처리 (독립적)
                    if (result.title) {
                        app.cachedTitle = result.title; // 캐싱
                        document.getElementById('detail-app-name').textContent = result.title;
                    }
                }).catch(() => { });
            }

            // 버튼 및 기타 정보 설정 (기존과 동일)
            this.setupActionButton('uninstall-btn', "🗑️ 앱 강제 삭제", app, displayName);
            this.setupActionButton('neutralize-btn', "🛡️ 무력화 (권한 박탈)", app, displayName);

            const usage = app.dataUsage || { rx: 0, tx: 0 };
            const total = usage.rx + usage.tx;
            const netEl = document.getElementById('detail-network');
            netEl.innerHTML = `총 ${Utils.formatBytes(total)}<br><span style="font-size:12px; color:#888;">(수신: ${Utils.formatBytes(usage.rx)} / 송신: ${Utils.formatBytes(usage.tx)})</span>`;

            const list = document.getElementById('detail-permission-list');
            list.innerHTML = '';
            if (app.requestedList && app.requestedList.length > 0) {
                app.requestedList.forEach(perm => {
                    const isGranted = app.grantedList.includes(perm);
                    const spanElem = document.createElement('span');
                    spanElem.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                    spanElem.textContent = (isGranted ? '✅ ' : '🚫 ') + Utils.getKoreanPermission(perm);
                    list.appendChild(spanElem);
                });
            } else {
                list.innerHTML = '<p style="color:#999; padding:5px;">요청된 권한이 없습니다.</p>';
            }
        },

        setupActionButton(btnId, text, app, appName) {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.dataset.package = app.packageName;
                btn.dataset.appName = appName;
                btn.disabled = false;
                btn.textContent = text;
            }
        }
    };

    // 뒤로가기 버튼
    document.getElementById('back-to-dashboard-btn')?.addEventListener('click', () => {
        document.getElementById('app-detail-view').classList.add('hidden');
        document.getElementById('results-dashboard-view').classList.remove('hidden');
    });

    // =========================================================
    // [9] 액션 핸들러 (삭제/무력화/인쇄)
    // =========================================================

    // 1. 앱 삭제
    const uninstallBtn = document.getElementById('uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', async () => {
            const { package: packageName, appName } = uninstallBtn.dataset;
            if (!packageName) return;

            if (!confirm(`[경고] 정말로 '${appName}' 앱을 삭제하시겠습니까?\n\n패키지명: ${packageName}`)) return;

            uninstallBtn.disabled = true;
            uninstallBtn.textContent = "처리 중...";

            try {
                const result = await window.electronAPI.uninstallApp(packageName);
                if (result.success) {
                    alert(result.message);
                    document.getElementById('back-to-dashboard-btn').click();
                } else {
                    throw new Error(result.error);
                }
            } catch (err) {
                alert(`삭제 실패: ${err.message}\n\n[기기 관리자 해제 필요] 설정 > 보안 > 기기 관리자 앱에서 '${appName}' 체크 해제 후 다시 시도하세요.`);
            } finally {
                uninstallBtn.disabled = false;
                uninstallBtn.textContent = "🗑️ 앱 강제 삭제";
            }
        });
    }

    // 2. 무력화
    const neutralizeBtn = document.getElementById('neutralize-btn');
    if (neutralizeBtn) {
        neutralizeBtn.addEventListener('click', async () => {
            const { package: packageName, appName } = neutralizeBtn.dataset;
            if (!packageName) return;

            if (!confirm(`[주의] '${appName}' 앱의 모든 권한을 회수하고 강제 종료하시겠습니까?`)) return;

            neutralizeBtn.disabled = true;
            neutralizeBtn.textContent = "무력화 중...";

            try {
                const result = await window.electronAPI.neutralizeApp(packageName);
                if (result.success) {
                    alert(`✅ 무력화 성공!\n총 ${result.count}개의 권한을 박탈했습니다.`);
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

    // 3. 인쇄
    const printResultsBtn = document.getElementById('print-results-btn');
    if (printResultsBtn) {
        printResultsBtn.addEventListener('click', () => {
            if (!State.lastScanData) return alert("인쇄할 데이터가 없습니다.");
            const data = State.lastScanData;

            // 인쇄용 DOM 채우기
            const now = new Date();
            document.getElementById('print-date').textContent = now.toLocaleString('ko-KR');
            document.getElementById('print-doc-id').textContent = `BD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

            // 정보
            document.getElementById('print-model').textContent = data.deviceInfo.model;
            document.getElementById('print-serial').textContent = data.deviceInfo.serial;
            document.getElementById('print-root').textContent = data.deviceInfo.isRooted ? '발견됨 (위험)' : '안전함';
            document.getElementById('print-phone').textContent = data.deviceInfo.phoneNumber;

            // 통계
            const threatCount = data.suspiciousApps.length;
            const summaryBox = document.getElementById('print-summary-box');
            summaryBox.className = `summary-box status-${threatCount > 0 ? 'danger' : 'safe'}`;
            summaryBox.innerHTML = threatCount > 0 ? `⚠️ 위험 (DANGER): 총 ${threatCount}건의 위협이 탐지되었습니다.` : `✅ 안전 (SAFE): 특이사항이 발견되지 않았습니다.`;

            document.getElementById('print-total-count').textContent = data.allApps.length;
            document.getElementById('print-threat-count').textContent = threatCount;
            document.getElementById('print-file-count').textContent = data.apkFiles.length;

            // 위협 테이블
            const threatContainer = document.getElementById('print-threat-container');
            if (threatCount > 0) {
                let html = `<table class="detail-table"><thead><tr><th>탐지된 앱</th><th>패키지명</th><th>위협 사유</th></tr></thead><tbody>`;
                data.suspiciousApps.forEach(app => {
                    let vtInfo = app.vtResult && app.vtResult.malicious > 0 ? `<br><span style="color:red; font-size:9px;">[VT: ${app.vtResult.malicious}]</span>` : '';
                    html += `<tr><td class="text-danger"><b>${Utils.formatAppName(app.packageName)}</b></td><td>${app.packageName}</td><td>${app.reason || '불명확'}${vtInfo}</td></tr>`;
                });
                threatContainer.innerHTML = html + `</tbody></table>`;
            } else {
                threatContainer.innerHTML = `<div style="padding:10px; border:1px solid #ccc; text-align:center; color:#5CB85C;">탐지된 위협 없음</div>`;
            }

            // 파일 테이블
            const fileBody = document.getElementById('print-file-body');
            fileBody.innerHTML = data.apkFiles.length > 0
                ? data.apkFiles.map((f, i) => `<tr><td style="text-align:center;">${i + 1}</td><td>${f}</td></tr>`).join('')
                : `<tr><td colspan="2" style="text-align:center; color:#999;">발견된 파일 없음</td></tr>`;

            // 전체 목록 (콤팩트)
            const appGrid = document.getElementById('print-all-apps-grid');
            appGrid.innerHTML = '';
            [...data.allApps].sort((a, b) => a.packageName.localeCompare(b.packageName)).forEach(app => {
                const div = document.createElement('div');
                div.className = app.reason ? 'compact-item compact-threat' : (app.isSideloaded ? 'compact-item compact-sideload' : 'compact-item');
                const prefix = app.reason ? '[위협] ' : (app.isSideloaded ? '[외부] ' : '');
                div.textContent = `${prefix}${Utils.formatAppName(app.packageName)} (${app.packageName})`;
                appGrid.appendChild(div);
            });

            setTimeout(() => window.print(), 200);
        });
    }

    // =========================================================
    // [10] 검사 시간 임의 설정
    // =========================================================

    const adminTriggers = document.querySelectorAll('.app-title');
    const adminModal = document.getElementById('admin-modal');
    const adminContent = document.querySelector('.modal-content'); // ★ 내용물 박스 선택
    const adminInput = document.getElementById('admin-input');
    const adminSaveBtn = document.getElementById('admin-save-btn');
    const adminCancelBtn = document.getElementById('admin-cancel-btn');

    // 모달 닫기 함수
    const closeAdminModal = () => {
        if (adminModal) adminModal.classList.add('hidden');
    };

    // 저장 로직 (함수로 분리)
    const handleAdminSave = async () => {
        const val = adminInput.value;
        if (!val && val !== '0') {
            alert("값을 입력하세요.");
            return;
        }

        const min = parseInt(val, 10);
        let message = "";

        // 유효성 검사
        if (min === 0) {
            message = "설정 해제: 즉시 완료 모드";
        } else if (min < 10 || min > 60) {
            alert("시간은 10분 ~ 60분 사이로 설정해주세요.");
            return;
        } else {
            message = `✅ 설정됨: 안드로이드 검사 시간 [${min}분]`;
        }

        // 1. UI 반영 (즉시)
        State.androidTargetMinutes = min;
        
        // 2. Firestore 저장 (비동기)
        adminSaveBtn.textContent = "저장 중...";
        adminSaveBtn.disabled = true;

        try {
            const docRef = doc(db, "settings", "config");
            await updateDoc(docRef, {
                android_scan_duration: min
            });
            alert(`${message}\n(서버에도 저장되었습니다)`);
            closeAdminModal();
        } catch (error) {
            console.error("저장 실패:", error);
            alert(`⚠️ 로컬에는 적용되었으나 서버 저장에 실패했습니다.\n오류: ${error.message}`);
            closeAdminModal();
        } finally {
            adminSaveBtn.textContent = "저장";
            adminSaveBtn.disabled = false;
        }
    };

    if (adminTriggers.length > 0 && adminModal) {
        console.log(`✅ 히든 메뉴 시스템 활성화됨`);

        // 더블클릭 트리거
        adminTriggers.forEach(trigger => {
            trigger.style.userSelect = 'none';
            trigger.style.cursor = 'default';

            trigger.addEventListener('dblclick', () => {
                // 로그인 & 상태 체크 (기존과 동일)
                const loggedInView = document.getElementById('logged-in-view');
                if (!loggedInView.classList.contains('active')) return;
                
                const progressScreen = document.getElementById('scan-progress-screen');
                if (progressScreen && progressScreen.classList.contains('active')) {
                    alert("🚫 검사 중에는 변경 불가"); return;
                }
                const resultScreen = document.getElementById('scan-results-screen');
                if (resultScreen && resultScreen.classList.contains('active')) {
                    alert("🚫 결과 화면에서는 변경 불가"); return;
                }

                // 현재 값 채우기
                adminInput.value = State.androidTargetMinutes || 0;
                adminModal.classList.remove('hidden');
                adminInput.focus();
            });
        });

        // 저장 버튼 이벤트 교체
        const newSaveBtn = adminSaveBtn.cloneNode(true);
        adminSaveBtn.parentNode.replaceChild(newSaveBtn, adminSaveBtn);
        newSaveBtn.addEventListener('click', handleAdminSave);

        // 취소 버튼
        const newCancelBtn = adminCancelBtn.cloneNode(true);
        adminCancelBtn.parentNode.replaceChild(newCancelBtn, adminCancelBtn);
        newCancelBtn.addEventListener('click', closeAdminModal);

        // 드래그 닫힘 방지
        if (adminContent) {
            adminContent.addEventListener('click', (e) => e.stopPropagation());
        }
        // 배경 클릭 닫기
        adminModal.addEventListener('click', (e) => {
            if (e.target === adminModal) closeAdminModal();
        });

    } else {
        console.warn('❌ 히든 메뉴 요소 찾기 실패');
    }
    // =========================================================
    // [11] 유틸리티 (UTILS)
    // =========================================================
    const Utils = {
        formatAppName(packageName) {
            if (!packageName) return "Unknown";
            const parts = packageName.split('.');
            let name = parts[parts.length - 1];
            if ((name === 'android' || name === 'app') && parts.length > 1) name = parts[parts.length - 2];
            return name.charAt(0).toUpperCase() + name.slice(1);
        },

        formatBytes(bytes, decimals = 2) {
            if (!+bytes) return '0 Bytes';
            const k = 1024;
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals < 0 ? 0 : decimals))} ${['Bytes', 'KB', 'MB', 'GB', 'TB'][i]}`;
        },

        // iOS 데이터를 안드로이드 포맷으로 변환
        transformIosData(iosData) {
            const suspiciousApps = iosData.suspiciousItems.map(item => ({
                packageName: item.module || item.source_file,
                reason: `[MVT 탐지] ${item.message || item.process_name || 'Suspicious Artifact'}`,
                isSideloaded: true
            }));
            const allApps = (iosData.allApps || []).map(app => ({
                packageName: app.bundle_id || 'Unknown',
                isSideloaded: false,
                isRunningBg: false
            }));
            return {
                deviceInfo: { model: iosData.deviceInfo.model, serial: 'iOS-Device', isRooted: false, phoneNumber: '-' },
                allApps, suspiciousApps, apkFiles: []
            };
        },

        // 권한 한글 매핑
        getKoreanPermission(permString) {
            const MAP = {
                'CAMERA': '📷 카메라', 'RECORD_AUDIO': '🎤 마이크 (녹음)', 'READ_CONTACTS': '📒 연락처 읽기',
                'ACCESS_FINE_LOCATION': '📍 정밀 위치 (GPS)', 'READ_SMS': '✉️ 문자 읽기', 'SEND_SMS': '✉️ 문자 보내기',
                'RECEIVE_BOOT_COMPLETED': '🔌 부팅 시 자동 실행', 'BIND_DEVICE_ADMIN': '🛡️ 기기 관리자 (삭제 방지)',
                'INTERNET': '🌐 인터넷 사용', 'READ_EXTERNAL_STORAGE': '💾 저장소 읽기'
                // ... (필요 시 더 추가)
            };
            const shortName = permString.split('.').pop();
            return MAP[shortName] || shortName;
        }
    };
    // =========================================================
    // [12] 관리자 시스템 (ADMIN MANAGER) - 신규 추가
    // =========================================================
    const AdminManager = {
        init() {
            // ★★★ [수정됨] 로그인 후 화면(#logged-in-view) 안에 있는 메뉴만 찾습니다. ★★★
            const loggedInContainer = document.getElementById('logged-in-view');
            const navMenu = loggedInContainer.querySelector('.nav-menu');
            // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

            if (!navMenu) {
                console.error("❌ 오류: 로그인 화면 내의 .nav-menu를 찾을 수 없습니다!");
                return;
            }

            // 이미 버튼이 있는지 확인 (중복 생성 방지)
            if (loggedInContainer.querySelector('#nav-admin')) {
                console.log("⚠️ 이미 관리자 버튼이 존재합니다.");
                return;
            }

            // 버튼 생성 로직
            console.log("✨ 관리자 버튼 생성 중...");
            const li = document.createElement('li');
            li.className = 'nav-item';
            li.id = 'nav-admin';
            
            // 스타일 강조
            li.innerHTML = '🛡️ 관리자 페이지';
            li.style.color = '#F0AD4E'; 
            li.style.fontWeight = 'bold'; 

            li.addEventListener('click', () => {
                ViewManager.activateMenu('nav-admin');
                ViewManager.showScreen(document.getElementById('logged-in-view'), 'admin-screen');
                this.loadUsers();
            });
            
            // 메뉴의 맨 앞에 추가 (검사생성 위)
            navMenu.insertBefore(li, navMenu.firstChild); 
            
            console.log("✅ 관리자 버튼 추가 완료! (로그인 화면)");

            // 이벤트 리스너들 (기존과 동일)
            const refreshBtn = document.getElementById('refresh-users-btn');
            if(refreshBtn) refreshBtn.addEventListener('click', () => this.loadUsers());
            
            const createForm = document.getElementById('admin-create-user-form');
            if(createForm) createForm.addEventListener('submit', (e) => this.createUser(e));
            
            const closeBtn = document.getElementById('admin-result-close-btn');
            if(closeBtn) closeBtn.addEventListener('click', () => {
                document.getElementById('admin-result-modal').classList.add('hidden');
            });
        },

        // 1. 업체 목록 불러오기 (도메인 떼고 보여주기)
        async loadUsers() {
            const tbody = document.getElementById('admin-user-list-body');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">데이터 불러오는 중...</td></tr>';

            try {
                const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
                const querySnapshot = await getDocs(q);
                
                tbody.innerHTML = '';

                querySnapshot.forEach((docSnap) => {
                    const user = docSnap.data();
                    
                    // ★ 수정됨: 이메일에서 도메인(@bd.com) 제거하여 순수 아이디만 추출
                    const rawEmail = user.email || "";
                    const userId = rawEmail.replace(ID_DOMAIN, ""); 

                    const row = document.createElement('tr');
                    const statusBadge = user.isLocked 
                        ? `<span class="admin-badge badge-locked">🔒 잠김</span>` 
                        : `<span class="admin-badge badge-active">✅ 활성</span>`;

                    row.innerHTML = `
                        <td><b>${userId}</b><br><span style="font-size:11px; color:#888;">(UID: ${docSnap.id.substring(0,6)}...)</span></td>
                        <td>${statusBadge}</td>
                        <td><b>${user.quota || 0}</b> 회</td>
                        <td>${user.lastScanDate ? new Date(user.lastScanDate.toDate()).toLocaleDateString() : '-'}</td>
                        <td>
                            <button class="control-btn btn-quota" onclick="window.changeQuota('${docSnap.id}', ${user.quota || 0})">➕/➖</button>
                            ${user.isLocked 
                                ? `<button class="control-btn btn-unlock" onclick="window.toggleLock('${docSnap.id}', false)">🔓 해제</button>` 
                                : `<button class="control-btn btn-lock" onclick="window.toggleLock('${docSnap.id}', true)">🔒 잠금</button>`
                            }
                            <button class="control-btn" onclick="window.viewHistory('${docSnap.id}')">📜 기록</button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            } catch (error) {
                console.error("유저 로딩 실패:", error);
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로드 실패: ${error.message}</td></tr>`;
            }
        },

        // 2. 신규 업체 등록 (아이디 + 도메인 결합)
        async createUser(e) {
            e.preventDefault();
            
            // ★ HTML ID 변경 주의: index.html에서 id="new-user-id"로 바꿨다면 여기도 맞춰야 함
            // 만약 index.html을 안 바꿨으면 'new-user-email' 그대로 사용
            const inputElement = document.getElementById('new-user-id') || document.getElementById('new-user-email');
            const inputId = inputElement.value.trim();
            const password = document.getElementById('new-user-pwd').value;
            const quota = parseInt(document.getElementById('new-user-quota').value, 10);

            // ★ 수정됨: 아이디 + 도메인 결합
            const fullEmail = inputId + ID_DOMAIN;

            if (!confirm(`[확인] 다음 계정을 생성합니까?\nID: ${inputId} (실제: ${fullEmail})\n기본 횟수: ${quota}`)) return;

            const secondaryAppName = "secondaryApp-" + Date.now();
            const config = auth.app.options; 
            
            try {
                const secondaryApp = initializeApp(config, secondaryAppName);
                const secondaryAuth = getAuth(secondaryApp);

                // 생성은 fullEmail로 진행
                const userCred = await createUserWithEmailAndPassword(secondaryAuth, fullEmail, password);
                const newUser = userCred.user;

                await setDoc(doc(db, "users", newUser.uid), {
                    email: fullEmail, // DB에는 풀 이메일 저장 (관리 차원)
                    userId: inputId,  // ★ 편의를 위해 순수 ID도 별도 저장
                    role: 'user',
                    isLocked: false,
                    quota: quota,
                    createdAt: new Date(),
                    lastScanDate: null
                });

                alert(`✅ 업체 생성 완료!\n아이디: ${inputId}`);
                
                document.getElementById('admin-create-user-form').reset();
                this.loadUsers();

            } catch (error) {
                console.error("계정 생성 실패:", error);
                alert("계정 생성 실패: " + error.message);
            }
        }
    };

    // [전역 함수 노출] HTML onclick에서 호출하기 위해 window에 등록
    window.toggleLock = async (uid, shouldLock) => {
        if (!confirm(shouldLock ? "🚫 이 업체의 사용을 막으시겠습니까?" : "✅ 차단을 해제하시겠습니까?")) return;
        try {
            await updateDoc(doc(db, "users", uid), { isLocked: shouldLock });
            AdminManager.loadUsers(); // 새로고침
        } catch (e) { alert("처리 실패: " + e.message); }
    };

    window.changeQuota = async (uid, currentQuota) => {
        const input = prompt(`현재 횟수: ${currentQuota}\n\n추가하거나 뺄 수량을 입력하세요.\n(예: 10 또는 -5)`, "0");
        if (!input) return;
        const change = parseInt(input, 10);
        if (isNaN(change)) return alert("숫자만 입력하세요.");

        try {
            const newQuota = currentQuota + change;
            if (newQuota < 0) return alert("횟수는 0보다 작을 수 없습니다.");
            
            await updateDoc(doc(db, "users", uid), { quota: newQuota });
            alert(`✅ 변경 완료! (총 ${newQuota}회)`);
            AdminManager.loadUsers();
        } catch (e) { alert("변경 실패: " + e.message); }
    };

    window.viewHistory = async (uid) => {
        const modal = document.getElementById('admin-result-modal');
        const content = document.getElementById('admin-result-content');
        modal.classList.remove('hidden');
        content.innerHTML = "데이터 조회 중...";

        try {
            // users -> uid -> scanResults 서브컬렉션 조회
            const historyRef = collection(db, "users", uid, "scanResults");
            const q = query(historyRef, orderBy("date", "desc"));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                content.innerHTML = "<p>📭 제출된 검사 결과가 없습니다.</p>";
                return;
            }

            let html = `<ul class="file-list" style="max-height:400px;">`;
            snapshot.forEach(doc => {
                const data = doc.data();
                const date = data.date ? new Date(data.date.toDate()).toLocaleString() : '날짜 없음';
                const threatCount = data.threatCount || 0;
                const style = threatCount > 0 ? 'color:red; font-weight:bold;' : 'color:green;';
                
                html += `
                    <li style="padding:10px; border-bottom:1px solid #eee;">
                        <div>🕒 <b>${date}</b></div>
                        <div style="${style}">결과: 위협 ${threatCount}건 발견</div>
                        <div style="font-size:12px; color:#666;">모델: ${data.model} (Serial: ${data.serial})</div>
                    </li>
                `;
            });
            html += "</ul>";
            content.innerHTML = html;

        } catch (e) {
            content.innerHTML = `<p style="color:red;">기록 조회 실패: ${e.message}</p>`;
        }
    };
});
