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
    VIRUSTOTAL_API_KEY: '2aa1cd78a23bd4ae58db52c773d7070fd7f961acb6debcca94ba9b5746c2ec96',
    PATHS: {
        ADB: path.join(RESOURCE_DIR, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb'),
        IOS_TOOLS: path.join(RESOURCE_DIR, 'ios-tools'),
        IOS_ID: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id'),
        IOS_INFO: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo'),
        IOS_BACKUP: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2'),
        TEMP_BACKUP: path.join(app.getPath('temp'), 'bd_ios_backup'),
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
            devTools: false,
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
// [정적AI 정책/유틸] (중복 선언 제거 + 타입 안전)
// ============================================================

const DANGEROUS_PERMS = new Set([
    "android.permission.READ_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.SEND_SMS",
    "android.permission.WRITE_SMS",
    "android.permission.RECEIVE_MMS",
    "android.permission.RECEIVE_WAP_PUSH",

    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.GET_ACCOUNTS",

    "android.permission.READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG",
    "android.permission.READ_PHONE_STATE",
    "android.permission.READ_PHONE_NUMBERS",
    "android.permission.CALL_PHONE",
    "android.permission.ANSWER_PHONE_CALLS",

    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",

    "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA",

    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
]);

const TRUSTED_INSTALLERS = new Set([
    "com.android.vending",                 // Play Store
    "com.sec.android.app.samsungapps",     // Galaxy Store
    // "com.amazon.venezia",                  // Amazon (필요시)
    "com.lguplus.appstore",
    "com.kt.olleh.storefront",
    "com.skt.skaf.A000Z00040",
]);

const SYSTEMISH_PREFIXES = [
    "com.android.",
    "android",
    "com.android.systemui",
    "com.android.settings",
];

// “삼성/구글 전체”는 너무 넓어서 위장 판정 오탐이 커짐
// 위장은 SYSTEMISH_PREFIXES 위주로만 잡는 게 안전
function isSystemishName(pkg) {
    return SYSTEMISH_PREFIXES.some(p => pkg === p || pkg.startsWith(p));
}

function toBool(v) {
    return v === true || v === 1 || v === "true";
}

function buildSignals(app, permissions) {
    const p = new Set(permissions || []);
    const has = (...xs) => xs.some(x => p.has(x));

    const signals = {
        boot: has("android.permission.RECEIVE_BOOT_COMPLETED") ? 1 : 0,
        overlay: has("android.permission.SYSTEM_ALERT_WINDOW") ? 1 : 0,
        ignoreBatteryOpt: has("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS") ? 1 : 0,

        sms: has("android.permission.READ_SMS", "android.permission.RECEIVE_SMS", "android.permission.SEND_SMS", "android.permission.WRITE_SMS") ? 1 : 0,
        call: has("android.permission.READ_CALL_LOG", "android.permission.WRITE_CALL_LOG", "android.permission.READ_PHONE_STATE", "android.permission.READ_PHONE_NUMBERS", "android.permission.CALL_PHONE", "android.permission.ANSWER_PHONE_CALLS") ? 1 : 0,
        contacts: has("android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS") ? 1 : 0,
        location: has("android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION") ? 1 : 0,
        mic: has("android.permission.RECORD_AUDIO") ? 1 : 0,
        camera: has("android.permission.CAMERA") ? 1 : 0,

        // 위험 권한 수(“전체 권한 수” 쓰면 시스템/벤더 앱에서 오탐 폭발)
        dangerousCount: (permissions || []).filter(x => DANGEROUS_PERMS.has(x)).length,

        // 런타임 신호(여기선 boolean -> 0/1)
        runningBg: toBool(app.isRunningBg) ? 1 : 0,
        sideload: toBool(app.isSideloaded) ? 1 : 0,
        systemApp: toBool(app.isSystemApp) ? 1 : 0,
        masquerading: toBool(app.isMasquerading) ? 1 : 0,
        accessibilityEnabled: toBool(app.accessibilityEnabled) ? 1 : 0,
        overlayAllowed: toBool(app.overlayAllowed) ? 1 : 0,
    };

    return signals;
}

function masqueradeScore(app) {
    // “위장”은 단일 조건 true/false로 끝내면 오탐/미탐이 큼 -> 점수화
    // 점수 4 이상이면 masquerading true 추천
    let s = 0;

    const isSystemish = isSystemishName(app.packageName);
    const sideload = toBool(app.isSideloaded);
    const sys = toBool(app.isSystemApp);

    // 시스템처럼 보이는데 시스템앱이 아님(모순)
    if (isSystemish && !sys) s += 2;

    // 사이드로드면 강하게 의심
    if (sideload) s += 2;

    // installer가 없거나 신뢰 설치처가 아니면 의심 추가
    if (!app.installer) s += 1;
    else if (!TRUSTED_INSTALLERS.has(app.installer)) s += 1;

    return s;
}

function computeRuleScore(sig) {
    // ✅ 룰 점수: “단일 조건=100점” 같은 문제 방지
    // 오탐을 줄이려면 "조합"이 있어야 점수가 크게 올라가게 설계해야 함.
    let score = 0;

    // 설치 출처
    if (sig.sideload) score += 2;
    if (sig.masquerading) score += 3;

    // 지속성/은닉
    if (sig.boot) score += 1;
    if (sig.ignoreBatteryOpt) score += 1;
    if (sig.overlay && sig.overlayAllowed) score += 2;

    // 주요 탈취 영역(조합 보너스)
    const sensitive = sig.sms + sig.call + sig.contacts + sig.location + sig.mic + sig.camera;
    score += Math.min(4, sensitive); // 최대 4

    // 접근성(실제로 활성화된 경우)
    if (sig.accessibilityEnabled) score += 3;

    // 백그라운드 실행 중이면 약간 가산(정적-only 모델이라도 운영상 신호)
    if (sig.runningBg) score += 1;

    // 위험 권한 과다
    if (sig.dangerousCount >= 6) score += 1;
    if (sig.dangerousCount >= 10) score += 1;

    return score;
}

function gradeFrom(prob, ruleScore, isOfficialStore) {
    // AI가 낮으면 절대 올리지 않는다 (오탐 방지 최우선)
    if (prob < 0.35) return "SAFE";

    // 공식 스토어는 더 보수적으로
    const dangerProb = isOfficialStore ? 0.95 : 0.85;
    const warnProb = isOfficialStore ? 0.85 : 0.70;

    if (prob >= dangerProb && ruleScore >= (isOfficialStore ? 6 : 4)) return "DANGER";
    if (prob >= warnProb && ruleScore >= (isOfficialStore ? 5 : 3)) return "WARNING";

    return "SAFE";
}

function reasonKorean(app, sig, ruleScore, prob, isMasquerading) {
    const parts = [];

    // 설치 출처
    if (toBool(app.isSideloaded)) parts.push("외부 설치(사이드로드)");
    else if (app.installer === "com.android.vending") parts.push("Play 스토어 설치");
    else if (app.installer === "com.sec.android.app.samsungapps") parts.push("Galaxy Store 설치");
    else if (app.installer) parts.push(`설치처: ${app.installer}`);

    if (sig.boot) parts.push("부팅 후 자동 실행 가능");
    if (sig.overlay) parts.push("오버레이(화면 위 표시) 가능");
    if (sig.overlayAllowed) parts.push("오버레이 실제 허용됨");
    if (sig.ignoreBatteryOpt) parts.push("배터리 최적화 무시(상시 실행 가능)");

    if (sig.accessibilityEnabled) parts.push("접근성 서비스 활성화됨");

    if (sig.sms) parts.push("SMS 접근 권한");
    if (sig.call) parts.push("통화/전화 관련 권한");
    if (sig.contacts) parts.push("연락처 접근 권한");
    if (sig.location) parts.push("위치 접근 권한");
    if (sig.mic) parts.push("마이크 접근 권한");
    if (sig.camera) parts.push("카메라 접근 권한");

    if (toBool(app.isRunningBg)) parts.push("현재 백그라운드 실행 중");
    if (isMasquerading) parts.push("시스템 앱 위장 의심");

    // 너무 길면 상위만
    const top = parts.slice(0, 7).join(" / ");
    const score = Math.round(prob * 100);

    return `[정적AI] ${top} (AI확률 ${score}%, 룰 ${ruleScore}점)`;
}
function isOfficialStoreInstaller(app) {
    const installer = app?.installer || "";
    return TRUSTED_INSTALLERS.has(installer) && app.isSideloaded === false;
}

function isTrustedVendorPkg(pkg) {
    // 너무 넓게 잡으면 오탐 커짐 -> 삼성/구글 핵심만
    return pkg.startsWith("com.samsung.") || pkg.startsWith("com.google.") || pkg.startsWith("com.android.");
}

function clampGradeForOfficialStore(originalGrade, prob, strongSignalsCount) {
    // 공식스토어 앱은 “강한 신호”가 없으면 DANGER 금지
    // strongSignalsCount: 접근성 활성/디바이스어드민/노티리스너/런처숨김 같은 것들
    if (prob < 0.8) return "SAFE";
    if (strongSignalsCount === 0) return "SAFE";
    if (strongSignalsCount === 1) return "WARNING";
    return originalGrade; // 2개 이상이면 AI 그대로 반영 가능
}

// ✅ 이게 최종 “의사결정 엔진”
async function analyzeWithPolicy({
    serial,
    app,
    permissions,
    overlayAllowed,
    accessibilityEnabled,
    deviceAdminActive,
    notifListenerEnabled,
    hasLauncher,
    analyzeAppWithStaticModel
}) {
    const aiPayload = {
        packageName: app.packageName,
        permissions,
        isSideloaded: !!app.isSideloaded,
        isRunningBg: !!app.isRunningBg,
        isSystemApp: !!app.isSystemApp,
        isMasquerading: !!app.isMasquerading,
    };

    const ai = await analyzeAppWithStaticModel(aiPayload);

    // ai.score가 0~100이라고 가정 (기존 코드 호환)
    const prob = Math.max(0, Math.min(1, Number(
        ai.prob ?? ai.probability ?? ai.scoreProb ?? (typeof ai.score === "number" ? (ai.score / 100) : 0)
    )));

    // 강한 신호(“권한 많음”이 아니라 “실제 악용 흔적/상태”)
    const strongSignals = [
        !!accessibilityEnabled,
        !!deviceAdminActive,
        !!notifListenerEnabled,
        hasLauncher === false,                 // 런처 없음(숨김)
        !!overlayAllowed && !!accessibilityEnabled, // 접근성+오버레이 조합
    ].filter(Boolean);

    const strongCount = strongSignals.length;

    let grade = ai.grade || (prob >= 0.90 ? "DANGER" : prob >= 0.75 ? "WARNING" : "SAFE");

    const official = isOfficialStoreInstaller(app.installer) && !app.isSideloaded;

    // ✅ 공식스토어 오탐 방지(핵심)
    if (official) {
        grade = clampGradeForOfficialStore(grade, prob, strongCount);
    }

    // ✅ 사이드로드는 조금 더 공격적으로(강한신호 1개 이상이면)
    if (app.isSideloaded && prob >= 0.60 && strongCount >= 1) {
        grade = (prob >= 0.80 ? "DANGER" : "WARNING");
    }

    // 이유(한국어) - SAFE면 null 처리해서 UI 깔끔하게
    const reasons = [];
    if (official) reasons.push(app.installer === "com.sec.android.app.samsungapps" ? "Galaxy Store 설치" : "Play 스토어 설치");
    if (app.isSideloaded) reasons.push("외부 설치(사이드로드)");
    if (permissions.includes("android.permission.RECEIVE_BOOT_COMPLETED")) reasons.push("부팅 후 자동 실행 가능");
    if (permissions.includes("android.permission.SYSTEM_ALERT_WINDOW")) reasons.push("오버레이 권한 선언");
    if (overlayAllowed) reasons.push("오버레이 실제 허용(appops)");
    if (permissions.includes("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS")) reasons.push("배터리 최적화 무시");

    if (accessibilityEnabled) reasons.push("접근성 서비스 활성(강한 신호)");
    if (deviceAdminActive) reasons.push("기기 관리자 활성(강한 신호)");
    if (notifListenerEnabled) reasons.push("알림 접근(노티 리스너) 활성(강한 신호)");
    if (hasLauncher === false) reasons.push("런처 숨김(아이콘 없음)");

    const score100 = Math.round(prob * 100);

    const reason = (grade === "SAFE")
        ? null
        : `[정적AI] ${reasons.slice(0, 8).join(" / ")} (AI확률 ${score100}%)`;

    return {
        score: score100,
        grade,
        reason,
        prob,
        strongCount,
    };
}

// ============================================================
// [서명 기반 신뢰 정책] (오탐 줄이기 핵심)
// ============================================================

// ✅ 여기엔 "정상(known-good) 서명 SHA256 지문"을 넣어두면 됨.
// 처음엔 비워두고, 오탐 난 정상 앱의 서명부터 축적해도 효과 큼.
const KNOWN_GOOD_SIGNER_SHA256 = new Set([
    // 예시(가짜): "ab12cd34...",
    // "여기에 dumpsys에서 뽑은 sha256(digest) 넣기"
]);


function normalizeHex(hex) {
    if (!hex) return null;
    return String(hex).replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

function isKnownGoodSigner(signingInfo) {
    const sha = normalizeHex(signingInfo?.sha256);
    if (!sha) return false;
    return KNOWN_GOOD_SIGNER_SHA256.has(sha);
}

function countStrongSignals({ accessibilityEnabled, deviceAdminActive, notifListenerEnabled, hasLauncher, overlayAllowed }) {
    return [
        !!accessibilityEnabled,
        !!deviceAdminActive,
        !!notifListenerEnabled,
        hasLauncher === false,                 // 런처 없음(숨김)
        !!overlayAllowed && !!accessibilityEnabled, // 접근성+오버레이 실제 허용 조합
    ].filter(Boolean).length;
}

// ✅ 공식스토어든 뭐든, "서명 good"이면 등급을 강제로 낮춰 오탐 방지
function applySignerPolicy({ grade, prob, isGoodSigner, strongCount }) {
    if (!isGoodSigner) return grade;

    // 서명 good인데도 DANGER/WARNING을 주려면 "실제 악용 상태"가 있어야 함
    if (strongCount === 0) return "SAFE";
    if (strongCount === 1) return "WARNING";

    // strongCount >= 2일 때만 원래 grade를 유지(여기서도 prob 낮으면 하향 가능)
    if (prob < 0.85) return "WARNING";
    return grade;
}

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

        // [Step B] 앱 및 파일 데이터 수집
        const allApps = await AndroidService.getInstalledApps(serial);
        const apkFiles = await AndroidService.findApkFiles(serial);
        const networkMap = await AndroidService.getNetworkUsageMap(serial);

        // ✅ 접근성 활성 목록은 1번만
        const enabledAccServicesStr = await AndroidService.getEnabledAccessibilityServices(serial);
        console.log(enabledAccServicesStr)
        const processedApps = [];
        let aiCount = 0;

        // 20개씩 끊어서 처리
        for (let i = 0; i < allApps.length; i += 20) {
            const chunk = allApps.slice(i, i + 20);

            const results = await Promise.all(chunk.map(async (app) => {
                try {
                    // [1] 기본 정보 수집 (기존과 동일)
                    const [isRunningBg, permData, signingInfo] = await Promise.all([
                        AndroidService.checkIsRunningBackground(serial, app.packageName),
                        AndroidService.getAppPermissions(serial, app.packageName),
                        AndroidService.getSigningInfo(serial, app.packageName),
                    ]);

                    const combinedPermissions = [
                        ...(permData.requestedList || []),
                        ...(permData.grantedList || []),
                    ];
                    const permissions = [...new Set(combinedPermissions)];

                    const netStats = networkMap[app.uid] || { rx: 0, tx: 0 };

                    // boolean 정규화
                    app.isSystemApp = toBool(app.isSystemApp);
                    app.isSideloaded = toBool(app.isSideloaded);
                    app.isRunningBg = toBool(isRunningBg);

                    // ✅ (추가) 접근성 실제 활성 여부
                    const accessibilityEnabled = await AndroidService.isAccessibilityEnabledForPackage(
                        serial,
                        app.packageName,
                        enabledAccServicesStr
                    );

                    // ✅ (추가) 오버레이 실제 허용(appops)
                    const declaresOverlay = permissions.includes("android.permission.SYSTEM_ALERT_WINDOW");
                    const overlayAllowed = declaresOverlay
                        ? await AndroidService.getAppOpAllowed(serial, app.packageName, "SYSTEM_ALERT_WINDOW")
                        : false;

                    // ✅ (추가) Device Admin / Notification Listener / Launcher 숨김
                    const [deviceAdminActive, notifListenerEnabled, hasLauncher] = await Promise.all([
                        AndroidService.isDeviceAdminActive(serial, app.packageName),
                        AndroidService.isNotificationListenerEnabled(serial, app.packageName),
                        AndroidService.hasLauncherActivity(serial, app.packageName),
                    ]);
                    
                    // [2-2] 위장술(Masquerading) 최종 판정 (네 원칙 유지 + 점수화 권장)
                    // 이미 getInstalledApps에서 isMasquerading이 계산될 수 있으니, 여기서는 그대로 존중
                    // 단, getInstalledApps에서 계산 안하면 fallback:
                    if (typeof app.isMasquerading !== "boolean") {
                        const trustedPrefixes = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'com.qualcomm.', 'com.qti.', 'android'];
                        const isTrustedName = trustedPrefixes.some(prefix => app.packageName.startsWith(prefix));
                        app.isMasquerading = (isTrustedName && !app.isSystemApp && app.isSideloaded);
                    }

                    // ✅ 시스템 앱은 AI 검사 제외(위장 제외)
                    if (app.isSystemApp && !app.isMasquerading) {
                        return {
                            ...app,
                            isRunningBg: app.isRunningBg,
                            ...permData,
                            dataUsage: netStats,
                            aiScore: 0,
                            aiGrade: "SAFE",
                            reason: null,
                            accessibilityEnabled,
                            overlayAllowed,
                            deviceAdminActive,
                            notifListenerEnabled,
                            hasLauncher,
                        };
                    }

                    // ✅ 0.5) 공식 스토어 앱이면 검사 자체를 스킵 
                    if (isOfficialStoreInstaller(app)) {
                        return {
                            ...app,
                            isRunningBg: app.isRunningBg,
                            ...permData,
                            dataUsage: netStats,
                            aiScore: 0,
                            aiGrade: "SAFE",
                            reason: null, // 또는 "[정책] 공식 스토어 앱은 검사 제외"
                        };
                    }


                    // [2-3] AI + 정책 기반 최종 판단
                    const aiFinal = await analyzeWithPolicy({
                        serial,
                        app,
                        permissions,
                        overlayAllowed,
                        accessibilityEnabled,
                        deviceAdminActive,
                        notifListenerEnabled,
                        hasLauncher,
                        analyzeAppWithStaticModel,
                    });
                    
                    const strongCount = countStrongSignals({
                        accessibilityEnabled,
                        deviceAdminActive,
                        notifListenerEnabled,
                        hasLauncher,
                        overlayAllowed
                    });

                    const isGoodSigner = isKnownGoodSigner(signingInfo);

                    // ✅ 서명 정책 적용(오탐 줄이기)
                    const finalGrade = applySignerPolicy({
                        grade: aiFinal.grade,
                        prob: aiFinal.prob ?? (aiFinal.score / 100),
                        isGoodSigner,
                        strongCount
                    });

                    console.log(finalGrade)
                    aiCount += 1;

                    return {
                        ...app,
                        isRunningBg: app.isRunningBg,
                        ...permData,
                        dataUsage: netStats,
                        aiScore: aiFinal.score,
                        aiGrade: finalGrade,
                        reason: aiFinal.reason,
                        accessibilityEnabled,
                        overlayAllowed,
                        deviceAdminActive,
                        notifListenerEnabled,
                        hasLauncher,
                    };

                } catch (e) {
                    console.error(`Error analyzing ${app.packageName}:`, e);
                    return { ...app, error: true };
                }
            }));

            processedApps.push(...results);
        }

        console.log("AI inference count:", aiCount);

        // ---------------------------------------------------------
        // 결과 필터링 (위험한 것만 추출)
        const suspiciousApps = processedApps.filter(app => app.aiGrade === 'DANGER' || app.aiGrade === 'WARNING');

        // [Step E] (선택) VirusTotal 2차 정밀 검사 - “정책 통과한 것만” + “공식스토어는 기본 스킵” 추천
        // if (suspiciousApps.length > 0 && CONFIG.VIRUSTOTAL_API_KEY && CONFIG.VIRUSTOTAL_API_KEY !== 'your_key') {
        //   const vtTargets = suspiciousApps.filter(a => a.isSideloaded || a.isMasquerading || a.deviceAdminActive || a.accessibilityEnabled);
        //   console.log(`🌐 VT 정밀 검사 진행 (${vtTargets.length}개)`);
        //   await AndroidService.runVirusTotalCheck(serial, vtTargets);
        // }

        return { deviceInfo, allApps: processedApps, suspiciousApps, apkFiles };

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
        const cmd = `ideviceinfo -u ${udid}`;
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

            if (deviceInfo.phoneNumber === '-') {
                try {
                    const plistContent = fs.readFileSync(path.join(specificBackupPath, 'Info.plist'), 'utf8');
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
            await Utils.runCommand(`"${IOS_BACKUP}" backup --full "${TEMP_BACKUP}" -u ${udid}`);
            console.log('[iOS] 백업 완료.');
        }

        // [Step 4] MVT 분석 실행
        console.log('3. MVT 분석 시작...');
        let mvtCmd = `mvt-ios`;

        const finalCmd = `${mvtCmd} check-backup --output "${MVT_RESULT}" "${specificBackupPath}"`;

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

ipcMain.handle('saveScanResult', async (event, data) => {
    // 💡 data: { deviceInfo: {...}, allApps: [...], ... } 전체 검사 결과 객체
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
        const searchPaths = [
            '/storage/emulated/0/Download',
            '/storage/emulated/0/Documents',
            '/storage/emulated/0/Android/data',
            '/storage/emulated/0',
            '/data/local/tmp'
        ];

        let allApkPaths = new Set();

        console.log('🔄 [Android] APK 파일 검색 시작: 내부 저장소 주요 경로 검색');

        for (const searchPath of searchPaths) {
            try {
                const command = `find "${searchPath}" -type f -iname "*.apk" 2>/dev/null`;
                const output = await client.shell(serial, command);
                const data = (await adb.util.readAll(output)).toString();

                const foundFiles = data.trim().split('\n').filter(l => l.length > 0 && l.endsWith('.apk'));
                foundFiles.forEach(file => allApkPaths.add(file.trim()));

            } catch (e) {
                console.warn(`⚠️ [Android] APK 검색 중 통신 오류 (${searchPath}): ${e.message}`);
            }
        }

        return Array.from(allApkPaths);
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
                    app.reason = `[VT 미확인] 신종 의심 + ` + app.reason;
                }
                fs.unlinkSync(tempPath);
            } catch (e) {
                console.error(`VT 검사 오류 (${app.packageName})`)
                app.vtResult = { error: "검사 불가" };
            }
        }
    },
    // (추가) 해당 패키지가 접근성 활성인지
    async isAccessibilityEnabledForPackage(serial, packageName, cachedServicesString = null) {
        let s = cachedServicesString;

        if (s == null) {
            s = await AndroidService.getEnabledAccessibilityServices(serial);
        }

        // 무조건 문자열로 강제
        if (typeof s !== "string") {
            try { s = String(s); } catch { return false; }
        }

        if (!s || s === "null") return false;

        const items = s.split(":").map(x => x.trim()).filter(Boolean);
        return items.some(x => x.startsWith(packageName + "/") || x === packageName);
    },

    // ---------------------------
    // (추가, 옵션) AppOps가 실제 허용인지 확인
    // overlay는 "SYSTEM_ALERT_WINDOW"
    async getAppOpAllowed(serial, packageName, op) {
        // appops 출력은 기기/버전에 따라 다름.
        // 예) "SYSTEM_ALERT_WINDOW: allow"
        // 예) "SYSTEM_ALERT_WINDOW: deny"
        // 예) "SYSTEM_ALERT_WINDOW: default"
        try {
            const out = await this.adbShell(serial, `appops get ${packageName} ${op}`);
            const line = (out || "").toLowerCase();
            if (line.includes("allow")) return true;
            if (line.includes("deny")) return false;
            // default면 확정 불가 -> false 취급(오탐 방지)
            return false;
        } catch {
            // 접근 불가/실패 -> false 취급(오탐 방지)
            return false;
        }
    },
    async getEnabledAccessibilityServices(serial) {
        try {
            const s = await AndroidService.adbShell(
                serial,
                "settings get secure enabled_accessibility_services"
            );

            if (!s || s === "null") return "";
            return String(s);
        } catch (e) {
            return "";
        }
    },
    async getSigningInfo(serial, packageName) {
        try {
            const dumpsys = await AndroidService.adbShell(serial, `dumpsys package ${packageName}`);

            // 1) SigningInfo 영역에서 certificate digest 패턴 찾기
            // 예: "SHA-256 digest: 12:34:..."
            const sha256Match = dumpsys.match(/SHA-256 digest:\s*([0-9A-Fa-f:]+)/);
            const sha256 = sha256Match ? sha256Match[1].replace(/:/g, "").toLowerCase() : null;

            // 2) Subject / Issuer 같은 문자열이 있는 경우(일부 기기)
            const issuerMatch = dumpsys.match(/Issuer:\s*(.*)/i);
            const subjectMatch = dumpsys.match(/Subject:\s*(.*)/i);

            const issuer = issuerMatch ? issuerMatch[1].trim() : null;
            const subject = subjectMatch ? subjectMatch[1].trim() : null;

            return { sha256, issuer, subject };
        } catch {
            return { sha256: null, issuer: null, subject: null };
        }
    },
    async hasLauncherActivity(serial, packageName) {
        try {
            // cmd package resolve-activity는 일부 기기에서 잘 됨
            const out = await AndroidService.adbShell(
                serial,
                `cmd package resolve-activity --brief ${packageName}`
            );

            // 정상이라면 컴포넌트가 찍힘
            // 결과가 empty/No activity면 런처 없음으로 봄
            if (!out) return false;
            const low = out.toLowerCase();
            if (low.includes("no activity") || low.includes("not found")) return false;

            return true;
        } catch {
            // 실패하면 런처 있음으로 보수 처리(오탐 방지)
            return true;
        }
    },
    // ✅ Device Admin 활성 여부(강한 악성 신호)
    async isDeviceAdminActive(serial, packageName) {
        try {
            const out = await AndroidService.adbShell(serial, "dumpsys device_policy");
            const low = (out || "").toLowerCase();
            return low.includes(packageName.toLowerCase());
        } catch {
            return false;
        }
    },
    // ✅ Notification Listener 활성 여부
    async isNotificationListenerEnabled(serial, packageName) {
        try {
            const s = await AndroidService.adbShell(
                serial,
                "settings get secure enabled_notification_listeners"
            );
            if (!s || s === "null") return false;
            return String(s).toLowerCase().includes(packageName.toLowerCase());
        } catch {
            return false;
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
