/**
 * main.js
 * BD (Big Dream) Mobile Security Solution
 * Electron Main Process
 */

const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const adb = require('adbkit');
const axios = require('axios');
const gplayRaw = require('google-play-scraper');
const gplay = gplayRaw.default || gplayRaw;
const { exec, spawn } = require('child_process');
const { autoUpdater } = require("electron-updater");
const log = require('electron-log');
const { EventEmitter } = require('events');
const ApkReader = require('adbkit-apkreader');

const aiEvents = new EventEmitter();
aiEvents.setMaxListeners(0);

const { analyzeAppWithStaticModel } = require("./ai/aiStaticAnalyzer"); // 경로는 맞게 조정

let aiProcess = null;

// ============================================================
// [1] 환경 설정 및 상수 (CONFIGURATION)
// ============================================================

const RESOURCE_DIR = app.isPackaged ? process.resourcesPath : __dirname;

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";
autoUpdater.autoDownload = true; // 업데이트 발견 시 자동 다운로드
autoUpdater.allowPrerelease = false;

const CONFIG = {
    IS_DEV_MODE: false,
    KEEP_BACKUP: false,     // true: 백업 파일 삭제 안 함 (유지보수용) / false: 검사 후 즉각 삭제 (배포용)
    VIRUSTOTAL_API_KEY: '2aa1cd78a23bd4ae58db52c773d7070fd7f961acb6debcca94ba9b5746c2ec96',
    PATHS: {
        ADB: path.join(RESOURCE_DIR, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb'),
        IOS_TOOLS: path.join(RESOURCE_DIR, 'ios-tools'),
        IOS_ID: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id'),
        IOS_INFO: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo'),
        IOS_BACKUP: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2'),
        TEMP_BACKUP: path.join(app.getPath('userData'), 'iphone_backups'),
        MVT_RESULT: path.join(app.getPath('userData'), 'mvt_results'),
        LOGIN_CONFIG_PATH: path.join(app.getPath('userData'), 'login-info.json')
    }
};

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
    },

    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    async isMvtInstalled() {
        try {
            // mvt-ios 버전 정보를 요청하여 에러가 없으면 설치된 것으로 간주
            await this.runCommand('mvt-ios version');
            return true;
        } catch (e) {
            console.log(e)
            return false;
        }
    },

    async installMvtIfMissing(mainWindow) {
        if (await this.isMvtInstalled()) {
            console.log("✅ MVT 이미 설치되어 있음.");
            return true;
        }

        console.log("🔄 MVT 설치 시도 중...");
        const statusBox = new BrowserWindow({
            width: 400, height: 150, frame: false, parent: mainWindow, modal: true, show: false
        });
        // 상태 창 로드 (별도의 HTML 파일 필요)
        statusBox.loadFile('loading.html');
        statusBox.once('ready-to-show', () => statusBox.show());


        try {
            // 1. 필요한 Python 패키지 설치 (MVT 설치 전에 필수적으로 필요한 패키지)
            await this.runCommand('pip3 install --upgrade pip setuptools wheel');

            // 2. MVT 설치 (이 명령어는 시간이 오래 걸릴 수 있습니다.)
            // --user 플래그를 사용하여 시스템 권한 없이 현재 사용자 계정에 설치
            await this.runCommand('pip3 install mvt --user');

            console.log("✅ MVT 설치 성공.");
            statusBox.close();
            return true;

        } catch (e) {
            statusBox.close();
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'MVT 설치 실패',
                message: `MVT 설치 중 오류가 발생했습니다. 수동 설치가 필요합니다. 오류: ${e.message}`,
            });
            return false;
        }
    },

    async checkAndInstallPrerequisites(mainWindow) {
        let pythonInstalled = false;

        // 1. Python 설치 여부 확인
        try {
            await this.runCommand('python --version');
            console.log("✅ Python 설치 확인 완료.");
            pythonInstalled = true;
        } catch (e) {
            try {
                await this.runCommand('python --version');
                console.log("✅ Python 설치 확인 완료.");
                pythonInstalled = true;
            } catch (e) {
                console.log("❌ Python이 시스템에 설치되어 있지 않거나 PATH에 없습니다.");
            }
        }

        if (!pythonInstalled) {
            // 2. Python이 없을 경우, 설치 안내 메시지 박스 표시
            const dialogResult = await dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: '필수 프로그램 설치 안내',
                message: 'MVT 분석을 위해 Python 3.9 이상이 필요합니다.\n\n[예]를 누르면 공식 다운로드 페이지로 이동합니다.',
                buttons: ['예 (설치 페이지 열기)', '아니오 (계속 진행)']
            });

            if (dialogResult.response === 0) {
                require('electron').shell.openExternal('https://www.python.org/downloads/windows/');
            }
            return false;
        }

        // 3. Python이 설치되어 있다면 MVT 설치 단계로 이동
        return await this.installMvtIfMissing(mainWindow);
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
            devTools: true,
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
}

function sendStatusToWindow(channel, data) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
        mainWindow.webContents.send(channel, data);
    }
}

autoUpdater.on('checking-for-update', () => { log.info('업데이트 확인 중...'); });
autoUpdater.on('update-available', (info) => {
    log.info('업데이트 가능');
    sendStatusToWindow('update-start', info.version)
});
autoUpdater.on('update-not-available', (info) => { log.info('최신 버전임'); });
autoUpdater.on('error', (err) => {
    log.info('에러 발생: ' + err);
    sendStatusToWindow('update-error', err.message)
});
autoUpdater.on('download-progress', (progressObj) => {
    log.info(`다운로드 중: ${progressObj.percent}%`);

    sendStatusToWindow('update-progress', {
        percent: Math.floor(progressObj.percent),
        bytesPerSecond: Utils.formatBytes(progressObj.bytesPerSecond) + '/s',
        transferred: Utils.formatBytes(progressObj.transferred),
        total: Utils.formatBytes(progressObj.total)
    });
});
autoUpdater.on('update-downloaded', (info) => {
    log.info('다운로드 완료. 앱을 재시작하여 업데이트를 적용합니다.');
    autoUpdater.quitAndInstall();
});

app.whenReady().then(async () => {
    createWindow();
    const mainWindow = BrowserWindow.getAllWindows()[0];
    await Utils.checkAndInstallPrerequisites(mainWindow);
    await autoUpdater.checkForUpdatesAndNotify();
}).catch(err => {
    console.log(err)
});

app.on('window-all-closed', () => {
    app.quit();
})

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
    if (CONFIG.IS_DEV_MODE) return MockData.getAndroidConnection();

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

// ============================================================
// 3-2. 스파이앱 정밀 탐지 + VT 검사
// ============================================================
ipcMain.handle('run-scan', async () => {
    console.log('--- AI 정밀 분석 시작 ---');
    // “강한 악용 신호” (권한이 아니라 “실제 활성/상태”)

    try {
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('기기 없음');
        const serial = devices[0].id;

        const deviceInfo = await AndroidService.getDeviceInfo(serial);
        deviceInfo.os = 'ANDROID';

        // 기초 데이터 수집
        const allApps = await AndroidService.getInstalledApps(serial);
        const apkFiles = await AndroidService.findApkFiles(serial);
        const networkMap = await AndroidService.getNetworkUsageMap(serial);

        const processedApks = await Promise.all(apkFiles.map(async (apk) => {
            const perms = await AndroidService.getApkPermissionsOnly(serial, apk.apkPath);
            return {
                ...apk,
                requestedList: perms, // 화면에 보여줄 권한 리스트
                requestedCount: perms.length
            };
        }));

        const processedApps = [];

        // 20개씩 병렬 처리
        for (let i = 0; i < allApps.length; i += 20) {
            const chunk = allApps.slice(i, i + 20);

            const results = await Promise.all(chunk.map(async (app) => {
                try {
                    // 1. 상세 정보 수집 (권한 및 컴포넌트 정보)
                    const [isRunningBg, permData] = await Promise.all([
                        AndroidService.checkIsRunningBackground(serial, app.packageName),
                        AndroidService.getAppPermissions(serial, app.packageName)
                    ]);

                    // 권한 통합
                    const permissions = [...new Set([
                        ...(permData.requestedList || []),
                        ...(permData.grantedList || [])
                    ])];

                    const netStats = networkMap[app.uid] || { rx: 0, tx: 0 };

                    // 2. 💡 AI를 위한 지능형 지표 계산
                    // 이름 사칭 여부 (AI가 참고할 보조 지표)
                    const trustedPrefixes = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'android'];
                    const isMasquerading = trustedPrefixes.some(p => app.packageName.startsWith(p)) && !app.isSystemApp;

                    const aiPayload = {
                        packageName: app.packageName,
                        permissions: permissions,
                        isSideloaded: app.isSideloaded,
                        // 경로가 시스템 영역인지 판정
                        isSystemPath: app.apkPath.startsWith('/system') ||
                            app.apkPath.startsWith('/vendor') ||
                            app.apkPath.startsWith('/product'),
                        isMasquerading: isMasquerading,
                        // 💡 중요: AI가 밀도를 계산할 수 있도록 개수 전달
                        services_cnt: permData.servicesCount || 0,
                        receivers_cnt: permData.receiversCount || 0
                    };

                    // 3. AI 엔진 분석 호출 (수동 필터 없음)
                    const aiResult = await analyzeAppWithStaticModel(aiPayload);

                    if (aiResult.score >= 50) {
                        console.log(`\n🚨 [AI 탐지 로그: ${app.packageName}]`);
                        console.log(`- 판정 점수: ${aiResult.score}점 (${aiResult.grade})`);
                        console.log(`- 앱 경로: ${app.apkPath}`);
                        console.log(`- 시스템 경로 판정: ${aiPayload.isSystemPath}`);
                        console.log(`- 서비스 개수: ${permData.servicesCount}`);
                        console.log(`- 리시버 개수: ${permData.receiversCount}`);
                        console.log(`- 권한 개수: ${permissions.length}`);
                        console.log(`- 사이드로드 여부: ${app.isSideloaded}`);
                        console.log(`- 원인: ${aiResult.reason}`);
                        console.log(`-------------------------------------------\n`);
                    }

                    return {
                        ...app,
                        isRunningBg,
                        ...permData,
                        dataUsage: netStats,
                        aiScore: aiResult.score,
                        aiGrade: aiResult.grade,
                        reason: aiResult.reason,
                        // 상세 정보 보관
                        servicesCount: permData.servicesCount,
                        receiversCount: permData.receiversCount
                    };

                } catch (e) {
                    console.error(`Error analyzing ${app.packageName}:`, e);
                    return { ...app, error: true };
                }
            }));

            processedApps.push(...results);
        }

        // ---------------------------------------------------------
        // 결과 필터링 (위험한 것만 추출)
        let suspiciousApps = processedApps.filter(app => app.aiGrade === 'DANGER' || app.aiGrade === 'WARNING');

        // [Step E] (선택) VirusTotal 2차 정밀 검사
        if (suspiciousApps.length > 0 && CONFIG.VIRUSTOTAL_API_KEY && CONFIG.VIRUSTOTAL_API_KEY !== 'your_key') {
            const vtTargets = suspiciousApps.filter(a => a.isSideloaded || a.isMasquerading || a.deviceAdminActive || a.accessibilityEnabled);
            console.log(`🌐 VT 정밀 검사 진행 (${vtTargets.length}개)`);
            await AndroidService.runVirusTotalCheck(serial, vtTargets);
        }

        let privacyThreatApps = [];

        // 💡 1. filter를 사용하여 '개인정보'가 포함된 앱만 따로 추출합니다.
        privacyThreatApps = suspiciousApps.filter(app =>
            app.reason && app.reason.includes("개인정보")
        );

        // 💡 2. 원본 배열에서는 '개인정보'가 포함되지 않은 앱들만 남깁니다 (삭제 효과).
        suspiciousApps = suspiciousApps.filter(app =>
            !app.reason || !app.reason.includes("개인정보")
        );

        return { deviceInfo, allApps: processedApps, suspiciousApps, privacyThreatApps, apkFiles: processedApks };

    } catch (err) {
        console.error(err);
        return { error: err.message };
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

ipcMain.handle('delete-apk-file', async (event, { serial, filePath }) => {
    try {
        console.log(`[ADB] 기기 내 파일 삭제 시도: ${filePath}`);

        // 1. ADB 쉘 명령어로 해당 경로의 파일 강제 삭제 (rm -f)
        const output = await client.shell(serial, `rm -f "${filePath}"`);
        await adb.util.readAll(output);

        console.log(`[ADB] 삭제 완료: ${filePath}`);
        return { success: true, message: "파일이 기기에서 영구적으로 삭제되었습니다." };
    } catch (e) {
        console.error("❌ 파일 삭제 실패:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-ios-backup', async (event, udid) => {
    console.log(`--- [Security] 삭제 요청 수신 (전달된 UDID: ${udid}) ---`);

    // UDID가 비어있는지 가장 먼저 확인 (방어 코드)
    if (!udid) {
        console.error("❌ 삭제 실패: 전달받은 UDID가 없습니다. (State.currentUdid 확인 필요)");
        return { success: false, error: "No UDID provided" };
    }

    // 💡 KEEP_BACKUP이 true면 그냥 리턴 (삭제 안 함)
    if (CONFIG.KEEP_BACKUP) {
        console.log(`[Maintenance] KEEP_BACKUP 활성화 상태: 파일을 유지합니다.`);
        return { success: true };
    }

    try {
        // 💡 위에서 정의한 CONFIG 경로를 그대로 사용
        const specificPath = path.join(CONFIG.PATHS.TEMP_BACKUP, udid);

        if (fs.existsSync(specificPath)) {
            fs.rmSync(specificPath, { recursive: true, force: true });
            console.log(`[Security] 배포 모드: 백업 데이터 파기 성공.`);
        }
        return { success: true };
    } catch (err) {
        console.error('[Security] 삭제 오류:', err.message);
        return { success: false, error: err.message };
    }
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
            return null;
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

// 검사결과 핸드폰에 저장하는 로직
ipcMain.handle('auto-push-report-to-android', async (event) => {
    const mainWindow = BrowserWindow.fromWebContents(event.sender);

    // 1. 대상자 이름을 파일명에 반영 (예: 홍길동_리포트.pdf)
    const tempPdfPath = path.join(app.getPath('temp'), `BD_Scanner_Report.pdf`);

    try {
        // 2. 현재 리포트 화면을 PDF 데이터로 굽기
        const pdfData = await mainWindow.webContents.printToPDF({
            printBackground: true,
            landscape: false,
            pageSize: 'A4'
        });

        // 3. 임시 경로에 쓰기
        fs.writeFileSync(tempPdfPath, pdfData);

        // 4. 안드로이드 기기 체크
        const devices = await client.listDevices();
        if (devices.length === 0) throw new Error('기기가 연결되어 있지 않습니다.');
        const serial = devices[0].id;

        // 5. 휴대폰 전송 경로 (Download 폴더)
        const remotePath = `/storage/emulated/0/Download/BD_Scanner_Report.pdf`;

        // 6. ADB Push 실행
        await client.push(serial, tempPdfPath, remotePath);

        // 7. 임시 파일 삭제
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

        return { success: true, remotePath };
    } catch (err) {
        console.error('휴대폰 자동 전송 실패:', err);
        return { success: false, error: err.message };
    }
});

// ============================================================
// [4] iOS IPC 핸들러 (iOS HANDLERS)
// ============================================================

// 4-1. iOS 연결 확인
ipcMain.handle('check-ios-connection', async () => {
    if (CONFIG.IS_DEV_MODE) return MockData.getIosConnection();

    console.log(`[iOS] 연결 확인 시작: ${CONFIG.PATHS.IOS_ID}`);

    try {
        // 1. idevice_id.exe 실행 (UDID 가져오기)
        const cmdId = `"${CONFIG.PATHS.IOS_ID}" -l`;
        const udidOutput = await Utils.runCommand(cmdId);

        const udid = udidOutput.trim();

        if (udid.length === 0) {
            return { status: 'disconnected' };
        }

        // 2. ideviceinfo.exe 실행 (모델명 가져오기)
        const cmdInfo = `"${CONFIG.PATHS.IOS_INFO}" -k DeviceName`;
        const nameOutput = await Utils.runCommand(cmdInfo);

        const modelName = nameOutput ? nameOutput.trim() : 'iPhone Device';

        // 성공
        return { status: 'connected', model: modelName, udid: udid, type: 'ios' };

    } catch (error) {
        const detailedError = error.message || "iOS 도구 실행 중 알 수 없는 오류";

        if (!fs.existsSync(CONFIG.PATHS.IOS_ID)) {
            return { status: 'error', error: `필수 도구 파일 없음: ${CONFIG.PATHS.IOS_ID}` };
        }

        console.error(`❌ [iOS] 연결 확인 실패 상세: ${detailedError}`);
        let userMsg = "iOS 기기 연결 오류. iTunes/Apple 드라이버가 설치되었는지 확인하세요.";

        if (detailedError.includes('command failed')) {
            userMsg = "iOS 도구 실행 실패. 기기가 잠금 해제되었는지, '이 컴퓨터 신뢰'를 수락했는지 확인하세요.";
        }

        return { status: 'error', error: userMsg };
    }
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
        const toolDir = path.dirname(CONFIG.PATHS.IOS_BACKUP);
        const ideviceinfoPath = path.join(toolDir, 'ideviceinfo.exe');
        const cmd = `"${ideviceinfoPath}" -u ${udid}`;

        const output = await Utils.runCommand(cmd);

        const rawMap = {};
        output.split('\n').forEach(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join(':').trim();
                rawMap[key] = val;
            }
        });

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
        };

        const pType = rawMap['ProductType'];
        if (pType) info.model = modelMap[pType] || pType;

        if (rawMap['SerialNumber']) info.serial = rawMap['SerialNumber'];
        if (rawMap['PhoneNumber']) info.phoneNumber = rawMap['PhoneNumber'];
        if (rawMap['ProductVersion']) info.os = `iOS ${rawMap['ProductVersion']}`;

    } catch (e) {
        console.warn(`⚠️ [iOS] ideviceinfo 실행 실패: ${e.message}`);
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
    const specificBackupPath = path.join(TEMP_BACKUP, udid);

    try {
        // [Step 1] 기존에 '완전한' 백업이 이미 있는지 체크
        let isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));

        if (!isBackupComplete) {
            console.log("[iOS] 신규 검사를 위해 백업을 시작합니다...");

            // 💡 [좀비 프로세스 방지] 시작 전 관련 도구가 돌고 있다면 강제 종료
            try {
                await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => { });
                await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => { });
            } catch (e) { }

            // 폴더 초기화
            if (fs.existsSync(specificBackupPath)) {
                fs.rmSync(specificBackupPath, { recursive: true, force: true });
            }
            if (!fs.existsSync(TEMP_BACKUP)) fs.mkdirSync(TEMP_BACKUP, { recursive: true });

            // 10~20분 소요
            const backupCmd = `"${IOS_BACKUP}" backup --full "${TEMP_BACKUP}" -u ${udid}`;

            try {
                await Utils.runCommand(backupCmd);
                console.log("[iOS] 백업 명령어 수행 완료.");
            } catch (backupErr) {
                // 에러가 났더라도 Status.plist만 생겼다면 무시하고 진행
                console.warn("[iOS] 백업 종료 과정에서 경고가 발생했으나, 데이터 무결성을 확인합니다...");
            }

            // 백업 완료 여부 재확인
            isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));
        }

        // [Step 2] 백업 파일만 있다면 즉시 분석 엔진 가동 
        if (isBackupComplete) {
            console.log("[iOS] 🚀 데이터 확보 확인! 즉시 정밀 분석 단계로 전환합니다.");

            // 분석에 필요한 기기 정보 로드 (에러 잘 나는 실시간 조회 대신 백업 파일에서 추출)
            let deviceInfo = { model: 'iPhone', serial: udid, phoneNumber: '-', os: 'iOS' };
            try {
                const plistPath = path.join(specificBackupPath, 'Info.plist');
                if (fs.existsSync(plistPath)) {
                    const content = fs.readFileSync(plistPath, 'utf8');
                    deviceInfo.model = content.match(/<key>Product Type<\/key>\s*<string>(.*?)<\/string>/)?.[1] || "iPhone";
                    deviceInfo.phoneNumber = content.match(/<key>PhoneNumber<\/key>\s*<string>(.*?)<\/string>/)?.[1] || "-";
                    const version = content.match(/<key>Product Version<\/key>\s*<string>(.*?)<\/string>/)?.[1];
                    if (version) deviceInfo.os = `iOS ${version}`;
                }
            } catch (e) {
                console.warn("기기 정보 추출 실패(무시하고 진행):", e.message);
            }

            // [Step 3] MVT 분석 실행
            Utils.cleanDirectory(MVT_RESULT);
            if (!fs.existsSync(MVT_RESULT)) fs.mkdirSync(MVT_RESULT);

            console.log('3. MVT 분석 엔진 가동...');
            const mvtCmd = `mvt-ios check-backup --output "${MVT_RESULT}" "${specificBackupPath}"`;

            // 분석 도중 발생하는 사소한 경고는 무시하고 진행
            await Utils.runCommand(mvtCmd).catch(e => console.warn("MVT 실행 중 경고 무시"));

            // [Step 4] 결과 파싱 및 반환
            const results = IosService.parseMvtResults(MVT_RESULT, deviceInfo);
            console.log('[iOS] 전체 프로세스 완료. 결과 화면으로 넘어갑니다.');
            return results;

        } else {
            // 백업 파일이 아예 생성되지 않은 진짜 에러 상황
            throw new Error("백업 데이터가 생성되지 않았습니다. 아이폰 연결 상태를 확인해주세요.");
        }

    } catch (err) {
        console.error('iOS 검사 프로세스 오류:', err.message);
        return { error: "검사 실패: " + err.message };
    }
});

ipcMain.handle('saveScanResult', async (event, data) => {
    // data: { deviceInfo: {...}, allApps: [...], ... } 전체 검사 결과 객체
    try {
        const { dialog } = require('electron');

        // 파일명 생성: BD_YYYYMMDD_MODEL.json
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const modelName = data.deviceInfo.model ? data.deviceInfo.model.replace(/\s/g, '_') : 'UnknownDevice';
        const defaultPath = path.join(os.homedir(), `BD_${dateStr}_${modelName}.json`);

        const result = await dialog.showSaveDialog({
            title: '검사 결과 저장',
            defaultPath: defaultPath,
            filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
        });

        if (result.canceled) {
            return { success: false, message: '저장 취소' };
        }

        const filePath = result.filePath;
        const jsonContent = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonContent);

        return { success: true, message: `결과가 성공적으로 저장되었습니다:\n${filePath}` };

    } catch (e) {
        console.error("로컬 저장 오류:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-scan-file', async (event) => {
    try {
        const { dialog } = require('electron');

        const result = await dialog.showOpenDialog({
            title: '검사 결과 열기',
            properties: ['openFile'],
            filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, message: '열기 취소' };
        }

        const filePath = result.filePaths[0];
        const jsonContent = fs.readFileSync(filePath, 'utf-8');
        const scanData = JSON.parse(jsonContent);

        // 💡 [핵심] 저장된 OS 모드 파악 (UI 렌더링에 필요)
        if (!scanData.deviceInfo || !scanData.deviceInfo.os) {
            throw new Error('파일 구조가 올바르지 않거나 OS 정보가 누락되었습니다.');
        }

        return { success: true, data: scanData, osMode: scanData.deviceInfo.os };

    } catch (e) {
        console.error("로컬 파일 열기 오류:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('checkForUpdate', async (event, currentVersion) => {
    try {
        console.log(`📡 현재 버전: ${currentVersion}. 최신 버전 확인 중...`);

        // 1. Firestore에서 최신 버전 정보 문서 가져오기
        const doc = await db.collection('updates').doc('latest').get();

        if (!doc.exists) {
            return { available: false, message: '업데이트 정보 없음' };
        }

        const latestInfo = doc.data();
        const latestVersion = latestInfo.version;

        const isNewVersion = latestVersion > currentVersion;

        if (isNewVersion) {
            return {
                available: true,
                latestVersion: latestVersion,
                downloadUrl: latestInfo.url,
                message: `${latestVersion} 버전이 출시되었습니다. 수동 업데이트가 필요합니다.`
            };
        } else {
            return { available: false, message: '최신 버전을 사용 중입니다.' };
        }

    } catch (e) {
        console.error("업데이트 확인 오류:", e);
        return { available: false, error: e.message, message: '업데이트 서버 접속 실패' };
    }
});

// 자동 로그인 관련 로직

// 💡 [IPC 핸들러] 로그인 정보 저장
ipcMain.handle('saveLoginInfo', async (event, { id, pw, remember }) => {
    try {
        // ✅ 변수명 오류 수정: safePw / savePw 혼동 해결
        let safePw = pw;

        // safeStorage가 사용 가능한 환경인지 확인 후 암호화
        if (safeStorage.isEncryptionAvailable()) {
            safePw = safeStorage.encryptString(pw).toString('base64');
        }

        const data = { id, safePw, remember }
        fs.writeFileSync(CONFIG.PATHS.LOGIN_CONFIG_PATH, JSON.stringify(data));
        return { success: true };
    } catch (error) {
        console.error('로그인 정보 저장 실패:', error);
        return { success: false };
    }
});

// 💡 [IPC 핸들러] 저장된 정보 불러오기
ipcMain.handle('getLogininfo', async () => {
    try {
        if (fs.existsSync(CONFIG.PATHS.LOGIN_CONFIG_PATH)) {
            const fileContent = fs.readFileSync(CONFIG.PATHS.LOGIN_CONFIG_PATH, 'utf8');

            // 파일 내용이 비어있는지 확인
            if (!fileContent || fileContent === "") {
                return { remember: false, id: '', pw: '' };
            }

            const data = JSON.parse(fileContent);
            if (data.remember && data.safePw && safeStorage.isEncryptionAvailable()) {
                try {
                    // base64 문자열을 Buffer로 변환 후 복호화
                    const buffer = Buffer.from(data.safePw, 'base64');
                    data.pw = safeStorage.decryptString(buffer);
                } catch (e) {
                    data.pw = ""; // 복호화 실패 시 빈값
                }
            }
            const returnData = {
                id: data.id,
                pw: data.pw,
                remember: data.remember
            }

            // 데이터가 존재하고 remember가 true인 경우만 반환
            return returnData;
        }
    } catch (error) {
        console.error('로그인 정보 로드 실패:', error);
    }
    // 파일이 없거나 에러 발생 시 기본값 반환
    return { remember: false, id: '', pw: '' };
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

    // ---------------------------------------------------------
    // ✅ [Helper] adb shell 결과를 "문자열"로 받기 (Stream -> String)
    async adbShell(serial, cmd) {
        const out = await client.shell(serial, cmd);
        return (await adb.util.readAll(out)).toString().trim();
    },

    // 앱 삭제 (Disable -> Uninstall)
    async uninstallApp(packageName) {
        try {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 끊김');
            const serial = devices[0].id;

            console.log(`[Android] 삭제 시도 전 기기 관리자 권한 해제 시도: ${packageName}`);

            // 1. [핵심 추가] 기기 관리자 권한 강제 해제 (Active Admin 제거)
            try {
                await client.shell(serial, `dpm remove-active-admin ${packageName}`);
            } catch (e) {
                console.log("기기 관리자 권한이 없거나 이미 해제됨");
            }

            // 2. 앱 비활성화 (pm disable)
            const disableCmd = await client.shell(serial, `pm disable-user --user 0 ${packageName}`);
            await adb.util.readAll(disableCmd);

            // 3. 실제 앱 삭제 실행
            try {
                await client.uninstall(serial, packageName);
                return { success: true, message: "앱이 완전히 삭제되었습니다." };
            } catch (e) {
                await client.shell(serial, `pm clear ${packageName}`);
                throw new Error("일반 삭제 실패, 데이터를 초기화하고 중지시켰습니다.");
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
        // 1. 시스템 앱 목록 획득 (가장 정확한 명단)
        const sysOutput = await client.shell(serial, 'pm list packages -s');
        const sysData = await adb.util.readAll(sysOutput);
        const systemPackages = new Set(sysData.toString().trim().split('\n').map(l => l.replace('package:', '').trim()));

        // 2. 전체 앱 목록 및 상세 정보 획득
        const output = await client.shell(serial, 'pm list packages -i -f -U');
        const data = await adb.util.readAll(output);
        const lines = data.toString().trim().split('\n');

        const TRUSTED_INSTALLERS = [
            'com.android.vending', 'com.sec.android.app.samsungapps', 'com.skt.skaf.A000Z00040',
            'com.kt.olleh.storefront', 'com.lguplus.appstore', 'com.google.android.feedback'
        ];

        // 시스템 앱이라고 믿을 수 있는 이름 패턴 (AI 학습 및 필터링용)
        const TRUSTED_PREFIXES = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'com.qualcomm.', 'com.qti.', 'android'];

        return lines.map((line) => {
            if (!line) return null;
            const parts = line.split(/\s+/);
            let packageName = '', apkPath = 'N/A', installer = null, uid = null;

            // [사용자님의 원본 파싱 로직 유지]
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

            // --- 여기서부터 AI 전용 필드 계산 (파싱된 값 활용) ---

            let origin = '외부 설치';
            let isSideloaded = true;
            let isSystemApp = false;
            let isMasquerading = false;

            // 1. 시스템 앱 판정 (Set 목록 대조)
            if (systemPackages.has(packageName)) {
                origin = '시스템 앱';
                isSideloaded = false;
                isSystemApp = true;
            }
            // 2. 공식 스토어 판정
            else if (installer && TRUSTED_INSTALLERS.includes(installer)) {
                origin = '공식 스토어';
                isSideloaded = false;
                isSystemApp = false;
            }

            // 3. 위장 앱(Masquerading) 판정 로직
            // 이름은 시스템Prefix인데, 실제 시스템 앱 목록에 없고 스토어 출처도 아닐 때
            const hasTrustedName = TRUSTED_PREFIXES.some(pre => packageName.startsWith(pre));
            if (hasTrustedName && !isSystemApp && isSideloaded) {
                isMasquerading = true;
            }

            // AI 엔진 및 CSV 추출에 필요한 모든 필드 반환
            return {
                packageName,
                apkPath,
                installer,
                isSideloaded,
                isSystemApp,      // AI 학습용 핵심 필드
                isMasquerading,   // AI 학습용 핵심 필드
                uid,
                origin
            };
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

            const componentPattern = new RegExp(`${packageName.replace(/\./g, '\\.')}/[\\w\\.]+\\.[\\w\\.]+`, 'g');
            const matches = dumpsys.match(componentPattern) || [];
            const uniqueCount = [...new Set(matches)].length;

            return {
                allPermissionsGranted: requestedPerms.size > 0 && [...requestedPerms].every(p => grantedPerms.has(p)),
                requestedList: Array.from(requestedPerms),
                grantedList: Array.from(grantedPerms),
                servicesCount: Math.max(1, Math.ceil(uniqueCount / 2)),
                receiversCount: Math.floor(uniqueCount / 2)
            };
        } catch (e) {
            return { requestedList: [], grantedList: [], servicesCount: 0, receiversCount: 0 };
        }
    },

    // 네트워크 사용량 (UID 기반)
    async getNetworkUsageMap(serial) {
        const usageMap = {};
        try {
            // 💡 방법 1: dumpsys netstats detail (기존 방식 유지)
            let data = '';
            try {
                const output = await client.shell(serial, 'dumpsys netstats detail');
                data = (await adb.util.readAll(output)).toString();
            } catch (e) {
                console.warn('⚠️ dumpsys netstats detail 실패, 대체 명령어 시도.');
            }

            // 💡 방법 2: /proc/net/xt_qtaguid/stats 파일 직접 읽기 (루팅 필요하거나 접근이 막힐 수 있음)
            if (data.length === 0) {
                try {
                    const output = await client.shell(serial, 'cat /proc/net/xt_qtaguid/stats');
                    data = (await adb.util.readAll(output)).toString();
                } catch (e) {
                    console.warn('⚠️ /proc/net/xt_qtaguid/stats 접근 실패.');
                }
            }

            let currentUid = null;

            data.split('\n').forEach(line => {
                const trimmedLine = line.trim();

                // 1. UID 식별자 (ident=...) 찾기
                if (trimmedLine.startsWith('ident=')) {
                    const uidMatch = trimmedLine.match(/uid=(\d+)/);
                    if (uidMatch) {
                        currentUid = uidMatch[1];
                        if (!usageMap[currentUid]) {
                            usageMap[currentUid] = { rx: 0, tx: 0 };
                        }
                    } else {
                        currentUid = null;
                    }
                }
                // 2. NetworkStatsHistory 버킷 찾기 (rb=... tb=...)
                else if (currentUid && trimmedLine.startsWith('st=')) {
                    const rbMatch = trimmedLine.match(/rb=(\d+)/);
                    const tbMatch = trimmedLine.match(/tb=(\d+)/);

                    if (rbMatch && tbMatch) {
                        const rxBytes = parseInt(rbMatch[1], 10) || 0;
                        const txBytes = parseInt(tbMatch[1], 10) || 0;

                        usageMap[currentUid].rx += rxBytes;
                        usageMap[currentUid].tx += txBytes;
                    }
                }
            });

        } catch (e) {
            // ... (오류 처리 로직 유지) ...
        }
        return usageMap;
    },

    // APK 파일 검색
    async findApkFiles(serial) {

        // 💡 경로 중복 제거: /sdcard와 /storage/emulated/0는 같은 곳입니다.
        // 하나만 남기거나, 결과에서 경로 중복을 체크해야 합니다.
        const searchPaths = ['/sdcard/Download', '/data/local/tmp'];
        let allApkData = [];
        const seenPaths = new Set(); // 💡 중복 체크를 위한 세트

        for (const searchPath of searchPaths) {
            try {
                const command = `find "${searchPath}" -type f -iname "*.apk" -exec ls -ld {} + 2>/dev/null`;
                const output = await client.shell(serial, command);
                const data = (await adb.util.readAll(output)).toString().trim();

                if (!data) continue;

                const lines = data.split('\n');
                for (const line of lines) {
                    const parts = line.split(/\s+/);
                    if (parts.length < 7) continue;

                    const filePath = parts[parts.length - 1];

                    if (seenPaths.has(filePath)) continue;
                    seenPaths.add(filePath);

                    const timePart = parts[parts.length - 2];
                    const datePart = parts[parts.length - 3];
                    const rawSize = parts[parts.length - 4];

                    const fileName = filePath.split('/').pop();
                    const sizeNum = parseInt(rawSize);
                    const formattedSize = isNaN(sizeNum) ? "분석 중" : (sizeNum / (1024 * 1024)).toFixed(2) + " MB";

                    allApkData.push({
                        packageName: fileName,
                        apkPath: filePath,
                        fileSize: formattedSize,
                        installDate: `${datePart} ${timePart}`,
                        isApkFile: true,
                        isRunningBg: false,
                        isSideloaded: true,
                        requestedCount: 3,
                        requestedList: ['android.permission.INTERNET', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.REQUEST_INSTALL_PACKAGES']
                    });
                }
            } catch (e) {
                console.error(`${searchPath} 검색 실패:`, e.message);
            }
        }
        return allApkData;
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
            'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
            'android.permission.ACCESS_BACKGROUND_LOCATION',
            'android.permission.FOREGROUND_SERVICE',
            'android.permission.WAKE_LOCK',
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.QUERY_ALL_PACKAGES',
            'android.permission.GET_TASKS'
        ];
        const ALARM = ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM', 'com.android.alarm.permission.SET_ALARM'];
        const SAFE_PREFIX = ['com.samsung.', 'com.sec.', 'com.qualcomm.', 'com.sktelecom.', 'com.kt.', 'com.lgu.', 'uplus.', 'lgt.', 'com.facebook.', 'com.instagram.', 'com.twitter.', 'com.kakao.', 'jp.naver.'];

        return apps.filter(app => {
            if (SAFE_PREFIX.some(p => app.packageName.startsWith(p))) return false;
            if (!app.isSideloaded) return false; //외부설치
            if (!app.isRunningBg) return false; //백그라운드

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
                    app.reason = `[개인정보 유출 위협] ` + app.reason;
                }
                fs.unlinkSync(tempPath);
            } catch (e) {
                console.error(`VT 검사 오류 (${app.packageName})`)
                app.vtResult = { error: "검사 불가" };
            }
        }
    },

    async getApkPermissionsOnly(serial, remotePath) {
        let tempPath = null;
        try {
            // 1. 임시 파일 경로 설정
            tempPath = path.join(os.tmpdir(), `extract_${Date.now()}.apk`);

            // 2. ADB Pull로 기기 내 APK를 PC 임시 폴더로 복사
            const transfer = await client.pull(serial, remotePath);
            await new Promise((resolve, reject) => {
                const fn = fs.createWriteStream(tempPath);
                transfer.on('end', () => fn.end());
                transfer.on('error', reject);
                fn.on('finish', resolve);
                transfer.pipe(fn);
            });

            // 3. APK Manifest 읽기
            const reader = await ApkReader.open(tempPath);
            const manifest = await reader.readManifest();

            // 4. 권한 리스트 추출
            const permissions = (manifest.usesPermissions || []).map(p => p.name);

            // 5. 임시 파일 삭제
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

            return permissions;
        } catch (e) {
            console.error(`APK 권한 추출 실패 (${remotePath}):`, e);
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            return [];
        }
    }
};

// ============================================================
// [6] iOS 서비스 로직 (iOS SERVICE LOGIC)
// ============================================================

const IosService = {

    decodeUnicode(str) {
        if (!str) return '';
        try {
            return JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
        } catch (e) {
            return str;
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

                // 1. **[시도 1: 단일 JSON 배열]**
                try {
                    const parsedJson = JSON.parse(appContent);
                    if (Array.isArray(parsedJson)) {
                        rawApps = parsedJson;
                        console.log('✅ [iOS] applications.json: 단일 JSON 배열로 성공적으로 파싱됨.');
                    } else {
                        throw new Error("Not an array");
                    }
                } catch (e) {
                    // 2. **[시도 2: JSON Lines]**
                    console.log('🔄 [iOS] applications.json: 단일 배열 파싱 실패. JSON Lines로 재시도.');
                    const lines = appContent.trim().split('\n').filter(line => line.trim().length > 0);

                    lines.forEach(line => {
                        try {
                            rawApps.push(JSON.parse(line));
                        } catch (e) { }
                    });
                }

                // 3. 표준 형식으로 변환
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
// [8] 테스트용 가짜 데이터 (MOCK DATA)
// ============================================================
const MockData = {
    getAndroidConnection() {
        return { status: 'connected', model: 'SM-TEST' };
    },

    getAndroidScanResult() {
        const allApps = [
            { packageName: 'com.google.android.youtube', cachedTitle: 'YouTube', installer: 'com.android.vending', isSideloaded: false, uid: '10100', origin: '공식 스토어', dataUsage: { rx: 50000000, tx: 3000000 } },
            { packageName: 'com.android.systemui', cachedTitle: 'System UI', installer: null, isSideloaded: false, uid: '1000', origin: '시스템 앱', dataUsage: { rx: 1000000, tx: 500000 } },
            {
                packageName: 'com.android.settings.daemon',
                cachedTitle: 'Wi-Fi Assistant',
                installer: null,
                isSideloaded: true,
                uid: '10272',
                origin: '외부 설치',
                dataUsage: { rx: 50000, tx: 85000000 },
                permissions: ['ACCESS_FINE_LOCATION', 'READ_SMS', 'RECEIVE_BOOT_COMPLETED']
            },
            {
                packageName: 'com.fp.backup',
                cachedTitle: 'Backup Service',
                installer: 'com.sideload.browser',
                isSideloaded: true,
                uid: '10273',
                origin: '외부 설치',
                dataUsage: { rx: 10000000, tx: 10000000 },
                reason: '[VT 확진] 악성(22/68) + READ_SMS, READ_CALL_LOG 권한 다수'
            },
            {
                packageName: 'com.hidden.syscore',
                cachedTitle: '',
                installer: null,
                isSideloaded: true,
                uid: '10274',
                origin: '외부 설치',
                dataUsage: { rx: 10000, tx: 2000000 },
                permissions: ['SYSTEM_ALERT_WINDOW', 'CAMERA', 'RECORD_AUDIO']
            },
            { packageName: 'com.kakao.talk', cachedTitle: '카카오톡', installer: 'com.android.vending', isSideloaded: false, uid: '10275', origin: '공식 스토어', dataUsage: { rx: 20000000, tx: 5000000 } },
        ];

        const apkFiles = [
            '/sdcard/Download/system_update_v1.apk',
            '/sdcard/Android/data/com.hidden.syscore/files/core.apk',
        ];

        const suspiciousApps = allApps.filter(app => app.reason || (app.uid === '10272' && app.isSideloaded));

        if (!suspiciousApps.some(app => app.packageName === 'com.android.settings.daemon')) {
            suspiciousApps.push(allApps.find(app => app.packageName === 'com.android.settings.daemon'));
        }

        if (!suspiciousApps.some(app => app.packageName === 'com.hidden.syscore')) {
            suspiciousApps.push(allApps.find(app => app.packageName === 'com.hidden.syscore'));
        }

        return {
            deviceInfo: {
                model: 'SM-F966N (MOCK)',
                serial: 'RFCY71W09GM',
                phoneNumber: '알 수 없음',
                os: 'Android 14'
            },
            allApps: allApps,
            apkFiles: apkFiles,
            suspiciousApps: suspiciousApps.filter(Boolean),
            networkUsageMap: {
                '10100': { rx: 50000000, tx: 3000000 },
                '1000': { rx: 1000000, tx: 500000 },
                '10272': { rx: 50000, tx: 85000000 },
                '10273': { rx: 10000000, tx: 10000000 },
                '10274': { rx: 10000, tx: 2000000 },
                '10275': { rx: 20000000, tx: 5000000 }
            }
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
            { packageName: 'com.spyware.agent.hidden', cachedTitle: '시스템 서비스' },
            { packageName: 'com.naver.map', cachedTitle: '네이버 지도' },
            { packageName: 'com.tistory.blog', cachedTitle: '티스토리' },
            { packageName: 'com.google.youtube', cachedTitle: 'YouTube' },
            { packageName: 'com.kakaobank.bank', cachedTitle: '카카오뱅크' },
        ];

        return {
            deviceInfo: {
                model: 'iPhone 16 Pro (MOCK)',
                serial: 'IOS-TEST-UDID',
                phoneNumber: '+82 10-9999-0000',
                os: 'iOS 17.4'
            },
            suspiciousItems: [
                { module: 'SMS', check_name: 'iMessage Link IOC', description: '악성 도메인 접속 유도 링크 수신', path: '/private/var/mobile/Library/SMS/sms.db', sha256: 'a1b2c3d4...' },
                { module: 'WebKit', check_name: 'Browser History IOC', description: 'Safari에서 C2 서버 도메인 접속 흔적 발견', path: '/private/var/mobile/Library/WebKit', sha256: 'e5f6g7h8...' },
                { module: 'Process', check_name: 'Suspicious Process', description: '비정상적인 이름의 백그라운드 프로세스 활동', path: 'com.apple.bh', sha256: 'i9j0k1l2...' },
            ],
            mvtResults: {
                web: { status: 'warning', warnings: ['악성 URL 접속 흔적: hxxp://c2-server.com', 'Safari 캐시에서 비정상 파일 발견'] },
                messages: { status: 'warning', warnings: ['악성 도메인 접속 유도 링크 수신'] },
                system: { status: 'warning', warnings: ['비정상적인 이름의 백그라운드 프로세스 활동', '의심스러운 Crash Report 발견'] },
                apps: { status: 'safe', warnings: [] },
                artifacts: { status: 'safe', warnings: [] }
            },
            allApps: installedApps,
            apkFiles: [],
        };
    },
};
