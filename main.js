/**
 * main.js
 * BD (Big Dream) Mobile Security Solution
 * Electron Main Process
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const adb = require('adbkit');
const axios = require('axios');
const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const { exec, spawn } = require('child_process');

// ============================================================
// [1] 환경 설정 및 상수 (CONFIGURATION)
// ============================================================
const CONFIG = {
    IS_DEV_MODE: true,
    VIRUSTOTAL_API_KEY: '2aa1cd78a23bd4ae58db52c773d7070fd7f961acb6debcca94ba9b5746c2ec96',
    PATHS: {
        ADB: path.join(__dirname, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb'),
        IOS_TOOLS: path.join(__dirname, 'ios-tools'),
        IOS_ID: path.join(__dirname, 'ios-tools', os.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id'),
        IOS_INFO: path.join(__dirname, 'ios-tools', os.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo'),
        IOS_BACKUP: path.join(__dirname, 'ios-tools', os.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2'),
        TEMP_BACKUP: path.join(app.getPath('temp'), 'bd_ios_backup'),
        MVT_RESULT: path.join(app.getPath('userData'), 'mvt_results')
    }
};

// ADB 클라이언트 초기화
const client = adb.createClient({ bin: CONFIG.PATHS.ADB });

// ============================================================
// [2] 앱 생명주기 및 창 관리 (APP LIFECYCLE)
// ============================================================
function createWindow() {
    console.log('--- [System] Main Window Created ---');
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

// 창 리셋 (UI 강제 새로고침 효과)
ipcMain.handle('force-window-reset', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        // 1. 강제로 포커스 해제 (Blur)
        mainWindow.blur();

        // 2. 아주 짧은 딜레이 후 다시 포커스 및 활성화
        setTimeout(() => {
            mainWindow.focus(); // 창 자체 포커스
            mainWindow.show();  // 확실하게 보이기

            // 3. 웹 콘텐츠(HTML) 내부에도 포커스 신호 전달
            if (mainWindow.webContents) {
                mainWindow.webContents.focus();
            }
        }, 50); // 0.05초 딜레이 (OS가 인식할 시간 확보)
    }
});

// ============================================================
// [3] 안드로이드 IPC 핸들러 (ANDROID HANDLERS)
// ============================================================

// 3-1. 기기 연결 확인
ipcMain.handle('check-device-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return  MockData.getIosConnection();

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
        } catch (e) { /* 모델명 조회 실패 무시 */ }

        return { status: 'connected', model: model };
    } catch (err) {
        return { status: 'error', error: err.message };
    }
});

// 3-2. 스파이앱 정밀 탐지 + VT 검사
ipcMain.handle('run-scan', async () => {
    console.log('--- [Android] 정밀 분석 시작 ---');
    if (CONFIG.IS_DEV_MODE) {
        await Utils.sleep(1500);
        return MockData.getIosScanResult();
    }

    try {
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('연결된 기기가 없습니다.');
        const serial = devices[0].id;

        // [Step A] 기본 정보 수집
        const deviceInfo = await AndroidService.getDeviceInfo(serial);

        // [Step B] 앱 및 파일 데이터 수집
        const apkFiles = await AndroidService.findApkFiles(serial);
        const allApps = await AndroidService.getInstalledApps(serial);
        const networkMap = await AndroidService.getNetworkUsageMap(serial);

        // [Step C] 앱 상세 분석 (권한, 백그라운드, 네트워크 매핑)
        const processedApps = [];
        // 20개씩 끊어서 병렬 처리 (속도 최적화)
        for (let i = 0; i < allApps.length; i += 20) {
            const chunk = allApps.slice(i, i + 20);
            const results = await Promise.all(chunk.map(async (app) => {
                const [isRunningBg, permissions] = await Promise.all([
                    AndroidService.checkIsRunningBackground(serial, app.packageName),
                    AndroidService.getAppPermissions(serial, app.packageName)
                ]);
                const netStats = networkMap[app.uid] || { rx: 0, tx: 0 };

                return { ...app, isRunningBg, ...permissions, dataUsage: netStats };
            }));
            processedApps.push(...results);
        }

        // [Step D] 의심 앱 1차 필터링
        const suspiciousApps = AndroidService.filterSuspiciousApps(processedApps);

        // [Step E] VirusTotal 2차 정밀 검사
        if (suspiciousApps.length > 0 && CONFIG.VIRUSTOTAL_API_KEY !== 'your_key') {
            console.log(`🔍 VT 정밀 검사 대상: ${suspiciousApps.length}개`);
            await AndroidService.runVirusTotalCheck(serial, suspiciousApps);
        }

        return { deviceInfo, allApps: processedApps, suspiciousApps, apkFiles };

    } catch (err) {
        console.error('검사 실패:', err);
        throw err;
    }
});

// 3-3. 앱 삭제
ipcMain.handle('uninstall-app', async (event, packageName) => {
    console.log(`--- [Android] 앱 삭제 요청: ${packageName} ---`);
    if (CONFIG.IS_DEV_MODE) {
        await Utils.sleep(1000);
        return { success: true, message: "[DEV] 가상 삭제 성공" };
    }
    return await AndroidService.uninstallApp(packageName);
});

// 3-4. 권한 무력화
ipcMain.handle('neutralize-app', async (event, packageName) => {
    console.log(`--- [Android] 앱 무력화 요청: ${packageName} ---`);
    if (CONFIG.IS_DEV_MODE) {
        await Utils.sleep(1500);
        return { success: true, count: 5 };
    }
    return await AndroidService.neutralizeApp(packageName);
});

// 3-5. 아이콘 가져오기 (Google Play)
ipcMain.handle('get-app-data', async (event, packageName) => {
    // 1. 개발 모드, 패키지명 없음, 시스템 앱(android 등) 필터링
    if (CONFIG.IS_DEV_MODE || !packageName) return null;

    try {
        // 2. gplay.app 함수가 실제로 있는지 확인 (안전장치)
        if (typeof gplay.app !== 'function') {
            console.error('[Error] gplay.app 함수를 찾을 수 없습니다. gplay 객체:', gplay);
            return null; // 함수가 없으면 null 반환하여 멈춤 방지
        }

        // 3. 한국 스토어 기준으로 검색
        const appData = await gplay.app({
            appId: packageName,
            lang: 'ko',
            country: 'kr'
        });

        return {
            icon: appData.icon,
            title: appData.title
        };

    } catch (err) {
        // 404(앱 없음)가 아닌 다른 에러만 로그 출력
        if (err.status !== 404) {
            console.warn(`[Icon Fetch Fail] ${packageName}:`, err.message);
        }
        return null;
    }
});


// ============================================================
// [4] iOS IPC 핸들러 (iOS HANDLERS)
// ============================================================

// 4-1. iOS 연결 확인
ipcMain.handle('check-ios-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosConnection();

    return new Promise((resolve) => {
        const cmd = `"${CONFIG.PATHS.IOS_ID}" -l`;
        console.log(`[iOS] 연결 확인 실행: ${cmd}`);

        exec(cmd, (error, stdout) => {
            if (error) {
                if (!fs.existsSync(CONFIG.PATHS.IOS_ID)) {
                    resolve({ status: 'error', error: `도구 없음: ${CONFIG.PATHS.IOS_ID}` });
                } else {
                    resolve({ status: 'error', error: "iOS 도구 실행 오류" });
                }
                return;
            }
            const udid = stdout.trim();
            if (udid.length > 0) {
                exec(`"${CONFIG.PATHS.IOS_INFO}" -k DeviceName`, (err, nameOut) => {
                    const modelName = nameOut ? nameOut.trim() : 'iPhone Device';
                    resolve({ status: 'connected', model: modelName, udid: udid, type: 'ios' });
                });
            } else {
                resolve({ status: 'disconnected' });
            }
        });
    });
});

// =========================================================
// [Helper] iOS 기기 정보 추출 함수 (ideviceinfo + plist 파싱)
// =========================================================
async function getIosDeviceInfo(udid) {
    console.log(`[iOS] 기기 정보 조회 시도... (UDID: ${udid})`);

    let info = {
        model: 'iPhone (Unknown)',
        serial: udid,
        phoneNumber: '-',
        isRooted: false,
        os: 'iOS'
    };

    try {
        // 1. ideviceinfo 명령어로 하드웨어 정보 조회
        // (idevicebackup2가 있는 폴더에 ideviceinfo도 같이 있어야 함)
        const cmd = `ideviceinfo -u ${udid}`;
        const output = await Utils.runCommand(cmd); // Utils.runCommand가 stdout을 반환한다고 가정

        // 결과 파싱 (Key: Value 형태)
        const rawMap = {};
        output.split('\n').forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join(':').trim();
                rawMap[key] = val;
            }
        });

        // 2. 모델명 매핑 (ProductType -> 사람이 읽는 이름)
        const modelMap = {
            'iPhone10,3': 'iPhone X', 'iPhone10,6': 'iPhone X',
            'iPhone11,2': 'iPhone XS', 'iPhone11,4': 'iPhone XS Max', 'iPhone11,6': 'iPhone XS Max',
            'iPhone11,8': 'iPhone XR',
            'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max',
            'iPhone12,8': 'iPhone SE (2nd)',
            'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12',
            'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
            'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13',
            'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
            'iPhone14,6': 'iPhone SE (3rd)',
            'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
            'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
            'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
            'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
            // 최신 기종이 없으면 ProductType(예: iPhone17,1) 그대로 표시됨
        };

        const pType = rawMap['ProductType'];
        if (pType) info.model = modelMap[pType] || pType;

        if (rawMap['SerialNumber']) info.serial = rawMap['SerialNumber'];
        if (rawMap['PhoneNumber']) info.phoneNumber = rawMap['PhoneNumber'];
        if (rawMap['ProductVersion']) info.os = `iOS ${rawMap['ProductVersion']}`;

    } catch (e) {
        console.warn(`⚠️ [iOS] ideviceinfo 실행 실패: ${e.message}`);
        // 실패해도 멈추지 않고 기본값(Unknown)으로 진행
    }

    return info;
}

// =========================================================
// [Main Handler] iOS 검사 실행 (기기정보 -> 백업 -> MVT -> 결과)
// =========================================================
ipcMain.handle('run-ios-scan', async (event, udid) => {
    console.log(`--- [iOS] 정밀 분석 시작 (UDID: ${udid}) ---`);
    if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();

    const { TEMP_BACKUP, MVT_RESULT, IOS_BACKUP } = CONFIG.PATHS;

    try {
        // [Step 1] 기기 정보 먼저 가져오기 (백업 전에 수행해야 함)
        const deviceInfo = await getIosDeviceInfo(udid);
        console.log(`✅ [iOS] 기기 정보 획득: ${deviceInfo.model} (${deviceInfo.serial})`);

        // [Step 2] 폴더 초기화
        Utils.cleanDirectory(MVT_RESULT);
        if (!fs.existsSync(MVT_RESULT)) fs.mkdirSync(MVT_RESULT);
        if (!fs.existsSync(TEMP_BACKUP)) fs.mkdirSync(TEMP_BACKUP);

        const specificBackupPath = path.join(TEMP_BACKUP, udid);
        const isBackupExists = fs.existsSync(path.join(specificBackupPath, 'Info.plist')) ||
            fs.existsSync(path.join(specificBackupPath, 'Status.plist'));

        // [Step 3] 백업 수행 (없으면 새로, 있으면 패스)
        if (isBackupExists) {
            console.log(`[iOS] 기존 백업 발견됨. 백업 과정을 건너뜁니다.`);

            // (보완) 만약 ideviceinfo가 실패해서 전화번호가 '-'라면, 
            // 백업 폴더 내의 Info.plist에서 한 번 더 찾아볼 수 있습니다.
            if (deviceInfo.phoneNumber === '-') {
                try {
                    const plistContent = fs.readFileSync(path.join(specificBackupPath, 'Info.plist'), 'utf8');
                    // 정규식으로 간단히 전화번호 패턴 찾기 (XML 파싱 대신)
                    const phoneMatch = plistContent.match(/<key>PhoneNumber<\/key>\s*<string>(.*?)<\/string>/);
                    if (phoneMatch && phoneMatch[1]) {
                        deviceInfo.phoneNumber = phoneMatch[1];
                        console.log(`✅ [iOS] 백업 파일에서 전화번호 추가 확보: ${deviceInfo.phoneNumber}`);
                    }
                } catch (err) { }
            }

        } else {
            console.log('[iOS] 기존 백업 없음. 새 백업 시작...');
            Utils.cleanDirectory(specificBackupPath);
            // idevicebackup2 실행
            await Utils.runCommand(`"${IOS_BACKUP}" backup --full "${TEMP_BACKUP}" -u ${udid}`);
            console.log('[iOS] 백업 완료.');
        }

        // [Step 4] MVT 분석 실행
        console.log('3. MVT 분석 시작...');
        const userHome = os.homedir();
        const mvtPathLocal = path.join(userHome, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'mvt-ios.exe');
        const mvtPathRoaming = path.join(userHome, 'AppData', 'Roaming', 'Python', 'Python311', 'Scripts', 'mvt-ios.exe');

        let mvtCmd = `mvt-ios`;
        if (fs.existsSync(mvtPathLocal)) mvtCmd = `"${mvtPathLocal}"`;
        else if (fs.existsSync(mvtPathRoaming)) mvtCmd = `"${mvtPathRoaming}"`;

        const finalCmd = `${mvtCmd} check-backup --output "${MVT_RESULT}" "${specificBackupPath}"`;

        // MVT 실행 (에러 나도 결과 파일만 있으면 되므로 try-catch)
        try { await Utils.runCommand(finalCmd); } catch (e) { console.warn("MVT 실행 중 경고(무시가능):", e.message); }

        // [Step 5] 결과 파싱
        const results = IosService.parseMvtResults(MVT_RESULT);

        console.log('[iOS] 전체 프로세스 완료. 결과 반환.');
        return results;

    } catch (err) {
        console.error('iOS 검사 실패:', err);

        let userMsg = err.message;
        if (err.message.includes('not recognized') || err.message.includes('ideviceinfo')) {
            userMsg = "필수 드라이버(iTunes/idevice) 또는 분석 도구가 설치되지 않았습니다.";
        } else if (err.message.includes('python')) {
            userMsg = "Python 또는 MVT가 설치되지 않았습니다.";
        }

        return { error: userMsg };
    }
});

// ============================================================
// [5] 안드로이드 서비스 로직 (ANDROID SERVICE LOGIC)
// ============================================================
const AndroidService = {
    // 기기 정보 가져오기
    async getDeviceInfo(serial) {
        const modelCmd = await client.shell(serial, 'getprop ro.product.model');
        const model = (await adb.util.readAll(modelCmd)).toString().trim();

        let isRooted = false;
        try {
            const rootCmd = await client.shell(serial, 'which su');
            if ((await adb.util.readAll(rootCmd)).toString().trim().length > 0) isRooted = true;
        } catch (e) { }

        let phoneNumber = '알 수 없음';
        try {
            const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
            const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
            if (phoneOut.includes('Line 1 Number')) phoneNumber = phoneOut;
        } catch (e) { }

        return { model, serial, isRooted, phoneNumber };
    },

    // 앱 삭제 (Disable -> Uninstall)
    async uninstallApp(packageName) {
        try {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 끊김');
            const serial = devices[0].id;

            // 1차: 비활성화
            const disableCmd = await client.shell(serial, `pm disable-user --user 0 ${packageName}`);
            const disableOutput = (await adb.util.readAll(disableCmd)).toString().trim();

            if (disableOutput.includes('new state: disabled') || disableOutput.includes('new state: default')) {
                // 2차: 삭제
                try {
                    await client.uninstall(serial, packageName);
                    return { success: true, message: "앱이 완전히 삭제되었습니다." };
                } catch (e) { console.warn('삭제 실패'); }
            } else {
                throw new Error("기기 관리자 권한 등으로 인해 차단됨.");
            }
        } catch (err) {
            console.error('최종 실패:', err);
            return { success: false, error: err.message };
        }
    },

    // 앱 무력화 (권한 박탈 + 강제 종료) 
    async neutralizeApp(packageName) {
        try {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 끊김');
            const serial = devices[0].id;

            // 권한 조회
            const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
            const dumpStr = (await adb.util.readAll(dumpOutput)).toString();

            const grantedPerms = [];
            const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
            let match;
            while ((match = regex.exec(dumpStr)) !== null) {
                grantedPerms.push(`android.permission.${match[1]}`);
            }

            // 권한 박탈
            let revokedCount = 0;
            for (const perm of grantedPerms) {
                try {
                    await client.shell(serial, `pm revoke ${packageName} ${perm}`);
                    revokedCount++;
                } catch (e) { }
            }
            // 강제 종료
            await client.shell(serial, `am force-stop ${packageName}`);
            return { success: true, count: revokedCount };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },

    // 설치된 앱 목록 (시스템 앱 필터링 강화 버전)
    async getInstalledApps(serial) {
        const sysOutput = await client.shell(serial, 'pm list packages -s');
        const sysData = await adb.util.readAll(sysOutput);
        const systemPackages = new Set(sysData.toString().trim().split('\n').map(l => l.replace('package:', '').trim()));

        const output = await client.shell(serial, 'pm list packages -i -f -U');
        const data = await adb.util.readAll(output);
        const lines = data.toString().trim().split('\n');

        const TRUSTED_INSTALLERS = [
            'com.android.vending', 'com.sec.android.app.samsungapps', 'com.skt.skaf.A000Z00040',
            'com.kt.olleh.storefront', 'com.lguplus.appstore', 'com.google.android.feedback'
        ];

        return lines.map((line) => {
            if (!line) return null;
            // format: package:/path=com.name uid:1000 installer=com.foo
            const parts = line.split(/\s+/);
            let packageName = '', apkPath = 'N/A', installer = null, uid = null;

            parts.forEach(part => {
                if (part.includes('=')) {
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
                    uid = part.replace('uid:', '');
                }
            });

            if (!packageName) return null;

            let isSideloaded = true;
            if (systemPackages.has(packageName)) isSideloaded = false;
            else if (installer && TRUSTED_INSTALLERS.includes(installer)) isSideloaded = false;

            return { packageName, apkPath, installer, isSideloaded, uid };
        }).filter(item => item !== null);
    },

    // 백그라운드 실행 여부 확인
    async checkIsRunningBackground(serial, packageName) {
        try {
            const output = await client.shell(serial, `dumpsys activity services ${packageName}`);
            const data = (await adb.util.readAll(output)).toString();
            return !data.includes('(nothing)') && data.length > 0;
        } catch (e) { return false; }
    },

    // 권한 상세 분석 
    async getAppPermissions(serial, packageName) {
        try {
            const output = await client.shell(serial, `dumpsys package ${packageName}`);
            const dumpsys = (await adb.util.readAll(output)).toString();

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

            return {
                allPermissionsGranted: requestedPerms.size > 0 && [...requestedPerms].every(p => grantedPerms.has(p)),
                requestedList: Array.from(requestedPerms),
                grantedList: Array.from(grantedPerms),
                requestedCount: requestedPerms.size,
                grantedCount: grantedPerms.size,
            };
        } catch (e) {
            return { allPermissionsGranted: false, requestedList: [], grantedList: [], requestedCount: 0, grantedCount: 0 };
        }
    },

    // 네트워크 사용량 (UID 기반)
    async getNetworkUsageMap(serial) {
        const usageMap = {};
        try {
            const output = await client.shell(serial, 'dumpsys netstats detail');
            const data = (await adb.util.readAll(output)).toString();
            data.split('\n').forEach(line => {
                if (line.includes('uid=') && line.includes('rxBytes=')) {
                    const parts = line.trim().split(/\s+/);
                    let uid = null, rx = 0, tx = 0;
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
        } catch (e) { console.error('네트워크 통계 수집 실패:', e); }
        return usageMap;
    },

    // APK 파일 검색
    async findApkFiles(serial) {
        try {
            const output = await client.shell(serial, 'find /sdcard -name "*.apk"');
            const data = (await adb.util.readAll(output)).toString();
            return data.trim().split('\n').filter(l => l.length > 0 && l.endsWith('.apk'));
        } catch (e) { return []; }
    },

    // 의심 앱 필터링 로직
    filterSuspiciousApps(apps) {
        const SENSITIVE = [
            'android.permission.RECORD_AUDIO', 'android.permission.READ_CONTACTS',
            'android.permission.ACCESS_FINE_LOCATION', 'android.permission.READ_PHONE_STATE',
            'android.permission.CALL_PHONE', 'android.permission.CAMERA',
            'android.permission.READ_CALL_LOG', 'android.permission.READ_SMS',
            'android.permission.RECEIVE_SMS', 'android.permission.SEND_SMS',
            'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.BIND_DEVICE_ADMIN',
            'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
        ];
        const ALARM = ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM', 'com.android.alarm.permission.SET_ALARM'];
        const SAFE_PREFIX = ['com.samsung.', 'com.sec.', 'com.qualcomm.', 'com.sktelecom.', 'com.kt.', 'com.lgu.', 'uplus.', 'lgt.', 'com.facebook.', 'com.instagram.', 'com.twitter.', 'com.kakao.', 'jp.naver.'];

        return apps.filter(app => {
            if (SAFE_PREFIX.some(p => app.packageName.startsWith(p))) return false;
            if (!app.isSideloaded) return false;

            const perms = app.requestedList || [];
            const hasSensitive = perms.some(p => SENSITIVE.includes(p));
            const hasAlarm = perms.some(p => ALARM.includes(p));

            if (hasSensitive && !hasAlarm) {
                const caught = perms.filter(p => SENSITIVE.includes(p));
                const shortNames = caught.map(p => p.split('.').pop()).slice(0, 3);
                app.reason = `행동 탐지: 외부 설치 + [${shortNames.join(', ')}...]`;
                return true;
            }
            return false;
        });
    },

    // VirusTotal 검사 로직
    async runVirusTotalCheck(serial, suspiciousApps) {
        for (const app of suspiciousApps) {
            try {
                if (!app.apkPath || app.apkPath === 'N/A') continue;
                const tempPath = path.join(os.tmpdir(), `${app.packageName}.apk`);

                // 다운로드
                const transfer = await client.pull(serial, app.apkPath);
                await new Promise((resolve, reject) => {
                    const fn = fs.createWriteStream(tempPath);
                    transfer.on('end', () => fn.end());
                    transfer.on('error', reject);
                    fn.on('finish', resolve);
                    transfer.pipe(fn);
                });

                // 해시 계산
                const fileBuffer = fs.readFileSync(tempPath);
                const hashSum = crypto.createHash('sha256');
                hashSum.update(fileBuffer);
                const sha256 = hashSum.digest('hex');
                console.log(`[VT] 해시(${app.packageName}): ${sha256}`);

                // API 조회
                const vtResult = await Utils.checkVirusTotal(sha256);
                app.vtResult = vtResult;

                if (vtResult && vtResult.malicious > 0) {
                    app.reason = `[VT 확진] 악성(${vtResult.malicious}/${vtResult.total}) + ` + app.reason;
                } else if (vtResult && vtResult.not_found) {
                    app.reason = `[VT 미확인] 신종 의심 + ` + app.reason;
                }
                fs.unlinkSync(tempPath);
            } catch (e) {
                console.error(`VT 검사 오류 (${app.packageName})`);
                app.vtResult = { error: "검사 불가" };
            }
        }
    }
};

// ============================================================
// [6] iOS 서비스 로직 (iOS SERVICE LOGIC)
// ============================================================

const IosService = {

    decodeUnicode(str) {
        if (!str) return '';
        // JSON 파서가 이미 대부분의 이스케이프 시퀀스를 처리하지만,
        // JSON.parse()가 아닌 파일 읽기 후 직접 처리할 경우를 대비하여 함수 정의
        try {
            return JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
        } catch (e) {
            return str; // 파싱 실패 시 원본 문자열 반환
        }
    },

    // 인자로 받은 fallbackDeviceInfo를 사용하여 초기화
    parseMvtResults(outputDir, fallbackDeviceInfo) {
        const findings = [];
        let fileCount = 0;

        // 1. 기기 정보 초기화 (변수명: finalDeviceInfo)
        let finalDeviceInfo = fallbackDeviceInfo || {
            model: 'iPhone (Unknown)', serial: '-', phoneNumber: '-', os: 'iOS', isRooted: false
        };

        // -------------------------------------------------
        // [A] backup_info.json 읽기 (기기 정보 갱신)
        // -------------------------------------------------
        const infoFilePath = path.join(outputDir, 'backup_info.json');

        if (fs.existsSync(infoFilePath)) {
            try {
                const content = fs.readFileSync(infoFilePath, 'utf-8');
                const infoJson = JSON.parse(content);

                console.log('📂 [iOS] backup_info.json 로드 성공');

                // 모델명 매핑
                const modelMap = {
                    'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
                    'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13',
                    'iPhone14,6': 'iPhone SE (3rd)',
                    'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
                    'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
                    'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
                    'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
                    'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max',
                    'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus'
                };

                const pType = infoJson['Product Type'];
                const friendlyModel = modelMap[pType] || infoJson['Product Name'] || pType || 'iPhone';

                // 정보 갱신 (finalDeviceInfo 업데이트)
                finalDeviceInfo = {
                    model: friendlyModel,
                    serial: infoJson['Serial Number'] || infoJson['IMEI'] || finalDeviceInfo.serial,
                    phoneNumber: infoJson['Phone Number'] || finalDeviceInfo.phoneNumber,
                    os: infoJson['Product Version'] ? `iOS ${infoJson['Product Version']}` : finalDeviceInfo.os,
                    isRooted: false
                };

                console.log(`✅ [iOS] 기기 정보: ${finalDeviceInfo.model} / ${finalDeviceInfo.phoneNumber}`);

            } catch (e) {
                console.warn(`⚠️ [iOS] 기기 정보 파싱 실패: ${e.message}`);
            }
        }

        // -------------------------------------------------
        // [B] 위협 데이터 파싱 (detected.json 등)
        // -------------------------------------------------
        const targetFiles = ['detected.json', 'suspicious_processes.json', 'suspicious_files.json'];

        targetFiles.forEach(fileName => {
            const filePath = path.join(outputDir, fileName);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    if (content && content.trim()) {
                        let items = [];
                        try {
                            const parsed = JSON.parse(content);
                            items = Array.isArray(parsed) ? parsed : [parsed];
                        } catch (e) {
                            content.trim().split('\n').forEach(line => {
                                try { if (line.trim()) items.push(JSON.parse(line)); } catch (err) { }
                            });
                        }
                        items.forEach(item => {
                            item.source_file = fileName;
                            findings.push(item);
                        });
                        fileCount++;
                    }
                } catch (err) { }
            }
        });

        // -------------------------------------------------
        // 💡 [C] 설치된 앱 목록 추출 (applications.json 파싱) 💡
        // -------------------------------------------------
        const installedApps = [];
        const appsFilePath = path.join(outputDir, 'applications.json');

        if (fs.existsSync(appsFilePath)) {
            try {
                const appContent = fs.readFileSync(appsFilePath, 'utf-8');
                let rawApps = [];

                // 1. **[시도 1: 단일 JSON 배열]** 파일 전체를 하나의 JSON 객체로 파싱 시도 (가장 일반적인 웹 JSON 포맷)
                try {
                    const parsedJson = JSON.parse(appContent);
                    if (Array.isArray(parsedJson)) {
                        rawApps = parsedJson;
                        console.log('✅ [iOS] applications.json: 단일 JSON 배열로 성공적으로 파싱됨.');
                    } else {
                        // 배열이 아니면, JSON Lines 시도를 위해 에러를 발생시키지 않고 넘어갑니다.
                        throw new Error("Not an array");
                    }
                } catch (e) {
                    // 2. **[시도 2: JSON Lines]** 단일 배열 파싱 실패 시, 줄 단위로 파싱 시도
                    console.log('🔄 [iOS] applications.json: 단일 배열 파싱 실패. JSON Lines로 재시도.');
                    const lines = appContent.trim().split('\n').filter(line => line.trim().length > 0);

                    lines.forEach(line => {
                        try {
                            rawApps.push(JSON.parse(line));
                        } catch (e) {
                            // ★★★ 이 줄에서 발생하는 오류 로그를 콘솔에만 찍고 건너뜁니다.
                            // 이 부분이 기존에 수많은 에러 로그를 발생시키던 부분입니다.
                            // console.warn(`⚠️ [iOS] applications.json 줄 파싱 실패 (JSON 에러): ${e.message}`);
                        }
                    });
                }

                // 3. 파싱된 rawApps 배열을 표준 형식으로 변환
                rawApps.forEach(appData => {
                    const bundleId = appData.softwareVersionBundleId || appData.name;
                    const itemName = appData.itemName || appData.title;

                    if (bundleId) {
                        const decodedName = this.decodeUnicode(itemName);

                        installedApps.push({
                            packageName: bundleId,
                            cachedTitle: decodedName || Utils.formatAppName(bundleId),
                            installer: appData.sourceApp || 'AppStore'
                        });
                    }
                });

                console.log(`✅ [iOS] 설치된 앱 목록 ${installedApps.length}개 획득 완료.`);

            } catch (e) {
                console.error(`❌ [iOS] applications.json 파일 읽기/처리 최종 실패: ${e.message}`);
            }
        } else {
            console.warn(`⚠️ [iOS] 앱 목록 파일(applications.json)을 찾을 수 없습니다.`);
        }

        console.log(`[IosService] 파싱 완료. 위협: ${findings.length}건`);

        const mvtResults = {
            web: { name: '웹 브라우징 데이터 검사', files: ['Safari History', 'Chrome Bookmarks'], findings: [] },
            messages: { name: '메시지 및 통화 기록 검사', files: ['SMS/iMessage DB', 'Call History'], findings: [] },
            system: { name: '시스템 파일 및 설정 검사', files: ['Configuration Files', 'Log Files'], findings: [] },
            appData: { name: '설치된 앱 데이터베이스 검사', files: ['Manifest.db', 'App Sandboxes'], findings: [] },
            ioc: { name: '위협 인디케이터 검사', files: ['Detected IOCs'], findings: [] },
        };

        return {
            deviceInfo: finalDeviceInfo,
            suspiciousItems: findings,
            allApps: installedApps,
            fileCount: fileCount,
            mvtResults: mvtResults
        };
    }
};

// ============================================================
// [7] 유틸리티 함수 (UTILITIES)
// ============================================================
const Utils = {
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),

    formatAppName(bundleId) {
        if (!bundleId) return "Unknown";
        const parts = bundleId.split('.');
        let name = parts[parts.length - 1];
        return name.charAt(0).toUpperCase() + name.slice(1);
    },

    // VirusTotal API 호출
    async checkVirusTotal(fileHash) {
        try {
            const response = await axios.get(`https://www.virustotal.com/api/v3/files/${fileHash}`, {
                headers: { 'x-apikey': CONFIG.VIRUSTOTAL_API_KEY }
            });
            const stats = response.data.data.attributes.last_analysis_stats;
            return {
                malicious: stats.malicious,
                suspicious: stats.suspicious,
                total: stats.malicious + stats.suspicious + stats.harmless + stats.undetected
            };
        } catch (error) {
            if (error.response && error.response.status === 404) return { not_found: true };
            return null;
        }
    },

    // 명령어 실행 (Promise 래퍼)
    runCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`명령어 실패: ${command}\n${stderr}`);
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    },

    // 폴더 삭제
    cleanDirectory(dirPath) {
        try {
            if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
        } catch (e) { console.warn(`폴더 삭제 실패 (${dirPath}):`, e.message); }
    }
};

// ============================================================
// [8] 테스트용 가짜 데이터 (MOCK DATA)
// ============================================================
const MockData = {
    getAndroid() {
        const SENSITIVE_PERMISSIONS = [
            'android.permission.RECORD_AUDIO', 'android.permission.READ_CONTACTS',
            'android.permission.ACCESS_FINE_LOCATION', 'android.permission.READ_SMS',
            'android.permission.SEND_SMS', 'android.permission.CAMERA', 'android.permission.BIND_DEVICE_ADMIN',
            'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
        ];
        const ALARM_PERMISSIONS = ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM'];

        const mockApps = [
            {
                packageName: 'com.kakao.talk', isSideloaded: false, isRunningBg: true,
                dataUsage: { rx: 1024 * 1024 * 150, tx: 1024 * 1024 * 50 },
                allPermissionsGranted: true, requestedCount: 25, grantedCount: 25,
                requestedList: ['android.permission.INTERNET'], grantedList: ['android.permission.INTERNET']
            },
            {
                packageName: 'com.android.system.service.update', isSideloaded: true, isRunningBg: true,
                dataUsage: { rx: 1024 * 100, tx: 1024 * 1024 * 500 },
                allPermissionsGranted: true, requestedCount: 50, grantedCount: 50,
                requestedList: [...SENSITIVE_PERMISSIONS], grantedList: [...SENSITIVE_PERMISSIONS]
            }
        ];

        const suspiciousApps = mockApps.filter(app => {
            if (!app.isSideloaded || !app.isRunningBg) return false;
            const perms = app.requestedList || [];
            if (perms.some(p => SENSITIVE_PERMISSIONS.includes(p)) && !perms.some(p => ALARM_PERMISSIONS.includes(p))) {
                app.reason = `탐지: 외부 설치됨 + [Sensitive...]`;
                return true;
            }
            return false;
        });

        return {
            deviceInfo: { model: 'Galaxy S24 Ultra (MOCK)', serial: 'TEST-1234', isRooted: true, phoneNumber: '010-1234-5678' },
            allApps: mockApps, suspiciousApps: suspiciousApps, apkFiles: ['/sdcard/Download/spyware.apk']
        };
    },

    getIosConnection() {
        return { status: 'connected', model: 'iPhone 15 Pro (TEST)', udid: '00008101-001E30590C000000', type: 'ios' };
    },

    getIosScanResult() {
        const installedApps = [
            { packageName: 'com.apple.camera', cachedTitle: '카메라' },
            { packageName: 'com.google.Gmail', cachedTitle: 'Gmail' },
            { packageName: 'com.lguplus.aicallagent', cachedTitle: '익시오' },
            { packageName: 'com.apple.weather', cachedTitle: '날씨' },
            { packageName: 'net.whatsapp.WhatsApp', cachedTitle: 'WhatsApp' },
            { packageName: 'com.spyware.agent.hidden', cachedTitle: '시스템 서비스' }, // 의도적으로 의심 앱 추가
            { packageName: 'com.naver.map', cachedTitle: '네이버 지도' }, // 앱 목록 보강
            { packageName: 'com.tistory.blog', cachedTitle: '티스토리' },
            { packageName: 'com.google.youtube', cachedTitle: 'YouTube' },
            { packageName: 'com.kakaobank.bank', cachedTitle: '카카오뱅크' },
        ];
        
        // MVT 분석 결과 (suspiciousItems)를 렌더러가 기대하는 형식에 맞게 변환해야 합니다.
        // MVT는 suspiciousItems를 반환하고, renderer는 Utils.transformIosData를 통해
        // suspiciousApps와 mvtResults를 분리합니다.

        return {
            deviceInfo: { 
                model: 'iPhone 16 Pro (MOCK)', 
                serial: 'IOS-TEST-UDID', 
                phoneNumber: '+82 10-9999-0000',
                os: 'iOS 17.4' 
            },
            
            // 💡 1. MVT의 원본 탐지 결과 (suspiciousItems는 findings에 해당)
            //    이 데이터가 renderer.js의 Utils.transformIosData에서 suspiciousApps로 매핑됩니다.
            suspiciousItems: [
                { module: 'SMS', check_name: 'iMessage Link IOC', description: '악성 도메인 접속 유도 링크 수신', path: '/private/var/mobile/Library/SMS/sms.db', sha256: 'a1b2c3d4...' },
                { module: 'WebKit', check_name: 'Browser History IOC', description: 'Safari에서 C2 서버 도메인 접속 흔적 발견', path: '/private/var/mobile/Library/WebKit', sha256: 'e5f6g7h8...' },
                { module: 'Process', check_name: 'Suspicious Process', description: '비정상적인 이름의 백그라운드 프로세스 활동', path: 'com.apple.bh', sha256: 'i9j0k1l2...' },
            ],
            
            // 💡 2. MVT 5대 영역 분류 결과 (renderer가 기대하는 구조)
            mvtResults: {
                web: { status: 'warning', warnings: ['악성 URL 접속 흔적: hxxp://c2-server.com', 'Safari 캐시에서 비정상 파일 발견'] },
                messages: { status: 'warning', warnings: ['악성 도메인 접속 유도 링크 수신'] },
                system: { status: 'warning', warnings: ['비정상적인 이름의 백그라운드 프로세스 활동', '의심스러운 Crash Report 발견'] },
                apps: { status: 'safe', warnings: [] },
                artifacts: { status: 'safe', warnings: [] }
            },
            
            // 💡 3. 설치된 앱 목록 (renderer.js의 allApps로 최종 전달됨)
            allApps: installedApps,
            apkFiles: [], // iOS에서는 APK 없음
        };
    },

};