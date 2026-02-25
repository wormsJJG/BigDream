/**
 * Auto-extracted from legacy bootstrap.js for maintainable structure.
 * Responsibility: iOS domain operations only (no IPC wiring).
 */
const { evaluateAppRisk } = require('../../shared/risk/riskRules');
const { spawn } = require('child_process');

const noop = () => { };

function isBoolTrue(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (v === 1) return true;
    if (v === 0) return false;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return (s === 'true' || s === '1' || s === 'yes' || s === 'y');
    }
    return false;
}

function safeEmit(onProgress, payload) {
    try {
        (onProgress || noop)(payload);
    } catch (_e) { }
}


function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = b;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
    }
    const digits = (i <= 1) ? 0 : 1;
    return `${v.toFixed(digits)}${units[i]}`;
}

function getDirectoryStats(fs, path, dirPath) {
    let bytes = 0;
    let files = 0;

    const stack = [dirPath];
    while (stack.length) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (_e) {
            continue;
        }

        for (const ent of entries) {
            const full = path.join(current, ent.name);
            try {
                if (ent.isDirectory()) {
                    stack.push(full);
                } else if (ent.isFile()) {
                    files += 1;
                    const st = fs.statSync(full);
                    bytes += st.size || 0;
                }
            } catch (_e) { }
        }
    }

    return { bytes, files };
}

function estimateTotalFromGrowth(current, prevEstimate, { base, ratio }) {
    const c = Math.max(0, Number(current) || 0);
    const p = Math.max(0, Number(prevEstimate) || 0);

    // Estimate = current * ratio + base, monotonically increasing.
    const est = (c * ratio) + base;
    return Math.max(p, est);
}
function parseBackupProgressLine(line) {
    const s = String(line || '');
    // Common patterns:
    //  - [185/328]
    //  - 185/328
    //  - 185 of 328
    let m = s.match(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]/);
    if (!m) m = s.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (!m) m = s.match(/\b(\d+)\s+of\s+(\d+)\b/i);
    if (!m) return null;

    const cur = Number(m[1]);
    const total = Number(m[2]);
    if (!Number.isFinite(cur) || !Number.isFinite(total) || total <= 0) return null;
    return { cur, total };
}

function clampPercent(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.floor(n)));
}

function spawnWithLineStream(command, args, { onLine, cwd, shell } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args || [], {
            cwd: cwd || undefined,
            shell: !!shell,
            windowsHide: true
        });

        let stdoutBuf = '';
        let stderrBuf = '';

        const flush = (buf, isErr) => {
            // Some tools print progress with carriage returns (\r) without newlines.
            const parts = String(buf).split(/[\r\n]+/);
            const last = parts.pop();
            for (const line of parts) {
                if (line && onLine) onLine(line, isErr);
            }
            return last || '';
        };

        if (child.stdout) {
            child.stdout.on('data', (chunk) => {
                stdoutBuf += chunk.toString();
                stdoutBuf = flush(stdoutBuf, false);
            });
        }
        if (child.stderr) {
            child.stderr.on('data', (chunk) => {
                stderrBuf += chunk.toString();
                stderrBuf = flush(stderrBuf, true);
            });
        }

        child.on('error', (err) => reject(err));
        child.on('close', (code) => resolve({ code }));
    });
}

function createIosService({ fs, path, os, log, CONFIG, Utils }) {
    // NOTE: bootstrap.js passes a single options object.
    if (!fs) throw new Error('createIosService requires fs');
    const service = {

        /**
         * Check iOS device connection using configured idevice tools.
         */
        async checkConnection() {
            console.log(`[iOS] 연결 확인 시작: ${CONFIG.PATHS.IOS_ID}`);
            try {
                const cmdId = `"${CONFIG.PATHS.IOS_ID}" -l`;
                const udidOutput = await Utils.runCommand(cmdId);
                const udid = (udidOutput || '').trim();

                if (!udid) return { status: 'disconnected' };

                const cmdInfo = `"${CONFIG.PATHS.IOS_INFO}" -k DeviceName`;
                const nameOutput = await Utils.runCommand(cmdInfo);
                const modelName = nameOutput ? nameOutput.trim() : 'iPhone Device';
                return { status: 'connected', model: modelName, udid, type: 'ios' };
            } catch (error) {
                const detailedError = error.message || 'iOS 도구 실행 중 알 수 없는 오류';
                if (!fs.existsSync(CONFIG.PATHS.IOS_ID)) {
                    return { status: 'error', error: `필수 도구 파일 없음: ${CONFIG.PATHS.IOS_ID}` };
                }
                console.error(`❌ [iOS] 연결 확인 실패 상세: ${detailedError}`);
                let userMsg = 'iOS 기기 연결 오류. iTunes/Apple 드라이버가 설치되었는지 확인하세요.';
                if (detailedError.includes('command failed')) {
                    userMsg = "iOS 도구 실행 실패. 기기가 잠금 해제되었는지, '이 컴퓨터 신뢰'를 수락했는지 확인하세요.";
                }
                return { status: 'error', error: userMsg };
            }
        },

        /**
         * Full iOS scan pipeline (backup -> mvt -> parse).
         */
        async runScan(udid, options = {}) {
            console.log(`--- [iOS] 정밀 분석 시작 (UDID: ${udid}) ---`);
            const { TEMP_BACKUP, MVT_RESULT, IOS_BACKUP } = CONFIG.PATHS;
            const specificBackupPath = path.join(TEMP_BACKUP, udid);
            const backupMetaPath = path.join(specificBackupPath, 'bd_backup_meta.json');
            const onProgress = options.onProgress || noop;

            try {
                let isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));

                // 백업 캐시 신뢰성 강화:
                // - 이전 실행에서 중간에 꺼졌다면 폴더는 남을 수 있음
                // - '완료된 백업'만 재사용해야 함
                const manifestDb = path.join(specificBackupPath, 'Manifest.db');
                let meta = null;
                if (fs.existsSync(backupMetaPath)) {
                    try {
                        meta = JSON.parse(fs.readFileSync(backupMetaPath, 'utf8'));
                    } catch (_e) {
                        meta = null;
                    }
                }

                const hasManifest = fs.existsSync(manifestDb);
                const metaSaysComplete = !!(meta && meta.complete === true);

                if (isBackupComplete && hasManifest && metaSaysComplete) {
                    safeEmit(onProgress, {
                        step: 1,
                        totalSteps: 2,
                        stage: 'backup',
                        percent: 100,
                        message: '(1/2) 기존 백업 데이터 확인 완료 ✅'
                    });
                } else if (isBackupComplete || fs.existsSync(specificBackupPath)) {
                    // Status.plist가 있어도 중간 종료/불완전일 수 있으므로, 메타/Manifest 기준으로 확실히 분기
                    if (isBackupComplete && hasManifest && !meta) {
                        // 메타가 없지만 백업 산출물이 존재하면, 실제 완료 가능성이 높으므로 메타를 재구성해 저장
                        try {
                            const stat = getDirectoryStats(fs, path, specificBackupPath);
                            fs.writeFileSync(backupMetaPath, JSON.stringify({
                                complete: true,
                                totalBytes: stat.bytes,
                                totalFiles: stat.files,
                                reconstructedAt: Date.now()
                            }, null, 2));
                            meta = { complete: true, totalBytes: stat.bytes, totalFiles: stat.files };
                            safeEmit(onProgress, {
                                step: 1,
                                totalSteps: 2,
                                stage: 'backup',
                                percent: 100,
                                message: '(1/2) 기존 백업 데이터 확인 완료 ✅'
                            });
                        } catch (_e) {
                            isBackupComplete = false;
                        }
                    } else {
                        // 불완전 캐시로 판단 -> 새 백업을 위해 제거
                        isBackupComplete = false;
                        try {
                            if (fs.existsSync(specificBackupPath)) {
                                fs.rmSync(specificBackupPath, { recursive: true, force: true });
                            }
                        } catch (_e) { }
                    }
                }

                if (!isBackupComplete) {
                    console.log('[iOS] 신규 검사를 위해 백업을 시작합니다...');

                    safeEmit(onProgress, {
                        step: 1,
                        totalSteps: 2,
                        stage: 'backup',
                        percent: 0,
                        message: '(1/2) 아이폰 백업 진행 중...'
                    });

                    try {
                        await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => { });
                        await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => { });
                    } catch (_e) { }

                    if (fs.existsSync(specificBackupPath)) {
                        fs.rmSync(specificBackupPath, { recursive: true, force: true });
                    }
                    if (!fs.existsSync(TEMP_BACKUP)) fs.mkdirSync(TEMP_BACKUP, { recursive: true });

                    // ✅ Progress 우선순위:
                    // 1) idevicebackup2 출력에서 (cur/total) 파싱 가능하면 -> 진짜 비율
                    // 2) 출력이 없으면 -> 백업 폴더 증가(파일/바이트) 기반으로 '튀지 않게' 상승
                    let lastPct = 0;
                    let lastCount = null;
                    let lastStat = { bytes: 0, files: 0 };

                    // 중간 종료 케이스를 확실히 구분하기 위한 메타(불완료로 시작)
                    try {
                        fs.writeFileSync(backupMetaPath, JSON.stringify({
                            complete: false,
                            startedAt: Date.now()
                        }, null, 2));
                    } catch (_e) { }

                    // fallback ticker
                    let ticker = null;
                    let estTotalBytes = 0;
                    let estTotalFiles = 0;

                    const startTicker = () => {
                        ticker = setInterval(() => {
                            try {
                                if (!fs.existsSync(specificBackupPath)) {
                                    safeEmit(onProgress, {
                                        step: 1,
                                        totalSteps: 2,
                                        stage: 'backup',
                                        percent: Math.max(0, lastPct),
                                        message: '아이폰 백업 진행 중...'
                                    });
                                    return;
                                }

                                const stat = getDirectoryStats(fs, path, specificBackupPath);
                                lastStat = stat;

                                // meta 기반 total이 있으면 최대한 비례로 계산
                                let metaNow = null;
                                try {
                                    if (fs.existsSync(backupMetaPath)) {
                                        metaNow = JSON.parse(fs.readFileSync(backupMetaPath, 'utf8'));
                                    }
                                } catch (_e) { metaNow = null; }

                                const knownTotalBytes = metaNow && metaNow.totalBytes ? Number(metaNow.totalBytes) : 0;
                                const knownTotalFiles = metaNow && metaNow.totalFiles ? Number(metaNow.totalFiles) : 0;

                                // total이 없으면, 성장 기반으로 "튀지 않게" estimate (현재*1.3 + 500MB / 현재*1.3 + 200개)
                                const BASE_BYTES = 500 * 1024 * 1024;
                                const BASE_FILES = 200;

                                estTotalBytes = knownTotalBytes > 0
                                    ? knownTotalBytes
                                    : estimateTotalFromGrowth(stat.bytes, estTotalBytes, { base: BASE_BYTES, ratio: 1.3 });

                                estTotalFiles = knownTotalFiles > 0
                                    ? knownTotalFiles
                                    : estimateTotalFromGrowth(stat.files, estTotalFiles, { base: BASE_FILES, ratio: 1.3 });

                                const pctByBytes = estTotalBytes > 0 ? (stat.bytes / estTotalBytes) * 90 : 0;
                                const pctByFiles = estTotalFiles > 0 ? (stat.files / estTotalFiles) * 90 : 0;

                                // 둘 중 더 "느리게" 가는 걸 택해 과속(튀는 %) 방지
                                const pct = Math.min(90, clampPercent(Math.min(pctByBytes, pctByFiles)));

                                if (pct > lastPct) {
                                    lastPct = pct;
                                }

                                safeEmit(onProgress, {
                                    step: 1,
                                    totalSteps: 2,
                                    stage: 'backup',
                                    percent: lastPct,
                                    bytes: stat.bytes,
                                    files: stat.files,
                                    message: `아이폰 백업 진행 중... (${formatBytes(stat.bytes)} / 파일 ${stat.files.toLocaleString('en-US')}개)`
                                });
                            } catch (_e) { }
                        }, 1000);
                    };

                    const stopTicker = () => {
                        if (ticker) clearInterval(ticker);
                        ticker = null;
                    };

                    let disconnected = false;
                    let watch = null;

                    try {
                        startTicker();

                        // ✅ Device disconnect watchdog (during backup only)
                        // If the cable is unplugged while idevicebackup2 is running, the process may hang.
                        // We poll idevice_id -l and force-kill idevicebackup2 when the device disappears,
                        // so the UI can fail fast with a clear message.
                        const watchIntervalMs = 1200;
                        watch = setInterval(async () => {
                            if (disconnected) return;
                            try {
                                const out = await Utils.runCommand(`"${CONFIG.PATHS.IOS_ID}" -l`);
                                const udids = String(out || '').trim();
                                if (!udids) {
                                    disconnected = true;
                                    safeEmit(onProgress, {
                                        step: 1,
                                        totalSteps: 2,
                                        stage: 'backup',
                                        percent: Math.max(0, Math.min(99, lastPct)),
                                        message: '⚠️ iOS 기기 연결이 끊겼습니다. 케이블 연결/신뢰 상태를 확인해주세요.'
                                    });

                                    // kill hanging tools (Windows)
                                    try { await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => { }); } catch (_e) { }
                                    try { await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => { }); } catch (_e) { }
                                }
                            } catch (_e) {
                                // ignore polling errors
                            }
                        }, watchIntervalMs);

                        await spawnWithLineStream(IOS_BACKUP, ['backup', '--full', TEMP_BACKUP, '-u', udid], {
                            onLine: (line) => {
                                const parsed = parseBackupProgressLine(line);
                                if (!parsed) return;

                                const pctRaw = (parsed.cur / parsed.total) * 100;
                                const pct = Math.min(99, clampPercent(pctRaw));

                                if (pct === lastPct && lastCount && lastCount.cur === parsed.cur) {
                                    return;
                                }

                                lastCount = parsed;

                                // 출력 기반 percent는 가장 신뢰도가 높으므로 lastPct를 갱신
                                if (pct > lastPct) {
                                    lastPct = pct;
                                }

                                safeEmit(onProgress, {
                                    step: 1,
                                    totalSteps: 2,
                                    stage: 'backup',
                                    percent: lastPct,
                                    current: parsed.cur,
                                    total: parsed.total,
                                    message: `) 아이폰 백업 진행 중... (${parsed.cur}/${parsed.total})`
                                });
                            }
                        });

                        console.log('[iOS] 백업 명령어 수행 완료.');
                    } catch (_backupErr) {
                        console.warn('[iOS] 백업 종료 과정에서 경고가 발생했으나, 데이터 무결성을 확인합니다...');
                    } finally {
                        stopTicker();
                        if (watch) clearInterval(watch);
                        watch = null;
                    }



                    if (disconnected) {
                        throw new Error('iOS 기기 연결이 끊겼습니다. 케이블 연결 상태를 확인하고 다시 시도해주세요.');
                    }

                    isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));
                }

                if (!isBackupComplete) {
                    throw new Error('백업 데이터가 생성되지 않았습니다. 아이폰 연결 상태를 확인해주세요.');
                }

                // 백업 완료 메타 기록 (다음 실행에서 total 기반 % 계산 가능)
                try {
                    const stat = getDirectoryStats(fs, path, specificBackupPath);
                    fs.writeFileSync(backupMetaPath, JSON.stringify({
                        complete: true,
                        totalBytes: stat.bytes,
                        totalFiles: stat.files,
                        completedAt: Date.now()
                    }, null, 2));
                } catch (_e) { }

                safeEmit(onProgress, {
                    step: 1,
                    totalSteps: 2,
                    stage: 'backup',
                    percent: 100,
                    message: '아이폰 백업 완료 ✅'
                });

                console.log('[iOS] 🚀 데이터 확보 확인! 즉시 정밀 분석 단계로 전환합니다.');

                let deviceInfo = { model: 'iPhone', serial: udid, phoneNumber: '-', os: 'iOS' };
                try {
                    const plistPath = path.join(specificBackupPath, 'Info.plist');
                    if (fs.existsSync(plistPath)) {
                        const content = fs.readFileSync(plistPath, 'utf8');
                        deviceInfo.model = content.match(/<key>Product Type<\/key>\s*<string>(.*?)<\/string>/)?.[1] || 'iPhone';
                        deviceInfo.phoneNumber = content.match(/<key>PhoneNumber<\/key>\s*<string>(.*?)<\/string>/)?.[1] || '-';
                        const version = content.match(/<key>Product Version<\/key>\s*<string>(.*?)<\/string>/)?.[1];
                        if (version) deviceInfo.os = `iOS ${version}`;
                    }
                } catch (e) {
                    console.warn('기기 정보 추출 실패(무시하고 진행):', e.message);
                }

                Utils.cleanDirectory(MVT_RESULT);
                if (!fs.existsSync(MVT_RESULT)) fs.mkdirSync(MVT_RESULT);

                console.log('3. MVT 분석 엔진 가동...');
                safeEmit(onProgress, {
                    step: 2,
                    totalSteps: 2,
                    stage: 'mvt',
                    percent: 0,
                    message: 'MVT 정밀 분석 시작...'
                });

                // MVT 진행률: 산출물 폴더 파일/바이트 증가 기반 (튀지 않게)
                let mvtTicker = null;
                let mvtLastPct = 0;
                let mvtEstFiles = 0;
                let mvtEstBytes = 0;

                const startMvtTicker = () => {
                    mvtTicker = setInterval(() => {
                        try {
                            const stat = getDirectoryStats(fs, path, MVT_RESULT);

                            const BASE_FILES = 50;
                            const BASE_BYTES = 50 * 1024 * 1024;

                            mvtEstFiles = estimateTotalFromGrowth(stat.files, mvtEstFiles, { base: BASE_FILES, ratio: 1.3 });
                            mvtEstBytes = estimateTotalFromGrowth(stat.bytes, mvtEstBytes, { base: BASE_BYTES, ratio: 1.3 });

                            const pctByFiles = mvtEstFiles > 0 ? (stat.files / mvtEstFiles) * 95 : 0;
                            const pctByBytes = mvtEstBytes > 0 ? (stat.bytes / mvtEstBytes) * 95 : 0;

                            const pct = Math.min(95, clampPercent(Math.min(pctByFiles, pctByBytes)));

                            if (pct > mvtLastPct) {
                                mvtLastPct = pct;
                            }

                            safeEmit(onProgress, {
                                step: 2,
                                totalSteps: 2,
                                stage: 'mvt',
                                percent: mvtLastPct,
                                // UI 문구: '산출물' 표현 제거 (개수만 표시)
                                message: `MVT 정밀 분석 진행 중... (${stat.files.toLocaleString('en-US')}개)`
                            });
                        } catch (_e) { }
                    }, 1000);
                };

                const stopMvtTicker = () => {
                    if (mvtTicker) clearInterval(mvtTicker);
                    mvtTicker = null;
                };

                const mvtCmd = `mvt-ios check-backup --output "${MVT_RESULT}" "${specificBackupPath}"`;
                try {
                    startMvtTicker();
                    await Utils.runCommand(mvtCmd).catch(() => console.warn('MVT 실행 중 경고 무시'));
                } finally {
                    stopMvtTicker();
                }

                safeEmit(onProgress, {
                    step: 2,
                    totalSteps: 2,
                    stage: 'mvt',
                    percent: 100,
                    message: ' MVT 정밀 분석 완료 ✅'
                });

                const results = service.parseMvtResults(MVT_RESULT, deviceInfo);
                console.log('[iOS] 전체 프로세스 완료. 결과 화면으로 넘어갑니다.');
                return results;
            } catch (err) {
                console.error('iOS 검사 프로세스 오류:', err.message);
                return { error: '검사 실패: ' + err.message };
            }
        },

        async deleteBackup(udid) {
            console.log(`--- [Security] 삭제 요청 수신 (전달된 UDID: ${udid}) ---`);
            if (!udid) return { success: false, error: 'No UDID provided' };
            if (isBoolTrue(CONFIG.KEEP_BACKUP)) {
                console.log('[Maintenance] KEEP_BACKUP 활성화 상태: 파일을 유지합니다.');
                return { success: true };
            }
            try {
                const specificPath = path.join(CONFIG.PATHS.TEMP_BACKUP, udid);
                if (fs.existsSync(specificPath)) {
                    fs.rmSync(specificPath, { recursive: true, force: true });
                    console.log('[Security] 배포 모드: 백업 데이터 파기 성공.');
                }
                return { success: true };
            } catch (err) {
                console.error('[Security] 삭제 오류:', err.message);
                return { success: false, error: err.message };
            }
        },

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
                        'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus',
                        'iPhone17,5': 'iPhone 16e',

                        'iPhone18,1': 'iPhone 17 Pro',
                        'iPhone18,2': 'iPhone 17 Pro Max',
                        'iPhone18,3': 'iPhone 17',
                        'iPhone18,4': 'iPhone Air',

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


            // 개인정보 유출 위협(Privacy Risk) - iOS 앱 목록 기반 (RiskRules 공통 로직)
            const privacyThreatApps = (installedApps || [])
                .map((app) => evaluateAppRisk('ios', app).card)
                .filter(Boolean);

            return {
                deviceInfo: finalDeviceInfo,
                suspiciousItems: findings,
                allApps: installedApps,
                privacyThreatApps,
                fileCount: fileCount,
                mvtResults: mvtResults
            };
        }
    };
    return service;
}

module.exports = { createIosService };
