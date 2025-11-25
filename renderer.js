// renderer.js (디버깅 강화 최종본)

// ★★★ 이 파일이 로드되었는지 확인 ★★★
console.log('--- renderer.js: 파일 로드됨 ---');

// HTML 문서가 모두 로드된 후에만 스크립트를 실행합니다.
document.addEventListener('DOMContentLoaded', () => {

    // ★★★ DOMContentLoaded 이벤트가 발생했는지 확인 ★★★
    console.log('--- renderer.js: DOM 로드 완료, 스크립트 실행 시작 ---');

    // --- 상태 관리 ---
    let isLoggedIn = false;

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

// 로그아웃
const logoutBtn = document.getElementById('logout-btn');

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        
        // 1. confirm() 대화 상자를 띄워 사용자에게 확인 받기
        const isConfirmed = confirm('정말 로그아웃을 하시겠습니까?');

        if (isConfirmed) {
            // 사용자가 '확인'을 누른 경우 (isConfirmed === true)
            console.log('로그아웃 실행');
            
            // 2. 로그아웃 처리 로직 실행
            isLoggedIn = false;
            showView('logged-out-view');
            // 로그아웃 후 기본 화면은 '로그인'
            showScreen(loggedOutView, 'login-screen');
            document.getElementById('nav-login').classList.add('active');
            document.getElementById('nav-support').classList.remove('active');
            
        } else {
            // 사용자가 '취소'를 누른 경우 (isConfirmed === false)
            console.log('로그아웃 취소됨');
            // 로그인 상태 유지 (별도의 추가 로직 없이 함수를 종료하면 됩니다.)
        }
    });
} else {
    console.error('logout-btn을 찾을 수 없습니다.');
}

    // 로그인 처리
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault(); // 페이지 새로고침 방지
            console.log('로그인 폼 제출됨');

            // --- 실제 로그인 로직 ---
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const loginError = document.getElementById('login-error');

            // (MVP 하드코딩) 아이디: admin, 비밀번호: 1234
            if (username === 'admin' && password === '1234') {
                console.log('로그인 성공');
                loginError.textContent = ''; // 오류 메시지 제거
                
                isLoggedIn = true;
                showView('logged-in-view');
                // 로그인 후 기본 화면은 '검사생성'
                showScreen(loggedInView, 'create-scan-screen');
                document.getElementById('nav-create').classList.add('active');
                document.getElementById('nav-open').classList.remove('active');

            } else {
                console.log('로그인 실패: 아이디 또는 비밀번호 불일치');
                loginError.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
            }
        });
    } else {
        console.error('login-form을 찾을 수 없습니다.');
    }

    // [로그인 뷰] 네비게이션 (검사생성)
    const navCreate = document.getElementById('nav-create');
    if (navCreate) {
        navCreate.addEventListener('click', () => {
            console.log('검사생성 네비 클릭');
            document.querySelectorAll('#logged-in-view .nav-item').forEach(i => i.classList.remove('active'));
            navCreate.classList.add('active');
            showScreen(loggedInView, 'create-scan-screen');
        });
    } else {
        console.error('nav-create를 찾을 수 없습니다.');
    }

    // [로그인 뷰] 네비게이션 (검사열기)
    const navOpen = document.getElementById('nav-open');
    if (navOpen) {
        navOpen.addEventListener('click', () => {
            console.log('검사열기 네비 클릭');
            document.querySelectorAll('#logged-in-view .nav-item').forEach(i => i.classList.remove('active'));
            navOpen.classList.add('active');
            showScreen(loggedInView, 'open-scan-screen');
        });
    } else {
        console.error('nav-open을 찾을 수 없습니다.');
    }

    // 로그아웃
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            console.log('로그아웃 버튼 클릭');
            isLoggedIn = false;
            showView('logged-out-view');
            // 로그아웃 후 기본 화면은 '로그인'
            showScreen(loggedOutView, 'login-screen');
            document.getElementById('nav-login').classList.add('active');
            document.getElementById('nav-support').classList.remove('active');
        });
    } else {
        console.error('logout-btn을 찾을 수 없습니다.');
    }

    // 검사 생성 -> 검사 화면으로 이동 버튼
    const clientInfoForm = document.getElementById('client-info-form');
    const startScanSetupBtn = document.getElementById('start-scan-setup-btn');
    
    // [추가] 새로 추가한 버튼 및 입력 필드 참조
    const resetClientInfoBtn = document.getElementById('reset-client-info-btn');
    const clientNameInput = document.getElementById('client-name');
    const clientDobInput = document.getElementById('client-dob');
    const clientPhoneInput = document.getElementById('client-phone');

    if (clientInfoForm && startScanSetupBtn && resetClientInfoBtn && clientNameInput && clientDobInput && clientPhoneInput) {
        
        // [추가] 폼 초기화 함수
        const resetForm = () => {
            console.log('검사자 정보 초기화');
            clientNameInput.value = '';
            clientDobInput.value = '';
            clientPhoneInput.value = '';
            startScanSetupBtn.disabled = true; // '검사 화면 이동' 버튼 비활성화
        };

        // [추가] 초기화 버튼 클릭 리스너
        resetClientInfoBtn.addEventListener('click', resetForm);

        // 대상자 정보 입력 시 버튼 활성화 로직
        clientInfoForm.addEventListener('input', () => {
            const name = clientNameInput.value;
            const dob = clientDobInput.value;
            const phone = clientPhoneInput.value;
            startScanSetupBtn.disabled = !(name && dob && phone);
        });

        // 폼 제출 (검사 화면으로 이동)
        clientInfoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log("검사 시작. 대상자:", clientNameInput.value);
            
            // 검사 화면으로 전환
            showScreen(loggedInView, 'scan-progress-screen');
            
            // 실제 검사 로직 호출
            await startScan(); 
        });

    } else {
        console.error('client-info-form 또는 하위 요소(버튼, 입력창)를 찾을 수 없습니다.');
    }
    
    // 검사 열기 버튼
    const selectFileBtn = document.getElementById('select-file-btn');
    if (selectFileBtn) {
        selectFileBtn.addEventListener('click', async () => {
            console.log('파일 선택 버튼 클릭');
            if (window.electronAPI && window.electronAPI.openScanFile) {
                const resultData = await window.electronAPI.openScanFile(); 
                if (resultData) {
                    console.log('파일 로드 성공:', resultData);
                    renderResults(resultData); // 결과 렌더링 함수
                    showScreen(loggedInView, 'scan-results-screen');
                } else {
                    console.log('파일 선택이 취소되었거나 실패함');
                }
            } else {
                console.error('electronAPI.openScanFile이 정의되지 않았습니다. preload.js를 확인하세요.');
            }
        });
    } else {
        console.error('select-file-btn을 찾을 수 없습니다.');
    }

    // 결과 출력 버튼
    const printResultsBtn = document.getElementById('print-results-btn');
    if (printResultsBtn) {
        printResultsBtn.addEventListener('click', () => {
            console.log('결과 출력 버튼 클릭');
            window.print();
        });
    } else {
        console.error('print-results-btn을 찾을 수 없습니다.');
    }


    // --- 기능 함수 ---
    async function startScan() {
        const statusBar = document.getElementById('progress-bar');
        const statusText = document.getElementById('scan-status-text');
        
        // 초기화
        statusBar.style.width = '0%';
        statusText.textContent = "기기 연결 확인 중...";

        try {
            // 1단계: 진행률 애니메이션 시작
            statusBar.style.width = '25%';
            statusText.textContent = "ADB/iOS 기기 스캔 중...";

            // 2단계: 실제 스캔 호출 (preload.js를 통해 main.js의 'run-scan' 실행)
            if (!window.electronAPI || !window.electronAPI.runScan) {
                throw new Error('electronAPI.runScan이 정의되지 않았습니다.');
            }
            const scanResultData = await window.electronAPI.runScan(); // (실제 검사 로직)

            // 3단계: 완료
            statusBar.style.width = '100%';
            statusText.textContent = "검사 완료!";

            // 4단계: 결과 렌더링 및 화면 전환
            setTimeout(() => {
                renderResults(scanResultData);
                showScreen(loggedInView, 'scan-results-screen');
            }, 1000);

        } catch (error) {
            console.error('스캔 중 심각한 오류 발생:', error);
            statusText.textContent = `스캔 실패: ${error.message}`;
            statusBar.style.backgroundColor = '#D9534F'; // 빨간색으로 변경
        }
    }

    function renderResults(data) {
        const container = document.getElementById('results-content');
        if (!container) return;

        // (데이터를 기반으로 HTML을 생성하는 로직)
        container.innerHTML = `
            <h3>검사 요약</h3>
            <p><strong>의심스러운 앱:</strong> ${data.suspiciousApps ? data.suspiciousApps.length : '0'} 개</p>
            <p><strong>발견된 APK 파일:</strong> ${data.apkFiles ? data.apkFiles.length : '0'} 개</p>
            <br>
            <h4>의심 앱 목록</h4>
            <ul>
                ${data.suspiciousApps && data.suspiciousApps.length > 0
                    ? data.suspiciousApps.map(app => `<li>${app.name} (${app.reason})</li>`).join('')
                    : '<li>발견된 항목 없음</li>'
                }
            </ul>
            <h4>발견된 APK 파일</h4>
            <ul>
                ${data.apkFiles && data.apkFiles.length > 0
                    ? data.apkFiles.map(file => `<li>${file}</li>`).join('')
                    : '<li>발견된 항목 없음</li>'
                }
            </ul>
        `;
    }

    // --- 초기화 ---
    console.log('--- renderer.js: 스크립트 초기화 완료. 로그인 화면 표시 ---');
    showView('logged-out-view');
    showScreen(loggedOutView, 'login-screen');

}); // DOMContentLoaded의 닫는 괄호