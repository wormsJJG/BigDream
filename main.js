const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const adb = require('adbkit');

const IS_DEV_MODE = false;

const adbPath = path.join(__dirname, 'platform-tools', 'adb.exe');
const client = adb.createClient({ bin: adbPath });

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => { createWindow(); });

// 1. 기기 연결 확인
ipcMain.handle('check-device-connection', async () => {
    if (IS_DEV_MODE) return { status: 'connected', model: 'Galaxy S24 (TEST)' };
    try {
        const devices = await client.listDevices();
        if (devices.length === 0) return { status: 'disconnected' };
        const device = devices[0];
        if (device.type === 'unauthorized') return { status: 'unauthorized' };
        if (device.type === 'offline') return { status: 'offline' };
        let model = 'Android Device';
        try {
            const output = await client.shell(device.id, 'getprop ro.product.model');
            const data = await adb.util.readAll(output);
            model = data.toString().trim();
        } catch (e) { }
        return { status: 'connected', model: model };
    } catch (err) {
        return { status: 'error', error: err.message };
    }
});

// 2. 스파이앱 탐지 로직 (수정됨)
ipcMain.handle('run-scan', async () => {
    console.log('--- 스파이앱 정밀 분석 시작 ---');
    
    if (IS_DEV_MODE) {
        await new Promise(r => setTimeout(r, 1500));
        return getMockData();
    }

    try {
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('연결된 기기가 없습니다.');

        const serial = devices[0].id;
        
        // 1. 기기 정보 수집
        const modelCmd = await client.shell(serial, 'getprop ro.product.model');
        const model = (await adb.util.readAll(modelCmd)).toString().trim();

        let isRooted = false;
        try {
            const rootCmd = await client.shell(serial, 'which su');
            if ((await adb.util.readAll(rootCmd)).toString().trim().length > 0) isRooted = true;
        } catch (e) {}

        let phoneNumber = '알 수 없음';
        try {
            const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
            const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
            if (phoneOut.includes('Line 1 Number')) phoneNumber = phoneOut;
        } catch (e) {}

        const deviceInfo = { model, serial, isRooted, phoneNumber };

        // 2. 파일 및 앱 목록 수집
        const apkFiles = await findApkFiles(serial);
        const allApps = await getInstalledApps(serial);

        // 3. 앱 상세 분석 (병렬 처리)
        const processedApps = [];
        for (let i = 0; i < allApps.length; i += 10) {
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

        // ============================================================
        // ★★★ [최종 수정] 스파이앱 탐지 로직 (조건 강화) ★★★
        // ============================================================

        const SENSITIVE_PERMISSIONS = [
            'android.permission.RECORD_AUDIO',
            'android.permission.READ_CONTACTS',
            'android.permission.ACCESS_FINE_LOCATION',
            'android.permission.READ_PHONE_STATE',
            'android.permission.CALL_PHONE',
            'android.permission.CAMERA',
            'android.permission.READ_CALL_LOG',
            'android.permission.READ_SMS',
            'android.permission.RECEIVE_SMS',
            'android.permission.SEND_SMS',
            'android.permission.RECEIVE_BOOT_COMPLETED',
            'android.permission.BIND_DEVICE_ADMIN',
            'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' // 좀비앱 권한
        ];

        const ALARM_PERMISSIONS = [
            'android.permission.SCHEDULE_EXACT_ALARM',
            'android.permission.USE_EXACT_ALARM',
            'com.android.alarm.permission.SET_ALARM'
        ];

        // 안전한 패키지명 (화이트리스트)
        const SAFE_PREFIXES = [
            'com.android.', 'com.google.android.', 'com.samsung.', 'com.sec.',
            'com.qualcomm.', 'com.sktelecom.', 'com.kt.', 'com.lgu.',
            'com.lguplus.', 'uplus.', 'lgt.', 'com.facebook'
        ];

        const suspiciousApps = processedApps.filter(app => {
            
            // 1. 화이트리스트 패스
            const isSafeVendor = SAFE_PREFIXES.some(prefix => app.packageName.startsWith(prefix));
            if (isSafeVendor) return false;

            // 2. Play 스토어 앱 패스
            if (!app.isSideloaded) return false;

            // ★★★ [추가된 조건] 백그라운드 실행 중이 아니라면 패스 ★★★
            // "지금 당장 활동하고 있는 위협"만 잡습니다.
            if (!app.isRunningBg) return false;

            // 3. 권한 분석
            const perms = app.requestedList || [];
            const hasSensitivePerm = perms.some(p => SENSITIVE_PERMISSIONS.includes(p));
            const hasAlarmPerm = perms.some(p => ALARM_PERMISSIONS.includes(p));

            // [최종 판단] 
            // 사이드로딩(O) + 백그라운드실행(O) + 민감권한(O) + 알람권한(X) -> 검거
            if (hasSensitivePerm && !hasAlarmPerm) {
                const caught = perms.filter(p => SENSITIVE_PERMISSIONS.includes(p));
                const shortNames = caught.map(p => p.split('.').pop()).slice(0, 3);
                
                app.reason = `탐지: 백그라운드 실행 + [${shortNames.join(', ')}...]`;
                return true; 
            }
            return false;
        });

        return {
            deviceInfo,
            allApps: processedApps,
            suspiciousApps,
            apkFiles
        };

    } catch (err) {
        console.error('검사 실패:', err);
        throw err;
    }
});

// 파일 열기
ipcMain.handle('open-scan-file', async () => { /* 생략 (기존 유지) */ });

// --- Helper Functions ---

// 앱 목록 가져오기 (오탐지 방지 강화)
async function getInstalledApps(serial) {
    // 1. 시스템 앱 리스트 확보
    const sysOutput = await client.shell(serial, 'pm list packages -s');
    const sysData = await adb.util.readAll(sysOutput);
    const systemPackages = new Set(sysData.toString().trim().split('\n').map(l => l.replace('package:', '').trim()));

    // 2. 전체 앱 가져오기
    const output = await client.shell(serial, 'pm list packages -i -f');
    const data = await adb.util.readAll(output);
    const lines = data.toString().trim().split('\n');

    const TRUSTED_INSTALLERS = [
        'com.android.vending',
        'com.sec.android.app.samsungapps',
        'com.skt.skaf.A000Z00040',
        'com.kt.olleh.storefront',
        'com.lguplus.appstore',
        'com.google.android.feedback'
    ];

    return lines.map((line) => {
        if (!line) return null;
        const parts = line.split(/\s+/);
        const pathAndPackage = (parts[0] || '').replace('package:', '');
        const splitIndex = pathAndPackage.lastIndexOf('=');
        if (splitIndex === -1) return null;

        const apkPath = pathAndPackage.substring(0, splitIndex);
        const packageName = pathAndPackage.substring(splitIndex + 1);

        let installer = null;
        const installerPart = parts.find(p => p.startsWith('installer='));
        if (installerPart) installer = installerPart.replace('installer=', '');

        // [Sideload 판별 로직]
        let isSideloaded = true;

        if (systemPackages.has(packageName)) {
            isSideloaded = false; // 시스템 앱
        } else if (installer && TRUSTED_INSTALLERS.includes(installer)) {
            isSideloaded = false; // 스토어 앱
        }

        return {
            packageName,
            apkPath,
            installer,
            isSideloaded
        };
    }).filter(item => item !== null);
}

async function checkIsRunningBackground(serial, packageName) {
    try {
        const output = await client.shell(serial, `dumpsys activity services ${packageName}`);
        const data = await adb.util.readAll(output);
        return !data.toString().includes('(nothing)') && data.toString().length > 0;
    } catch (e) { return false; }
}

async function getAppPermissions(serial, packageName) {
    try {
        const output = await client.shell(serial, `dumpsys package ${packageName}`);
        const data = await adb.util.readAll(output);
        const dumpsys = data.toString();

        const reqMatch = dumpsys.match(/requested permissions:\s*([\s\S]*?)(?:install permissions:|runtime permissions:)/);
        const requestedPerms = new Set();
        if (reqMatch && reqMatch[1]) {
            reqMatch[1].match(/android\.permission\.[A-Z_]+/g)?.forEach(p => requestedPerms.add(p));
        }

        const grantedPerms = new Set();
        const installMatch = dumpsys.match(/install permissions:\s*([\s\S]*?)(?:runtime permissions:|\n\n)/);
        if (installMatch && installMatch[1]) {
            installMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)?.forEach(p => grantedPerms.add(p.split(':')[0]));
        }
        const runtimeMatch = dumpsys.match(/runtime permissions:\s*([\s\S]*?)(?:Dex opt state:|$)/);
        if (runtimeMatch && runtimeMatch[1]) {
            runtimeMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)?.forEach(p => grantedPerms.add(p.split(':')[0]));
        }

        let allPermissionsGranted = requestedPerms.size > 0;
        for (const perm of requestedPerms) {
            if (!grantedPerms.has(perm)) {
                allPermissionsGranted = false;
                break;
            }
        }

        return {
            allPermissionsGranted,
            requestedList: Array.from(requestedPerms),
            grantedList: Array.from(grantedPerms),
            requestedCount: requestedPerms.size,
            grantedCount: grantedPerms.size,
        };
    } catch (e) {
        return { allPermissionsGranted: false, requestedList: [], grantedList: [], requestedCount: 0, grantedCount: 0 };
    }
}

async function findApkFiles(serial) {
    try {
        const output = await client.shell(serial, 'find /sdcard -name "*.apk"');
        const data = await adb.util.readAll(output);
        return data.toString().trim().split('\n').filter(l => l.length > 0 && l.endsWith('.apk'));
    } catch (e) { return []; }
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