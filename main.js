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
    IS_DEV_MODE: false,
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
    if (CONFIG.IS_DEV_MODE) return { status: 'connected', model: 'Galaxy S24 (TEST)' };
    
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
        return MockData.getAndroid();
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
        if (suspiciousApps.length > 0 && CONFIG.VIRUSTOTAL_API_KEY !== 'YOUR_KEY') {
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

// 4-2. iOS 정밀 검사 (MVT)
ipcMain.handle('run-ios-scan', async (event, udid) => {
    console.log(`--- [iOS] 정밀 분석 시작 (UDID: ${udid}) ---`);
    if (CONFIG.IS_DEV_MODE) return MockData.getIosScanResult();

    const { TEMP_BACKUP, MVT_RESULT, IOS_BACKUP } = CONFIG.PATHS;

    try {
        // 1. 결과 폴더는 매번 초기화 (분석 결과는 새로 써야 하므로)
        Utils.cleanDirectory(MVT_RESULT);
        if (!fs.existsSync(MVT_RESULT)) fs.mkdirSync(MVT_RESULT);

        // 2. 백업 폴더 확인 로직
        // idevicebackup2는 TEMP_BACKUP 폴더 안에 'udid' 이름으로 폴더를 만듭니다.
        const specificBackupPath = path.join(TEMP_BACKUP, udid);
        const isBackupExists = fs.existsSync(path.join(specificBackupPath, 'Info.plist'));

        if (!fs.existsSync(TEMP_BACKUP)) {
            fs.mkdirSync(TEMP_BACKUP);
        }

        if (isBackupExists) {
            // [A] 백업이 이미 있는 경우 -> 백업 생략
            console.log(`[iOS] 기존 백업 발견됨 (${udid}). 백업 과정을 건너뛰고 분석을 시작합니다.`);
            // (선택사항) 여기서 사용자에게 "기존 백업으로 분석합니다"라고 알림을 보낼 수도 있습니다.
        } else {
            // [B] 백업이 없는 경우 -> 백업 실행
            console.log('[iOS] 기존 백업 없음. 새 백업을 시작합니다...');
            // 기존 폴더가 애매하게 남아있을 수 있으니 해당 UDID 폴더만 정리
            Utils.cleanDirectory(specificBackupPath); 
            
            // 백업 명령어 실행
            await Utils.runCommand(`"${IOS_BACKUP}" backup --full "${TEMP_BACKUP}" -u ${udid}`);
            console.log('[iOS] 백업 완료.');
        }
        
        // 3. MVT 분석 실행 (경로는 TEMP_BACKUP 폴더 전체를 지정하면 MVT가 알아서 찾거나, 명시적으로 지정)
        console.log('3. MVT 분석 시작...');
        // mvt-ios check-backup은 백업 루트 폴더를 지정하면 됨
        await Utils.runCommand(`mvt-ios check-backup --output "${MVT_RESULT}" "${TEMP_BACKUP}"`);
        
        // 4. 결과 파싱
        const results = IosService.parseMvtResults(MVT_RESULT);

        // ★ 중요: 검사가 끝나도 백업 파일을 지우지 않음 (다음에 재활용하기 위해)
        // setTimeout(() => Utils.cleanDirectory(TEMP_BACKUP), 1000); 
        console.log('[iOS] 분석 완료. (백업 파일 보존됨)');

        return results;
    } catch (err) {
        console.error('iOS 검사 실패:', err);
        return { error: `iOS 검사 중 오류 발생: ${err.message}` };
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
        } catch (e) {}

        let phoneNumber = '알 수 없음';
        try {
            const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
            const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
            if (phoneOut.includes('Line 1 Number')) phoneNumber = phoneOut;
        } catch (e) {}

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
                } catch (e) {}
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
    parseMvtResults(outputDir) {
        const findings = [];
        let fileCount = 0;
        const targetFiles = ['suspicious_processes.json', 'suspicious_files.json', 'sms.json', 'safari_history.json', 'installed_apps.json'];

        targetFiles.forEach(fileName => {
            const filePath = path.join(outputDir, fileName);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const lines = content.trim().split('\n');
                    lines.forEach(line => {
                        if (line) {
                            const item = JSON.parse(line);
                            item.source_file = fileName;
                            findings.push(item);
                        }
                    });
                    fileCount++;
                } catch (e) { console.error(`파일 파싱 오류 (${fileName})`); }
            }
        });

        const allApps = [];
        const appFilePath = path.join(outputDir, 'installed_apps.json');
        if (fs.existsSync(appFilePath)) {
            try {
                fs.readFileSync(appFilePath, 'utf-8').trim().split('\n').forEach(l => { if(l) allApps.push(JSON.parse(l)); });
            } catch(e){}
        }

        return {
            deviceInfo: { model: 'iPhone', os: 'iOS' },
            suspiciousItems: findings,
            allApps: allApps,
            fileCount: fileCount
        };
    }
};

// ============================================================
// [7] 유틸리티 함수 (UTILITIES)
// ============================================================
const Utils = {
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    
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
        return {
            deviceInfo: { model: 'iPhone 15 Pro (MOCK)', os: 'iOS 17.4' },
            suspiciousItems: [
                { source_file: 'sms.json', message: 'Click: http://malware.com', sender: '+123456789' },
                { source_file: 'suspicious_processes.json', process_name: 'pegasus_agent', reason: 'Spyware' }
            ],
            allApps: [{ bundle_id: 'com.apple.camera', name: 'Camera' }]
        };
    }
};