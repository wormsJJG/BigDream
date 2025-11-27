// main.js (최종 완성본: 내장 ADB + 연결 확인 + 실제 검사)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const adb = require('adbkit'); 

// ★★★ [개발 모드 스위치] ★★★
// true = 가짜 데이터 사용 (폰 연결 불필요, 즉시 결과 나옴)
// false = 실제 ADB 사용 (배포 시 또는 실제 테스트 시 false로 변경)
const IS_DEV_MODE = true;
//
const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
const client = adb.createClient({ bin: adbPath });

function createWindow() {
    console.log('--- main.js: createWindow() 호출됨 ---');
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools(); // 개발자 도구 열기
}

app.whenReady().then(() => {
    createWindow();
});

// [핵심 2] 기기 연결 상태 정밀 확인 (승인 대기 상태 처리)
ipcMain.handle('check-device-connection', async () => {

    if (IS_DEV_MODE) {
        console.log('[DEV] 가상 기기 연결 성공');
        return { status: 'connected', model: 'Galaxy S24 (TEST)' };
    }

    console.log("main.js check-device-connection func")
    try {
        const devices = await client.listDevices();
        
        if (devices.length === 0) {
            return { status: 'disconnected' };
        }

        const device = devices[0];

        // 1. 폰에서 '허용' 팝업을 아직 안 누른 상태
        if (device.type === 'unauthorized') {
            return { status: 'unauthorized' }; 
        }

        // 2. 오프라인 상태
        if (device.type === 'offline') {
            return { status: 'offline' };
        }

        // 3. 정상 연결 상태
        let model = 'Android Device';
        try {
            const output = await client.shell(device.id, 'getprop ro.product.model');
            const data = await adb.util.readAll(output);
            model = data.toString().trim();
        } catch (e) {
            console.log('모델명 조회 실패 (무시):', e.message);
        }

        return { status: 'connected', model: model };

    } catch (err) {
        console.error('ADB 연결 오류:', err);
        return { status: 'error', error: err.message };
    }
});

// [핵심 3] 실제 ADB 검사 로직 (가짜 데이터 아님)
ipcMain.handle('run-scan', async () => {

    if (IS_DEV_MODE) {
        console.log('[DEV] 가상 스캔 데이터 반환');
        // 실제 스캔과 똑같은 시간 지연 효과를 주고 싶다면 아래 주석 해제 (예: 1초 대기)
        // await new Promise(r => setTimeout(r, 1000)); 
        return getMockData(); // 하단에 정의된 함수 호출
    }
    
    console.log('--- 정밀 분석 시작 ---');
    try {
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('연결된 기기가 없습니다.');

        const serial = devices[0].id;
        
        // [1] 기기 상세 정보 수집
        const modelCmd = await client.shell(serial, 'getprop ro.product.model');
        const model = (await adb.util.readAll(modelCmd)).toString().trim();

        // 루팅 여부 체크 (su 바이너리 확인)
        let isRooted = false;
        try {
            const rootCmd = await client.shell(serial, 'which su');
            const rootOutput = (await adb.util.readAll(rootCmd)).toString().trim();
            if (rootOutput.length > 0) isRooted = true;
        } catch (e) { isRooted = false; }

        // 전화번호 (권한 문제로 가져오기 힘들 수 있음, 시도만 함)
        let phoneNumber = '알 수 없음 (USIM 권한 필요)';
        try {
            // Android 10 이상에서는 보안 정책으로 인해 번호 가져오기가 차단됨
            // 여기서는 셸 명령어로 시도만 해봅니다.
            const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
            const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
            if (phoneOut.includes('Line 1 Number')) phoneNumber = phoneOut; // 파싱 필요하나 생략
        } catch (e) {}

        const deviceInfo = {
            model: model,
            serial: serial,
            isRooted: isRooted,
            phoneNumber: phoneNumber
        };

        // [2] 파일 및 앱 분석 (기존 로직 유지)
        const apkFiles = await findApkFiles(serial);
        const allApps = await getInstalledApps(serial);

        // [3] 앱 상세 분석 (병렬 처리)
        const processedApps = [];
        for (let i = 0; i < allApps.length; i += 10) { // 속도를 위해 10개씩
            const chunk = allApps.slice(i, i + 10);
            const results = await Promise.all(
                chunk.map(async (app) => {
                    const [isRunningBg, permissions] = await Promise.all([
                        checkIsRunningBackground(serial, app.packageName),
                        getAppPermissions(serial, app.packageName)
                    ]);
                    return { ...app, isRunningBg, ...permissions };
                })
            );
            processedApps.push(...results);
        }

        // [4] 의심 앱 필터링
        const suspiciousApps = processedApps.filter(app => 
            app.isSideloaded && app.isRunningBg && app.allPermissionsGranted
        );

        return {
            deviceInfo: deviceInfo, // 추가된 기기 정보
            allApps: processedApps, // 모든 앱 정보 (UI에 그리기 위해)
            suspiciousApps: suspiciousApps,
            apkFiles: apkFiles
        };

    } catch (err) {
        console.error('검사 중 오류:', err);
        throw err;
    }
});

// 파일 열기 (기존 기능 유지)
ipcMain.handle('open-scan-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Scan Results', extensions: ['json'] }]
    });

    if (canceled || filePaths.length === 0) return null;

    try {
        const data = fs.readFileSync(filePaths[0], 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error("파일 읽기 오류:", error);
        return null;
    }
});


// --- [Helper Functions] 실제 분석을 도와주는 함수들 ---

// 1. 설치된 앱 목록 및 사이드로딩 여부 확인
async function getInstalledApps(serial) {
    // -i 옵션으로 installer 확인
    const output = await client.shell(serial, 'pm list packages -i -f');
    const data = await adb.util.readAll(output);
    const lines = data.toString().trim().split('\n');

    return lines.map((line) => {
        // line 예시: package:/data/app/~~/base.apk=com.example  installer=com.android.vending
        if (!line) return null;
        
        const parts = line.split('  ');
        const pathAndPackage = (parts[0] || '').replace('package:', '');
        const [apkPath, packageName] = pathAndPackage.split('=');
        
        let installer = null;
        if (parts[1] && parts[1].startsWith('installer=')) {
            installer = parts[1].replace('installer=', '');
        }

        return {
            packageName: packageName || apkPath,
            apkPath: packageName ? apkPath : 'N/A',
            installer: installer,
            // Play Store(vending)나 Google 관련이 아니면 사이드로딩으로 간주
            isSideloaded: installer !== 'com.android.vending' && installer !== 'com.google.android.feedback' && installer !== 'null' && installer !== null,
        };
    }).filter(item => item !== null);
}

// 2. 백그라운드 서비스 실행 확인
async function checkIsRunningBackground(serial, packageName) {
    try {
        const output = await client.shell(serial, `dumpsys activity services ${packageName}`);
        const data = await adb.util.readAll(output);
        const result = data.toString();
        // '(nothing)'이 없으면 실행 중인 서비스가 있다는 뜻
        return !result.includes('(nothing)') && result.length > 0;
    } catch (err) {
        return false;
    }
}

// 3. 앱 권한 확인 (모든 권한 허용 여부)
async function getAppPermissions(serial, packageName) {
    try {
        const output = await client.shell(serial, `dumpsys package ${packageName}`);
        const data = await adb.util.readAll(output);
        const dumpsys = data.toString();

        // 1. 요청된 모든 권한 (Requested)
        const reqMatch = dumpsys.match(/requested permissions:\s*([\s\S]*?)(?:install permissions:|runtime permissions:)/);
        const requestedPerms = new Set();
        if (reqMatch && reqMatch[1]) {
            reqMatch[1].match(/android\.permission\.[A-Z_]+/g)?.forEach(p => requestedPerms.add(p));
        }

        // 2. 실제 부여된 권한 (Granted)
        const grantedPerms = new Set();
        
        // Install permissions
        const installMatch = dumpsys.match(/install permissions:\s*([\s\S]*?)(?:runtime permissions:|\n\n)/);
        if (installMatch && installMatch[1]) {
            installMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)
                ?.forEach(p => grantedPerms.add(p.split(':')[0]));
        }
        
        // Runtime permissions
        const runtimeMatch = dumpsys.match(/runtime permissions:\s*([\s\S]*?)(?:Dex opt state:|$)/);
        if (runtimeMatch && runtimeMatch[1]) {
            runtimeMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)
                ?.forEach(p => grantedPerms.add(p.split(':')[0]));
        }

        // 모든 요청 권한이 부여되었는지 체크
        let allPermissionsGranted = requestedPerms.size > 0;
        for (const perm of requestedPerms) {
            if (!grantedPerms.has(perm)) {
                allPermissionsGranted = false;
                break;
            }
        }

        return {
            allPermissionsGranted,
            // [수정] 개수뿐만 아니라 실제 리스트를 배열로 반환
            requestedList: Array.from(requestedPerms),
            grantedList: Array.from(grantedPerms),
            requestedCount: requestedPerms.size,
            grantedCount: grantedPerms.size,
        };
    } catch (err) {
        return { 
            allPermissionsGranted: false, 
            requestedList: [], grantedList: [], 
            requestedCount: 0, grantedCount: 0 
        };
    }
}

// 4. APK 파일 검색
async function findApkFiles(serial) {
    try {
        const output = await client.shell(serial, 'find /sdcard -name "*.apk"');
        const data = await adb.util.readAll(output);
        return data.toString().trim().split('\n').filter(line => line.length > 0 && line.endsWith('.apk'));
    } catch (err) {
        console.error('APK 검색 실패:', err);
        return [];
    }
}

function getMockData() {
    // 1. 가짜 앱 목록 생성
    const mockApps = [
        {
            packageName: 'com.kakao.talk',
            isSideloaded: false,
            isRunningBg: true,
            allPermissionsGranted: false,
            requestedCount: 15,
            grantedCount: 10,
            requestedList: ['android.permission.INTERNET', 'android.permission.CAMERA'],
            grantedList: ['android.permission.INTERNET']
        },
        {
            packageName: 'com.google.android.youtube',
            isSideloaded: false,
            isRunningBg: false,
            allPermissionsGranted: false,
            requestedCount: 20,
            grantedCount: 18,
            requestedList: ['android.permission.INTERNET'],
            grantedList: ['android.permission.INTERNET']
        },
        {
            packageName: 'com.hacker.spyware', // 위험한 앱 예시
            isSideloaded: true,
            isRunningBg: true,
            allPermissionsGranted: true,
            requestedCount: 50,
            grantedCount: 50,
            requestedList: ['android.permission.READ_SMS', 'android.permission.CAMERA', 'android.permission.ACCESS_FINE_LOCATION'],
            grantedList: ['android.permission.READ_SMS', 'android.permission.CAMERA', 'android.permission.ACCESS_FINE_LOCATION']
        },
        {
            packageName: 'com.unknown.miner', // 채굴 앱 예시
            isSideloaded: true,
            isRunningBg: true,
            allPermissionsGranted: false,
            requestedCount: 5,
            grantedCount: 2,
            requestedList: ['android.permission.INTERNET'],
            grantedList: ['android.permission.INTERNET']
        }
    ];

    // 2. 의심 앱 필터링 (로직 동일하게)
    const suspiciousApps = mockApps.filter(app => 
        app.isSideloaded || app.isRunningBg || app.allPermissionsGranted
    );

    return {
        deviceInfo: {
            model: 'Galaxy S24 Ultra (TEST)',
            serial: 'R3CT40K...',
            isRooted: true, // 루팅된 것처럼 테스트
            phoneNumber: '010-0000-0000'
        },
        allApps: mockApps,
        suspiciousApps: suspiciousApps,
        apkFiles: ['/sdcard/Download/spyware.apk', '/sdcard/Download/hack.apk']
    };
}