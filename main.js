// main.js (최종 완성본: 내장 ADB + 연결 확인 + 실제 검사)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const adb = require('adbkit'); 

// [핵심 1] 프로젝트 폴더 내의 platform-tools/adb.exe를 사용하도록 설정
// (사용자 PC에 ADB가 없어도 작동하게 함)
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


function checkDeviceConnection() {

    console.log("asdasdasdasdasdsad")
}
// [핵심 2] 기기 연결 상태 정밀 확인 (승인 대기 상태 처리)
ipcMain.handle('checkDeviceConnection', async () => {
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
    console.log('--- main.js: 실제 ADB 검사 시작 ---');
    try {
        const devices = await client.listDevices();
        if (devices.length === 0) {
            throw new Error('연결된 기기가 없습니다.');
        }

        const serial = devices[0].id;
        console.log(`검사 대상 기기: ${serial}`);

        // 1. APK 파일 검색
        const apkFiles = await findApkFiles(serial);
        console.log(`APK 파일 검색 완료: ${apkFiles.length}개 발견`);

        // 2. 설치된 앱 목록 가져오기
        const allApps = await getInstalledApps(serial);
        console.log(`설치된 앱 목록 확보: ${allApps.length}개`);

        // 3. 앱 상세 분석 (병렬 처리 - 5개씩 끊어서)
        const processedApps = [];
        for (let i = 0; i < allApps.length; i += 5) {
            const chunk = allApps.slice(i, i + 5);
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

        console.log('--- main.js: 모든 분석 완료 ---');
        
        // 4. 의심스러운 앱 필터링 (MVP 기준)
        const suspiciousApps = processedApps.filter(app => 
            app.isSideloaded ||         // 사이드로딩 됨
            app.isRunningBg ||          // 백그라운드 실행 중
            app.allPermissionsGranted   // 모든 권한 허용됨
        );

        return {
            suspiciousApps: suspiciousApps,
            apkFiles: apkFiles
        };

    } catch (err) {
        console.error('검사 중 오류:', err);
        return { error: err.message, suspiciousApps: [], apkFiles: [] };
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

        // 요청한 권한
        const reqMatch = dumpsys.match(/requested permissions:\s*([\s\S]*?)(?:install permissions:|runtime permissions:)/);
        const requestedPerms = new Set();
        if (reqMatch && reqMatch[1]) {
            reqMatch[1].match(/android\.permission\.[A-Z_]+/g)?.forEach(p => requestedPerms.add(p));
        }

        // 부여된 권한 (install + runtime)
        const grantedPerms = new Set();
        const installMatch = dumpsys.match(/install permissions:\s*([\s\S]*?)(?:runtime permissions:|\n\n)/);
        if (installMatch && installMatch[1]) {
            installMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)
                ?.forEach(p => grantedPerms.add(p.split(':')[0]));
        }
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
            requestedCount: requestedPerms.size,
            grantedCount: grantedPerms.size,
        };
    } catch (err) {
        return { allPermissionsGranted: false, requestedCount: 0, grantedCount: 0 };
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