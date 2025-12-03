// main.js (변경 후 - macOS 및 Windows 지원)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os'); // [추가] os 모듈 로드
const adb = require('adbkit');

const IS_DEV_MODE = true;

// ★★★ [수정] 현재 OS에 따라 ADB 실행 파일 이름 동적 결정 ★★★
const adbExecutable = os.platform() === 'win32' ? 'adb.exe' : 'adb';
const adbPath = path.join(__dirname, 'platform-tools', adbExecutable);
// ★★★ [수정 끝] ★★★

const client = adb.createClient({ bin: adbPath });

// ... (나머지 코드 유지) ...

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

// ★★★ [추가] 창 포커스 강제 재설정 핸들러 ★★★
ipcMain.handle('force-window-reset', () => { // 이름은 force-window-reset으로 하겠습니다.
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        // Windows의 고질적인 렌더링 버그 해결을 위해 최소화 -> 복원 트릭 사용
        
        // 1. 창을 최소화 (Windows OS에 의한 강제 리셋 유발)
        mainWindow.minimize(); 
        
        // 2. 짧은 지연(100ms) 후 창을 복원 및 포커스 재확보
        setTimeout(() => {
            mainWindow.restore(); 
            mainWindow.focus();
        }, 100); 
        console.log('--- Main Process: Window Reset (Minimize/Restore) Triggered ---');
    }
});

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
        const allApps = await getInstalledApps(serial); // 여기서 UID도 가져옴
        
        // ★★★ [추가] 네트워크 사용량 전체 맵 가져오기
        const networkMap = await getNetworkUsageMap(serial);

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

    // 2. 전체 앱 가져오기 (-U 옵션 추가: UID 가져오기 위함)
    const output = await client.shell(serial, 'pm list packages -i -f -U');
    const data = await adb.util.readAll(output);
    const lines = data.toString().trim().split('\n');

    const TRUSTED_INSTALLERS = [
        'com.android.vending', 'com.sec.android.app.samsungapps',
        'com.skt.skaf.A000Z00040', 'com.kt.olleh.storefront',
        'com.lguplus.appstore', 'com.google.android.feedback'
    ];

    return lines.map((line) => {
        if (!line) return null;
        // 포맷: package:/data/.../base.apk=com.package uid:10123 installer=com.android.vending
        const parts = line.split(/\s+/);
        
        let packageName = '';
        let apkPath = 'N/A';
        let installer = null;
        let uid = null;

        parts.forEach(part => {
            if (part.includes('=')) {
                // package:/path=com.name 처리
                if (part.startsWith('package:')) {
                    const cleanPart = part.replace('package:', '');
                    const splitIdx = cleanPart.lastIndexOf('=');
                    if (splitIdx !== -1) {
                        apkPath = cleanPart.substring(0, splitIdx);
                        packageName = cleanPart.substring(splitIdx + 1);
                    }
                } else if (part.startsWith('installer=')) {
                    installer = part.replace('installer=', '');
                }
            } else if (part.startsWith('uid:')) {
                // [중요] UID 추출
                uid = part.replace('uid:', '');
            }
        });

        if (!packageName) return null;

        // Sideload 판별
        let isSideloaded = true;
        if (systemPackages.has(packageName)) {
            isSideloaded = false;
        } else if (installer && TRUSTED_INSTALLERS.includes(installer)) {
            isSideloaded = false;
        }

        return {
            packageName, apkPath, installer, isSideloaded, uid // uid 추가됨
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

// [main.js] 맨 아래에 추가

// 전체 네트워크 사용량 맵 가져오기 (UID 기준)
async function getNetworkUsageMap(serial) {
    const usageMap = {}; // { uid: { rx: 0, tx: 0 } }
    try {
        // dumpsys netstats detail 명령어로 상세 내역 조회
        const output = await client.shell(serial, 'dumpsys netstats detail');
        const data = await adb.util.readAll(output);
        const lines = data.toString().split('\n');

        lines.forEach(line => {
            // 라인 예시: ident=[...] uid=10123 set=DEFAULT tag=0x0 ... rxBytes=1024 txBytes=512
            if (line.includes('uid=') && line.includes('rxBytes=')) {
                const parts = line.trim().split(/\s+/);
                let uid = null;
                let rx = 0;
                let tx = 0;

                parts.forEach(p => {
                    if (p.startsWith('uid=')) uid = p.split('=')[1];
                    if (p.startsWith('rxBytes=')) rx = parseInt(p.split('=')[1]) || 0;
                    if (p.startsWith('txBytes=')) tx = parseInt(p.split('=')[1]) || 0;
                });

                if (uid) {
                    if (!usageMap[uid]) usageMap[uid] = { rx: 0, tx: 0 };
                    usageMap[uid].rx += rx;
                    usageMap[uid].tx += tx;
                }
            }
        });
    } catch (e) {
        console.error('네트워크 통계 수집 실패:', e);
    }
    return usageMap;
}

// [main.js] 맨 아래 getMockData 함수 교체

function getMockData() {
    // 1. 민감 권한 및 알람 권한 정의 (실제 로직과 동일하게 맞춤)
    const SENSITIVE_PERMISSIONS = [
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.READ_SMS',
        'android.permission.SEND_SMS',
        'android.permission.CAMERA',
        'android.permission.BIND_DEVICE_ADMIN',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
    ];

    const ALARM_PERMISSIONS = [
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_EXACT_ALARM'
    ];

    // 2. 가짜 앱 목록 생성 (데이터 사용량 dataUsage 추가됨)
    const mockApps = [
        {
            // [정상 앱] 카카오톡: 플레이 스토어 설치, 권한 많지만 안전
            packageName: 'com.kakao.talk',
            isSideloaded: false, // Play Store 설치
            isRunningBg: true,
            dataUsage: { rx: 1024 * 1024 * 150, tx: 1024 * 1024 * 50 }, // 수신 150MB, 송신 50MB
            allPermissionsGranted: true,
            requestedCount: 25,
            grantedCount: 25,
            requestedList: ['android.permission.INTERNET', 'android.permission.READ_CONTACTS', 'android.permission.CAMERA'],
            grantedList: ['android.permission.INTERNET', 'android.permission.READ_CONTACTS', 'android.permission.CAMERA']
        },
        {
            // [정상 앱] 유튜브: 데이터 많이 씀
            packageName: 'com.google.android.youtube',
            isSideloaded: false,
            isRunningBg: false,
            dataUsage: { rx: 1024 * 1024 * 1024 * 1.2, tx: 1024 * 1024 * 10 }, // 수신 1.2GB
            allPermissionsGranted: true,
            requestedCount: 10,
            grantedCount: 8,
            requestedList: ['android.permission.INTERNET'],
            grantedList: ['android.permission.INTERNET']
        },
        {
            // [악성 앱] 스파이웨어: 외부 설치 + 민감권한 + 알람없음 + 데이터 송신 많음
            packageName: 'com.android.system.service.update', // 시스템 앱인 척 위장
            isSideloaded: true, // ★ 외부 설치 (핵심)
            isRunningBg: true,  // ★ 백그라운드 실행 (핵심)
            dataUsage: { rx: 1024 * 100, tx: 1024 * 1024 * 500 }, // ★ 송신(TX)이 비정상적으로 많음 (500MB)
            allPermissionsGranted: true,
            requestedCount: 50,
            grantedCount: 50,
            requestedList: [
                'android.permission.RECORD_AUDIO', // 도청
                'android.permission.ACCESS_FINE_LOCATION', // 위치 추적
                'android.permission.READ_SMS', // 문자 탈취
                'android.permission.BIND_DEVICE_ADMIN', // 삭제 방지
                'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS' // 좀비 모드
            ],
            grantedList: [
                'android.permission.RECORD_AUDIO',
                'android.permission.ACCESS_FINE_LOCATION',
                'android.permission.READ_SMS',
                'android.permission.BIND_DEVICE_ADMIN',
                'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
            ]
            // ★ 알람 권한 없음!
        },
        {
            // [애매한 앱] 게임: 외부 설치지만 민감 권한 없음 -> 안전으로 분류되어야 함
            packageName: 'com.epicgames.fortnite',
            isSideloaded: true, 
            isRunningBg: false,
            dataUsage: { rx: 1024 * 1024 * 50, tx: 1024 * 1024 * 1 },
            allPermissionsGranted: true,
            requestedCount: 5,
            grantedCount: 5,
            requestedList: ['android.permission.INTERNET'],
            grantedList: ['android.permission.INTERNET']
        }
    ];

    // 3. 필터링 로직 (run-scan과 동일하게 적용하여 가짜 데이터에서도 빨간불 뜨게 함)
    const suspiciousApps = mockApps.filter(app => {
        if (!app.isSideloaded) return false; // 1. 스토어 앱 제외
        if (!app.isRunningBg) return false;  // 2. 실행 중 아니면 제외

        const perms = app.requestedList || [];
        const hasSensitive = perms.some(p => SENSITIVE_PERMISSIONS.includes(p));
        const hasAlarm = perms.some(p => ALARM_PERMISSIONS.includes(p));

        if (hasSensitive && !hasAlarm) {
            const caught = perms.filter(p => SENSITIVE_PERMISSIONS.includes(p));
            const shortNames = caught.map(p => p.split('.').pop()).slice(0, 3);
            app.reason = `탐지: 외부 설치됨 + [${shortNames.join(', ')}...]`; // 이유 생성
            return true;
        }
        return false;
    });

    return {
        deviceInfo: {
            model: 'Galaxy S24 Ultra (MOCK)',
            serial: 'TEST-1234-ABCD',
            isRooted: true, // 루팅된 기기 시뮬레이션
            phoneNumber: '010-1234-5678'
        },
        allApps: mockApps,
        suspiciousApps: suspiciousApps,
        apkFiles: ['/sdcard/Download/system_update.apk', '/sdcard/Download/spyware.apk']
    };
}