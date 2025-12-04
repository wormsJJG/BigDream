const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto'); // 해시 계산용
const adb = require('adbkit');
const axios = require('axios'); // VT API 통신용
const gplay = require('google-play-scraper');
const { exec, spawn } = require('child_process');

// ★★★ [설정] ★★★
const IS_DEV_MODE = false;
// 여기에 VirusTotal API 키를 입력하세요.
const VIRUSTOTAL_API_KEY = '2aa1cd78a23bd4ae58db52c773d7070fd7f961acb6debcca94ba9b5746c2ec96';

const adbExecutable = os.platform() === 'win32' ? 'adb.exe' : 'adb';
const adbPath = path.join(__dirname, 'platform-tools', adbExecutable);
const client = adb.createClient({ bin: adbPath });
const iosPath = path.join(__dirname, 'ios-tools');
const ideviceIdPath = path.join(iosPath, os.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id');
const ideviceInfoPath = path.join(iosPath, os.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo');
const ideviceBackupPath = path.join(iosPath, os.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2');

function createWindow() {
    console.log('--- main.js: createWindow() 호출됨 ---');
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

// 창 리셋 핸들러
ipcMain.handle('force-window-reset', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        mainWindow.minimize();
        setTimeout(() => {
            mainWindow.restore();
            mainWindow.focus();
        }, 100);
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

// 2. 스파이앱 정밀 탐지 + VT 검사
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

        // [A] 기기 정보 수집
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
        const deviceInfo = { model, serial, isRooted, phoneNumber };

        // [B] 데이터 수집
        const apkFiles = await findApkFiles(serial);
        const allApps = await getInstalledApps(serial);
        const networkMap = await getNetworkUsageMap(serial);

        // [C] 앱 상세 분석 (아이콘 추출 제거됨)
        const processedApps = [];
        for (let i = 0; i < allApps.length; i += 20) { // 속도 향상
            const chunk = allApps.slice(i, i + 20);
            const results = await Promise.all(
                chunk.map(async (app) => {
                    const [isRunningBg, permissions] = await Promise.all([
                        checkIsRunningBackground(serial, app.packageName),
                        getAppPermissions(serial, app.packageName)
                        // ★ 아이콘 추출 로직 제거됨 ★
                    ]);
                    const netStats = networkMap[app.uid] || { rx: 0, tx: 0 };

                    return {
                        ...app,
                        isRunningBg,
                        ...permissions,
                        dataUsage: netStats
                        // icon 필드 제거됨
                    };
                })
            );
            processedApps.push(...results);
        }

        // [D] 1차 필터링
        const suspiciousApps = filterSuspiciousApps(processedApps);

        // [E] 2차 확진 (VirusTotal 검사)
        if (suspiciousApps.length > 0 && VIRUSTOTAL_API_KEY !== 'YOUR_VIRUSTOTAL_API_KEY_HERE') {
            console.log(`🔍 VT 정밀 검사 대상: ${suspiciousApps.length}개`);

            for (const app of suspiciousApps) {
                try {
                    // APK 경로 확인 및 다운로드
                    if (!app.apkPath || app.apkPath === 'N/A') continue;
                    const tempPath = path.join(os.tmpdir(), `${app.packageName}.apk`);

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
                    console.log(`[VT] 해시 계산 완료 (${app.packageName}): ${sha256}`);

                    // API 조회
                    const vtResult = await checkVirusTotal(sha256);
                    app.vtResult = vtResult;

                    // 결과 반영
                    if (vtResult && vtResult.malicious > 0) {
                        app.reason = `[VT 확진] 악성 탐지(${vtResult.malicious}/${vtResult.total}) + ` + app.reason;
                    } else if (vtResult && vtResult.not_found) {
                        app.reason = `[VT 미확인] 신종 의심 + ` + app.reason;
                    }

                    fs.unlinkSync(tempPath); // 청소

                } catch (vtError) {
                    console.error(`VT 검사 실패 (${app.packageName}):`, vtError.message);
                    app.vtResult = { error: "검사 불가" };
                }
            }
        }

        return { deviceInfo, allApps: processedApps, suspiciousApps, apkFiles };

    } catch (err) {
        console.error('검사 실패:', err);
        throw err;
    }
});

// 앱 삭제
ipcMain.handle('uninstall-app', async (event, packageName) => {
    console.log(`--- 앱 삭제/무력화 요청: ${packageName} ---`);

    // [개발 모드]
    if (IS_DEV_MODE) {
        await new Promise(r => setTimeout(r, 1000));
        return { success: true, message: "[DEV] 가상 삭제 성공" };
    }

    try {
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('기기 연결 끊김');
        const serial = devices[0].id;
        try {
            const disableCmd = await client.shell(serial, `pm disable-user --user 0 ${packageName}`);
            const disableOutput = await adb.util.readAll(disableCmd);
            const outputStr = disableOutput.toString().trim();

            // 성공 메시지가 나오면 성공 처리
            if (outputStr.includes('new state: disabled') || outputStr.includes('new state: default')) {
                try {

                    await client.uninstall(serial, packageName);
                    console.log("삭제성공");
                    return { success: true, message: "앱이 완전히 삭제되었습니다." };
                } catch (uninstallError) {
                    console.warn(`삭제 실패`);
                }
            } else {
                // 이것조차 실패하면 사용자가 직접 풀어야 함
                throw new Error("기기 관리자 권한 때문에 삭제 및 중지가 차단되었습니다.");
            }

        } catch (err) {
            console.error('최종 실패:', err);
            return { success: false, error: err.message };
        }
    } catch (uninstallError) {
        console.warn(`일반 삭제 실패 (${packageName}) -> 무력화 시도 진입`);
    }
});

ipcMain.handle('open-scan-file', async () => { /* 파일 열기 로직 */ });

// [main.js] 아이콘 URL 가져오기 핸들러 (구글 플레이 검색)
ipcMain.handle('get-app-icon', async (event, packageName) => {
    // 개발 모드거나 패키지명이 없으면 패스
    if (IS_DEV_MODE || !packageName) return null;

    try {
        // 구글 플레이에서 앱 정보 검색 (appId가 패키지명)
        const appData = await gplay.app({ appId: packageName });
        return appData.icon; // 아이콘 이미지 URL (인터넷 주소) 반환
    } catch (err) {
        // 스토어에 없는 앱(시스템 앱, 스파이앱 등)은 에러가 나므로 null 반환
        return null;
    }
});

// [main.js] 권한 무력화 핸들러 추가

ipcMain.handle('neutralize-app', async (event, packageName) => {
    console.log(`--- 앱 무력화 요청: ${packageName} ---`);

    if (IS_DEV_MODE) {
        await new Promise(r => setTimeout(r, 1500));
        return { success: true, count: 5 }; // 가짜: 5개 권한 박탈
    }

    try {
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('기기 연결 끊김');
        const serial = devices[0].id;

        // 1. 현재 허용된 모든 권한 가져오기 (Dangerous 권한 위주)
        const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
        const dumpData = await adb.util.readAll(dumpOutput);
        const dumpStr = dumpData.toString();

        // 정규식으로 'android.permission.XXX: granted=true' 패턴을 찾습니다.
        // (install permissions와 runtime permissions 모두 포함)
        const grantedPerms = [];
        const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
        let match;
        while ((match = regex.exec(dumpStr)) !== null) {
            grantedPerms.push(`android.permission.${match[1]}`);
        }

        console.log(`발견된 권한 수: ${grantedPerms.length}`);

        // 2. 권한 하나씩 뺏기 (Revoke)
        let revokedCount = 0;
        for (const perm of grantedPerms) {
            try {
                // pm revoke 명령어 실행
                await client.shell(serial, `pm revoke ${packageName} ${perm}`);
                revokedCount++;
            } catch (e) {
                // 일부 시스템 권한은 revoke가 안 될 수 있음 (무시하고 계속 진행)
            }
        }

        // 3. 앱 강제 종료 (권한 뺏은거 적용되게)
        await client.shell(serial, `am force-stop ${packageName}`);

        return { success: true, count: revokedCount };

    } catch (err) {
        console.error('무력화 실패:', err);
        return { success: false, error: err.message };
    }
});

// --- Helper Functions ---

// 1. 필터링 로직
function filterSuspiciousApps(apps) {
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
    const SAFE = ['com.samsung.', 'com.sec.', 'com.qualcomm.', 'com.sktelecom.', 'com.kt.', 'com.lgu.', 'uplus.', 'lgt.', 'com.facebook.', 'com.instagram.', 'com.twitter.', 'com.kakao.', 'jp.naver.'];

    return apps.filter(app => {
        if (SAFE.some(p => app.packageName.startsWith(p))) return false;
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
}

// 2. VT 조회
async function checkVirusTotal(fileHash) {
    try {
        const response = await axios.get(`https://www.virustotal.com/api/v3/files/${fileHash}`, {
            headers: { 'x-apikey': VIRUSTOTAL_API_KEY }
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
}

// 3. 앱 목록 (오탐지 방지 버전)
async function getInstalledApps(serial) {
    const sysOutput = await client.shell(serial, 'pm list packages -s');
    const sysData = await adb.util.readAll(sysOutput);
    const systemPackages = new Set(sysData.toString().trim().split('\n').map(l => l.replace('package:', '').trim()));
    const output = await client.shell(serial, 'pm list packages -i -f -U');
    const data = await adb.util.readAll(output);
    const TRUSTED = ['com.android.vending', 'com.sec.android.app.samsungapps', 'com.skt.skaf.A000Z00040', 'com.kt.olleh.storefront', 'com.lguplus.appstore', 'com.google.android.feedback'];

    return data.toString().trim().split('\n').map(line => {
        if (!line) return null;
        const parts = line.split(/\s+/);
        let pkg = '', path = '', inst = null, uid = null;
        parts.forEach(p => {
            if (p.startsWith('package:')) { const tmp = p.replace('package:', '').split('='); path = tmp[0]; pkg = tmp[1]; }
            else if (p.startsWith('installer=')) inst = p.replace('installer=', '');
            else if (p.startsWith('uid:')) uid = p.replace('uid:', '');
        });
        if (!pkg) return null;
        let side = true;
        if (systemPackages.has(pkg) || (inst && TRUSTED.includes(inst))) side = false;
        return { packageName: pkg, apkPath: path, installer: inst, isSideloaded: side, uid };
    }).filter(i => i !== null);
}

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

// ios 검사

// [main.js] 상단에 모듈 추가
// ... (기존 변수 및 함수들) ...

// ============================================================
// ★★★ [iOS] 1. 기기 연결 확인 ★★★
// ============================================================
ipcMain.handle('check-ios-connection', async () => {
    if (IS_DEV_MODE) return { status: 'connected', model: 'iPhone 15 Pro (TEST)', udid: '00008101-001E30590C000000', type: 'ios' };

    return new Promise((resolve) => {
        // idevice_id 명령어를 절대 경로로 실행
        // (경로에 공백이 있을 수 있으므로 따옴표("")로 감싸줍니다)
        const cmd = `"${ideviceIdPath}" -l`;
        
        console.log(`iOS 연결 확인 실행: ${cmd}`); // 로그로 경로 확인

        exec(cmd, (error, stdout) => {
            if (error) {
                console.error("iOS 도구 실행 실패:", error);
                // 파일이 없는지 확인
                if (!fs.existsSync(ideviceIdPath)) {
                    resolve({ status: 'error', error: `도구 없음: ios-tools 폴더에 idevice_id.exe가 없습니다.\n경로: ${ideviceIdPath}` });
                } else {
                    resolve({ status: 'error', error: "iOS 도구 실행 오류 (드라이버 문제 가능성)" });
                }
                return;
            }

            const udid = stdout.trim();
            if (udid.length > 0) {
                // 연결됨 -> 모델명 가져오기
                const infoCmd = `"${ideviceInfoPath}" -k DeviceName`;
                exec(infoCmd, (err, nameOut) => {
                    const modelName = nameOut ? nameOut.trim() : 'iPhone Device';
                    resolve({ status: 'connected', model: modelName, udid: udid, type: 'ios' });
                });
            } else {
                resolve({ status: 'disconnected' });
            }
        });
    });
});

// ============================================================
// ★★★ [iOS] 2. 정밀 검사 (백업 -> MVT 분석) ★★★
// ============================================================
ipcMain.handle('run-ios-scan', async (event, udid) => {
    console.log(`--- iOS 정밀 분석 시작 (UDID: ${udid}) ---`);
    if (IS_DEV_MODE) { /* ...가짜 데이터... */ }

    const backupDir = path.join(app.getPath('temp'), 'bd_ios_backup');
    const outputDir = path.join(app.getPath('userData'), 'mvt_results');

    try {
        if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
        if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
        fs.mkdirSync(backupDir);
        fs.mkdirSync(outputDir);

        // 1. 백업 (절대 경로 사용)
        console.log('1. 백업 시작...');
        // 명령어: "C:\...\idevicebackup2.exe" backup --full ...
        await runCommand(`"${ideviceBackupPath}" backup --full "${backupDir}" -u ${udid}`);
        
        // 2. MVT 분석 (MVT는 pip로 설치했으므로 전역 명령어로 실행)
        console.log('2. MVT 분석 시작...');
        await runCommand(`mvt-ios check-backup --output "${outputDir}" "${backupDir}"`);
        
        // ... (이후 파싱 로직 동일) ...
        const results = parseMvtResults(outputDir);
        fs.rmSync(backupDir, { recursive: true, force: true });

        return results;

    } catch (err) {
        return { error: `iOS 검사 실패: ${err.message}` };
    }
});

// [Helper] 명령어를 Promise로 실행 (await 사용 가능하게)
function runCommand(command) {
    return new Promise((resolve, reject) => {
        // 윈도우 한글 깨짐 방지 옵션 등은 상황에 맞춰 추가
        exec(command, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`명령어 실패: ${command}`);
                console.error(stderr);
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

// [Helper] MVT 결과 JSON 파싱
function parseMvtResults(outputDir) {
    const findings = [];
    let fileCount = 0;

    // MVT가 생성하는 주요 결과 파일들
    const targetFiles = [
        'suspicious_processes.json', // 의심 프로세스
        'suspicious_files.json',     // 의심 파일
        'sms.json',                  // 문자 메시지 (악성 링크 등)
        'safari_history.json',       // 접속 기록
        'installed_apps.json'        // 설치된 앱 목록
    ];

    targetFiles.forEach(fileName => {
        const filePath = path.join(outputDir, fileName);
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                // MVT 결과는 JSON Lines (줄마다 JSON)일 수 있음 -> 배열로 변환
                const lines = content.trim().split('\n');
                lines.forEach(line => {
                    if (line) {
                        const item = JSON.parse(line);
                        item.source_file = fileName; // 출처 표시
                        findings.push(item);
                    }
                });
                fileCount++;
            } catch (e) {
                console.error(`파일 파싱 오류 (${fileName}):`, e);
            }
        }
    });

    // 앱 목록은 별도로 추출
    const allApps = [];
    const appFilePath = path.join(outputDir, 'installed_apps.json');
    if (fs.existsSync(appFilePath)) {
        try {
            const content = fs.readFileSync(appFilePath, 'utf-8');
            content.trim().split('\n').forEach(l => {
                if(l) allApps.push(JSON.parse(l));
            });
        } catch(e){}
    }

    return {
        deviceInfo: { model: 'iPhone', os: 'iOS' }, // 기본 정보
        suspiciousItems: findings, // 탐지된 위협들
        allApps: allApps,          // 전체 앱 목록
        fileCount: fileCount
    };
}

// [Helper] 가짜 iOS 데이터 (개발용)
function getMockIosData() {
    return {
        deviceInfo: { model: 'iPhone 15 Pro (MOCK)', os: 'iOS 17.4' },
        suspiciousItems: [
            { source_file: 'sms.json', message: 'Click this link to win: http://malware.com', sender: '+123456789' },
            { source_file: 'suspicious_processes.json', process_name: 'pegasus_agent', reason: 'Known Spyware Signature' }
        ],
        allApps: [
            { bundle_id: 'com.apple.camera', name: 'Camera' },
            { bundle_id: 'com.kakao.talk', name: 'KakaoTalk' }
        ]
    };
}