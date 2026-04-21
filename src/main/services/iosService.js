/**
 * Auto-extracted from legacy bootstrap.js for maintainable structure.
 * Responsibility: iOS domain operations only (no IPC wiring).
 */
const { evaluateAppRisk } = require('../../shared/risk/riskRules');
const { spawn } = require('child_process');

const noop = () => { };
const IOS_TRUST_PROMPT_MESSAGE = "검사를 위해 iPhone에서 PIN 입력 후 '이 컴퓨터 신뢰'를 승인해주세요.";

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

async function removeDirectorySafe(fs, targetPath) {
    if (!targetPath) return false;

    try {
        await fs.promises.rm(targetPath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 300
        });
        return true;
    } catch (err) {
        if (err && err.code === 'ENOENT') return false;
        throw err;
    }
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

    let m = s.match(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]/);
    if (!m) m = s.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (!m) m = s.match(/\b(\d+)\s+of\s+(\d+)\b/i);
    if (!m) return null;

    const cur = Number(m[1]);
    const total = Number(m[2]); 

    if (!Number.isFinite(cur) || !Number.isFinite(total) || total <= 0) return null;
    if (cur < 0 || cur > total) return null;

    return { cur, total };
}

function clampPercent(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.floor(n)));
}

function randomIntInclusive(min, max) {
    const lo = Math.ceil(Number(min) || 0);
    const hi = Math.floor(Number(max) || 0);
    if (hi <= lo) return lo;
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function normalizeIosProgressPolicy(v) {
    const s = String(v || '').trim().toLowerCase();
    return s === 'random_20_30' ? 'random_20_30' : 'real';
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
    const validatePairing = async (udid) => {
        const pairTool = CONFIG?.PATHS?.IOS_PAIR;
        if (!pairTool || !fs.existsSync(pairTool)) {
            return { ok: true, skipped: true };
        }

        try {
            const output = await Utils.runCommand(`"${pairTool}" validate -u ${udid}`);
            const normalized = String(output || '').trim().toLowerCase();
            const isValidated =
                normalized.includes('success') ||
                normalized.includes('validated') ||
                normalized.includes('paired');

            return isValidated
                ? { ok: true }
                : { ok: false, message: 'iOS 신뢰/페어링 확인이 완료되지 않았습니다.' };
        } catch (error) {
            const msg = String(error?.message || error || '').toLowerCase();
            if (
                msg.includes('passwordprotected') ||
                msg.includes('passcode') ||
                msg.includes('locked') ||
                msg.includes('pair') ||
                msg.includes('trust')
            ) {
                return { ok: false, message: '아이폰 잠금 해제 또는 "이 컴퓨터 신뢰" 승인이 완료되지 않았습니다.' };
            }
            return { ok: false, message: 'iOS 신뢰/페어링 상태를 확인하지 못했습니다.' };
        }
    };
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

                const pairing = await validatePairing(udid);
                if (!pairing.ok) {
                    return { status: 'unauthorized', error: pairing.message };
                }

                const cmdInfo = `"${CONFIG.PATHS.IOS_INFO}" -u ${udid} -k DeviceName`;
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
            const progressPolicy = normalizeIosProgressPolicy(options.progressPolicy);
            let backupElapsedSec = null;
            let scanStartAt = null;

            try {
                const pairing = await validatePairing(udid);
                if (!pairing.ok) {
                    throw new Error(pairing.message);
                }

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

                safeEmit(onProgress, {
                    step: 1,
                    totalSteps: 2,
                    stage: 'device-check',
                    trustConfirmed: false,
                    percent: 0,
                    message: IOS_TRUST_PROMPT_MESSAGE
                });

                if (isBackupComplete && hasManifest && metaSaysComplete) {
                    safeEmit(onProgress, {
                        step: 1,
                        totalSteps: 2,
                        stage: 'device-check',
                        trustConfirmed: true,
                        percent: 100,
                        message: '기존 백업 파일을 확인했습니다. 백업 파일 기반으로 바로 분석을 시작합니다.'
                    });
                } else if (isBackupComplete || fs.existsSync(specificBackupPath)) {
                    // Status.plist가 있어도 중간 종료/불완전일 수 있으므로, 메타/Manifest 기준으로 확실히 분기
                    if (isBackupComplete && hasManifest && !meta) {
                        try {
                            const stat = getDirectoryStats(fs, path, specificBackupPath);
                            const finalBytes = stat.bytes || 0;
                            const finalFiles = stat.files || 0;

                            fs.writeFileSync(backupMetaPath, JSON.stringify({
                                complete: true,
                                totalBytes: finalBytes,
                                totalFiles: finalFiles,
                                reconstructedAt: Date.now()
                            }, null, 2));

                            meta = {
                                complete: true,
                                totalBytes: finalBytes,
                                totalFiles: finalFiles
                            };

                            safeEmit(onProgress, {
                                step: 1,
                                totalSteps: 2,
                                stage: 'device-check',
                                trustConfirmed: true,
                                percent: 100,
                                message: '기존 백업 파일을 확인했습니다. 백업 파일 기반으로 바로 분석을 시작합니다.'
                            });
                        } catch (_e) {
                            isBackupComplete = false;
                        }
                    } else {
                        // 불완전 캐시로 판단 -> 새 백업을 위해 제거
                        isBackupComplete = false;
                        try {
                            if (fs.existsSync(specificBackupPath)) {
                                await removeDirectorySafe(fs, specificBackupPath);
                            }
                        } catch (_e) { }
                    }
                }

                if (!isBackupComplete) {
                    console.log('[iOS] 신규 검사를 위해 백업을 시작합니다...');

                    safeEmit(onProgress, {
                        step: 1,
                        totalSteps: 2,
                        stage: 'device-check',
                        trustConfirmed: false,
                        percent: 0,
                        message: IOS_TRUST_PROMPT_MESSAGE
                    });

                    try {
                        await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => { });
                        await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => { });
                    } catch (_e) { }

                    if (fs.existsSync(specificBackupPath)) {
                        await removeDirectorySafe(fs, specificBackupPath);
                    }
                    if (!fs.existsSync(TEMP_BACKUP)) fs.mkdirSync(TEMP_BACKUP, { recursive: true });

                    // ✅ iOS 백업 진행률 정책
                    // - 백업 단계는 실제 데이터 수집 상태 그대로 보여준다.
                    // - 빠른 기기 보정은 정밀 분석 단계에서만 수행한다.
                    // - 완료 직전에는 99%까지만 표시하고, 실제 완료 시 100% 전환
                    let lastPctF = 0;
                    let lastPct = 0;
                    let lastCount = null;

                    let trustedPercentTarget = null;
                    let trustedCount = null;
                    let countSeriesTotal = null;
                    let countSeriesHits = 0;
                    let countSeriesLastCur = -1;

                    try {
                        fs.writeFileSync(backupMetaPath, JSON.stringify({
                            complete: false,
                            startedAt: Date.now()
                        }, null, 2));
                    } catch (_e) { }

                    let ticker = null;
                    let tickerBusy = false;

                    const getUsedBytes = async () => {
                        const info = CONFIG.PATHS.IOS_INFO;
                        const keyTry = async (key) => {
                            try {
                                const out = await Utils.runCommand(`"${info}" -u ${udid} -k ${key}`);
                                const v = String(out || '').trim();
                                const n = parseInt(v, 10);
                                return Number.isFinite(n) ? n : 0;
                            } catch (_e) {
                                return 0;
                            }
                        };

                        const cap = await keyTry('TotalDiskCapacity') || await keyTry('TotalDataCapacity');
                        const avail = await keyTry('TotalDiskAvailable') || await keyTry('TotalDataAvailable');

                        if (cap > 0 && avail >= 0 && cap >= avail) {
                            return cap - avail;
                        }
                        return 0;
                    };

                    const buildBackupMessage = (bytes, files) => {
                        return `아이폰 백업 진행 중... (파일 ${files.toLocaleString('en-US')}개 / ${formatBytes(bytes)})`;
                    };

                    const MIN_MEANINGFUL_BACKUP_BYTES = 24 * 1024 * 1024;
                    const MIN_MEANINGFUL_BACKUP_FILES = 25;
                    const MIN_MEANINGFUL_BACKUP_COUNT = 25;
                    const hasMeaningfulBackupStarted = (bytes = 0, files = 0) => {
                        const safeBytes = Number(bytes) || 0;
                        const safeFiles = Number(files) || 0;
                        const safeCurrent = Number(trustedCount?.cur) || 0;
                        const safeTotal = Number(trustedCount?.total) || 0;

                        return !!(
                            (safeCurrent >= MIN_MEANINGFUL_BACKUP_COUNT && safeTotal > 0)
                            || safeBytes >= MIN_MEANINGFUL_BACKUP_BYTES
                            || safeFiles >= MIN_MEANINGFUL_BACKUP_FILES
                        );
                    };

                    const emitBackupProgress = (percent, bytes, files, message) => {
                        const stage = hasMeaningfulBackupStarted(bytes, files) ? 'backup' : 'device-check';
                        safeEmit(onProgress, {
                            step: 1,
                            totalSteps: 2,
                            stage,
                            trustConfirmed: true,
                            percent,
                            bytes,
                            files,
                            current: trustedCount?.cur,
                            total: trustedCount?.total,
                            message: message || (
                                stage === 'backup'
                                    ? buildBackupMessage(bytes, files)
                                    : IOS_TRUST_PROMPT_MESSAGE
                            )
                        });
                    };

                    const moveToward = (current, target) => {
                        const c = Number(current) || 0;
                        const t = Number(target) || 0;
                        if (t <= c) return c;

                        const gap = t - c;
                        let step =
                            gap >= 20 ? 4.2 :
                            gap >= 12 ? 2.8 :
                            gap >= 6 ? 1.8 : 1.0;

                        if (t >= 90) step = Math.min(step, 1.2);
                        if (t >= 96) step = Math.min(step, 0.8);

                        return Math.min(t, c + step);
                    };

                    scanStartAt = Date.now();
                    const usedBytes = await getUsedBytes().catch(() => 0);
                    const FAST_DEVICE_THRESHOLD_SEC = 20 * 60;
                    const RANDOM_DURATION_MIN_SEC = 20 * 60;
                    const RANDOM_DURATION_MAX_SEC = 30 * 60;
                    const STRATEGY_OBSERVATION_SEC = 75;

                    const GB = 1024 * 1024 * 1024;
                    const MB = 1024 * 1024;

                    const anchorTotalBytes = usedBytes > 0
                        ? Math.max(usedBytes * 1.22, 8 * GB)
                        : 12 * GB;

                    let adaptiveTotalBytes = anchorTotalBytes;

                    let maxBytesSeen = 0;
                    let maxFilesSeen = 0;
                    let lastObservedBytes = 0;
                    let lastObservedFiles = 0;
                    let lastObservedAt = Date.now();
                    let lastMeaningfulGrowthAt = Date.now();
                    let bytesPerSecEma = 0;
                    let progressStrategy = 'real';
                    let strategyLocked = true;
                    let displayTargetSec = 0;
                    let fastPredictionHits = 0;
                    let slowPredictionHits = 0;

                    const statsCache = {
                        bytes: 0,
                        files: 0,
                        scannedAt: 0,
                        running: false
                    };

                    const refreshBackupStats = async (force = false) => {
                        const now = Date.now();

                        if (!force && (now - statsCache.scannedAt) < 1800) {
                            return { bytes: statsCache.bytes, files: statsCache.files };
                        }

                        if (statsCache.running) {
                            return { bytes: statsCache.bytes, files: statsCache.files };
                        }

                        if (!fs.existsSync(specificBackupPath)) {
                            return { bytes: statsCache.bytes, files: statsCache.files };
                        }

                        statsCache.running = true;
                        try {
                            const stat = await new Promise((resolve) => {
                                setImmediate(() => {
                                    try {
                                        resolve(getDirectoryStats(fs, path, specificBackupPath));
                                    } catch (_e) {
                                        resolve({ bytes: statsCache.bytes, files: statsCache.files });
                                    }
                                });
                            });

                            statsCache.bytes = Math.max(statsCache.bytes, stat.bytes || 0);
                            statsCache.files = Math.max(statsCache.files, stat.files || 0);
                            statsCache.scannedAt = Date.now();
                        } finally {
                            statsCache.running = false;
                        }

                        return { bytes: statsCache.bytes, files: statsCache.files };
                    };

                    const computeRealTargetPct = ({
                        elapsedSec,
                        estimatedTotalSec,
                        estimatedRemainingSec,
                        rawRatio,
                        trustedRatio,
                        countPct,
                        stalledSec,
                        displayBytes,
                        displayFiles
                    }) => {
                        let pctByTime = estimatedTotalSec > 0
                            ? Math.pow(elapsedSec / estimatedTotalSec, 1.34) * 99
                            : 0;

                        // Early progress should feel slower than the current implementation.
                        if (elapsedSec < 60) {
                            pctByTime = Math.min(pctByTime, 7);
                        } else if (elapsedSec < 120) {
                            pctByTime = Math.min(pctByTime, 15);
                        } else if (elapsedSec < 240) {
                            pctByTime = Math.min(pctByTime, 30);
                        } else if (elapsedSec < 360) {
                            pctByTime = Math.min(pctByTime, 45);
                        } else if (elapsedSec < 480) {
                            pctByTime = Math.min(pctByTime, 58);
                        }

                        const pctByBytes = Math.min(99, Math.pow(rawRatio, 1.18) * 100);
                        const byteLeadAllowance =
                            rawRatio < 0.40 ? 1.2 :
                            rawRatio < 0.70 ? 2.0 : 3.5;

                        let targetPct = Math.max(
                            pctByTime,
                            Math.min(pctByBytes, pctByTime + byteLeadAllowance)
                        );

                        if (countPct !== null) {
                            targetPct = Math.max(
                                targetPct,
                                Math.min(countPct, pctByTime + 4.5)
                            );
                        }

                        if (estimatedRemainingSec <= 300 && (rawRatio >= 0.82 || trustedRatio >= 0.90)) {
                            targetPct = Math.max(targetPct, 92);
                        }
                        if (estimatedRemainingSec <= 180 && (rawRatio >= 0.88 || trustedRatio >= 0.95)) {
                            targetPct = Math.max(targetPct, 95);
                        }
                        if (estimatedRemainingSec <= 90 && (rawRatio >= 0.93 || trustedRatio >= 0.98 || stalledSec >= 8)) {
                            targetPct = Math.max(targetPct, 97.8);
                        }
                        if (estimatedRemainingSec <= 35 && (rawRatio >= 0.965 || trustedRatio >= 0.992 || stalledSec >= 12)) {
                            targetPct = Math.max(targetPct, 99);
                        }

                        if (displayBytes > 0 || displayFiles > 0) {
                            targetPct = Math.max(targetPct, 1);
                        }

                        return Math.min(99, targetPct);
                    };

                    const computeTheaterTargetPct = (elapsedSec, targetSec) => {
                        if (!(targetSec > 0)) return 0;

                        const ratio = Math.max(0, Math.min(1, elapsedSec / targetSec));
                        let pct = Math.pow(ratio, 1.14) * 99;

                        if (elapsedSec < 60) {
                            pct = Math.min(pct, 4);
                        } else if (elapsedSec < 120) {
                            pct = Math.min(pct, 10);
                        } else if (elapsedSec < 240) {
                            pct = Math.min(pct, 21);
                        } else if (elapsedSec < 360) {
                            pct = Math.min(pct, 33);
                        }

                        return Math.min(99, pct);
                    };

                    const startTicker = () => {
                        ticker = setInterval(async () => {
                            if (tickerBusy) return;
                            tickerBusy = true;

                            try {
                                const elapsedSec = Math.max(1, (Date.now() - scanStartAt) / 1000);

                                if (!fs.existsSync(specificBackupPath)) {
                                    const prepPct = Math.min(2, Math.floor(elapsedSec / 6));
                                    lastPctF = moveToward(lastPctF, prepPct);
                                    lastPct = Math.floor(lastPctF);

                                    safeEmit(onProgress, {
                                        step: 1,
                                        totalSteps: 2,
                                        stage: 'device-check',
                                        trustConfirmed: false,
                                        percent: lastPct,
                                        message: IOS_TRUST_PROMPT_MESSAGE
                                    });
                                    return;
                                }

                                const stat = await refreshBackupStats(false);

                                if (Number.isFinite(stat.bytes)) {
                                    maxBytesSeen = Math.max(maxBytesSeen, stat.bytes);
                                }
                                if (Number.isFinite(stat.files)) {
                                    maxFilesSeen = Math.max(maxFilesSeen, stat.files);
                                }

                                const displayBytes = Math.max(maxBytesSeen, stat.bytes || 0);
                                const displayFiles = Math.max(maxFilesSeen, stat.files || 0);

                                const now = Date.now();
                                const dt = Math.max(0.5, (now - lastObservedAt) / 1000);
                                const deltaBytes = Math.max(0, displayBytes - lastObservedBytes);

                                if (deltaBytes >= 8 * MB) {
                                    lastMeaningfulGrowthAt = now;
                                }

                                const instantRate = deltaBytes / dt;
                                bytesPerSecEma = bytesPerSecEma <= 0
                                    ? instantRate
                                    : (bytesPerSecEma * 0.72) + (instantRate * 0.28);

                                lastObservedBytes = displayBytes;
                                lastObservedFiles = displayFiles;
                                lastObservedAt = now;

                                const tailBuffer =
                                    displayBytes < 4 * GB ? 8 * GB :
                                    displayBytes < 8 * GB ? 6 * GB :
                                    displayBytes < 14 * GB ? 4 * GB :
                                    displayBytes < 20 * GB ? 2 * GB :
                                    1 * GB;

                                const rateBuffer = bytesPerSecEma > 0
                                    ? Math.max(768 * MB, Math.min(2 * GB, bytesPerSecEma * 150))
                                    : (1280 * MB);

                                const observedNeed = displayBytes + Math.max(tailBuffer, rateBuffer);

                                adaptiveTotalBytes = Math.max(
                                    displayBytes + 512 * MB,
                                    observedNeed,
                                    adaptiveTotalBytes
                                );

                                if (usedBytes > 0) {
                                    adaptiveTotalBytes = Math.max(adaptiveTotalBytes, Math.max(usedBytes * 1.12, 8 * GB));
                                }

                                const effectiveTotal = adaptiveTotalBytes;
                                const rawRatio = effectiveTotal > 0
                                    ? Math.max(0, Math.min(1, displayBytes / effectiveTotal))
                                    : 0;

                                const avgBytesPerSec = elapsedSec > 0
                                    ? (displayBytes / elapsedSec)
                                    : 0;
                                const blendedRate = Math.max(
                                    1 * MB,
                                    bytesPerSecEma > 0
                                        ? (bytesPerSecEma * 0.68) + (avgBytesPerSec * 0.32)
                                        : avgBytesPerSec
                                );
                                const remainingBytes = Math.max(0, effectiveTotal - displayBytes);
                                const remainingPenalty =
                                    rawRatio < 0.35 ? 1.55 :
                                    rawRatio < 0.60 ? 1.42 :
                                    rawRatio < 0.80 ? 1.30 :
                                    rawRatio < 0.90 ? 1.22 :
                                    1.15;
                                const estimatedRemainingSec = (remainingBytes / blendedRate) * remainingPenalty;
                                const estimatedTotalSec = Math.max(elapsedSec, elapsedSec + estimatedRemainingSec);
                                const trustedRatio = trustedCount && trustedCount.total > 0
                                    ? Math.max(0, Math.min(1, trustedCount.cur / trustedCount.total))
                                    : 0;
                                const stalledSec = Math.max(0, (now - lastMeaningfulGrowthAt) / 1000);
                                const countPct = trustedPercentTarget !== null ? Math.min(99, trustedPercentTarget) : null;
                                const realTargetPct = computeRealTargetPct({
                                    elapsedSec,
                                    estimatedTotalSec,
                                    estimatedRemainingSec,
                                    rawRatio,
                                    trustedRatio,
                                    countPct,
                                    stalledSec,
                                    displayBytes,
                                    displayFiles
                                });

                                if (!strategyLocked) {
                                    const hasEnoughSignal =
                                        elapsedSec >= STRATEGY_OBSERVATION_SEC
                                        && (
                                            displayBytes >= 192 * MB
                                            || rawRatio >= 0.05
                                            || (trustedCount && trustedCount.cur >= 150)
                                        );

                                    if (hasEnoughSignal) {
                                        if (estimatedTotalSec <= FAST_DEVICE_THRESHOLD_SEC) {
                                            fastPredictionHits += 1;
                                        } else {
                                            slowPredictionHits += 1;
                                        }

                                        if (fastPredictionHits >= 2 || slowPredictionHits >= 2 || elapsedSec >= 120) {
                                            if (estimatedTotalSec <= FAST_DEVICE_THRESHOLD_SEC) {
                                                progressStrategy = 'theater';
                                                displayTargetSec = randomIntInclusive(RANDOM_DURATION_MIN_SEC, RANDOM_DURATION_MAX_SEC);
                                                console.log(`[iOS] 빠른 기기 감지 -> 랜덤 백업 표시 시간 ${Math.round(displayTargetSec / 60)}분 적용`);
                                            } else {
                                                progressStrategy = 'real';
                                                console.log(`[iOS] 긴 기기 감지 -> 실제 백업 진행률 유지 (${Math.round(estimatedTotalSec / 60)}분 예상)`);
                                            }
                                            strategyLocked = true;
                                        }
                                    }
                                }

                                if (
                                    progressStrategy === 'theater'
                                    && displayTargetSec > 0
                                    && elapsedSec >= 180
                                    && estimatedTotalSec > (displayTargetSec * 1.15)
                                ) {
                                    progressStrategy = 'real';
                                    displayTargetSec = 0;
                                    console.log('[iOS] 실제 백업 시간이 길어 보여 랜덤 연출을 해제하고 실제 진행률로 전환합니다.');
                                }

                                let targetPct = realTargetPct;
                                if (progressStrategy === 'theater' && displayTargetSec > 0) {
                                    const theaterTargetPct = computeTheaterTargetPct(elapsedSec, displayTargetSec);
                                    const maxLeadOverReal = elapsedSec < 600 ? 5.5 : 7.5;
                                    targetPct = Math.min(
                                        99,
                                        Math.min(theaterTargetPct, realTargetPct + maxLeadOverReal)
                                    );
                                    if (displayBytes > 0 || displayFiles > 0) {
                                        targetPct = Math.max(targetPct, 1);
                                    }
                                }

                                lastPctF = moveToward(lastPctF, targetPct);
                                lastPct = Math.floor(lastPctF);

                                const backupMessage = hasMeaningfulBackupStarted(displayBytes, displayFiles)
                                    ? undefined
                                    : IOS_TRUST_PROMPT_MESSAGE;
                                emitBackupProgress(lastPct, displayBytes, displayFiles, backupMessage);
                            } catch (_e) {
                            } finally {
                                tickerBusy = false;
                            }
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
                        const watchIntervalMs = 1500;
                        let watchBusy = false;

                        watch = setInterval(async () => {
                            if (disconnected || watchBusy) return;
                            watchBusy = true;

                            try {
                                const out = await Utils.runCommand(`"${CONFIG.PATHS.IOS_ID}" -l`);
                                const udids = String(out || '').trim();

                                if (!udids) {
                                    disconnected = true;
                                    safeEmit(onProgress, {
                                        step: 1,
                                        totalSteps: 2,
                                        stage: 'backup',
                                        trustConfirmed: true,
                                        percent: Math.max(0, Math.min(99, lastPct)),
                                        message: '⚠️ iOS 기기 연결이 끊겼습니다. 케이블 연결/신뢰 상태를 확인해주세요.'
                                    });

                                    try { await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => { }); } catch (_e) { }
                                    try { await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => { }); } catch (_e) { }
                                }
                            } catch (_e) {

                            } finally {
                                watchBusy = false;
                            }
                        }, watchIntervalMs);

                        const backupRun = await spawnWithLineStream(
                            IOS_BACKUP,
                            ['backup', '--full', TEMP_BACKUP, '-u', udid],
                            {
                                onLine: (line) => {
                                    const parsed = parseBackupProgressLine(line);
                                    if (!parsed) return;
                                    if (parsed.total < 100) return;

                                    if (lastCount && lastCount.cur === parsed.cur && lastCount.total === parsed.total) {
                                        return;
                                    }

                                    lastCount = parsed;

                                    if (countSeriesTotal === parsed.total && parsed.cur > countSeriesLastCur) {
                                        countSeriesHits += 1;
                                    } else {
                                        countSeriesTotal = parsed.total;
                                        countSeriesHits = 1;
                                    }

                                    countSeriesLastCur = parsed.cur;

                                    if (countSeriesHits < 4) {
                                        return;
                                    }

                                    trustedCount = {
                                        cur: parsed.cur,
                                        total: parsed.total
                                    };

                                    const pctRaw = (parsed.cur / parsed.total) * 100;
                                    const pct = Math.min(99, clampPercent(pctRaw));

                                    trustedPercentTarget = trustedPercentTarget === null
                                        ? pct
                                        : Math.max(trustedPercentTarget, pct);
                                }
                            }
                        );
                        const finalStat = await refreshBackupStats(true);
                        const finalBytes = Math.max(maxBytesSeen, finalStat.bytes || 0);
                        const finalFiles = Math.max(maxFilesSeen, finalStat.files || 0);

                        if (progressStrategy === 'theater' && displayTargetSec > 0) {
                            while (((Date.now() - scanStartAt) / 1000) < displayTargetSec) {
                                const elapsedSec = Math.max(1, (Date.now() - scanStartAt) / 1000);
                                const theaterTargetPct = computeTheaterTargetPct(elapsedSec, displayTargetSec);
                                lastPctF = moveToward(lastPctF, Math.max(lastPctF, theaterTargetPct));
                                lastPct = Math.floor(lastPctF);
                                emitBackupProgress(lastPct, finalBytes, finalFiles);
                                await Utils.sleep(250);
                            }
                        }

                        const settleTarget = 99;

                        while (lastPct < settleTarget) {
                            const gap = settleTarget - lastPctF;
                            const step =
                                gap >= 6 ? 0.85 :
                                gap >= 3 ? 0.55 : 0.35;

                            lastPctF = Math.min(settleTarget, lastPctF + step);
                            lastPct = Math.floor(lastPctF);

                            emitBackupProgress(lastPct, finalBytes, finalFiles);

                            await Utils.sleep(120);
                        }

                        if (backupRun && Number.isFinite(backupRun.code) && backupRun.code !== 0) {
                            console.warn(`[iOS] idevicebackup2 종료 코드 경고: ${backupRun.code}`);
                        }

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
                    trustConfirmed: true,
                    percent: 100,
                    message: '아이폰 백업 완료 ✅'
                });


                // UI가 100%를 잠깐이라도 보여줄 수 있게 짧게 대기
                try { await Utils.sleep(600); } catch (_e) { }
                console.log('[iOS] 🚀 데이터 확보 확인! 즉시 정밀 분석 단계로 전환합니다.');
                backupElapsedSec = scanStartAt
                    ? Math.max(1, Math.floor((Date.now() - scanStartAt) / 1000))
                    : null;

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
                    trustConfirmed: true,
                    percent: 0,
                    message: backupElapsedSec === null
                        ? '기존 백업 파일을 기반으로 정밀 분석을 시작합니다.'
                        : 'MVT 정밀 분석 시작...'
                });

                // MVT 진행률: 산출물 폴더 파일/바이트 증가 기반 (튀지 않게)
                let mvtTicker = null;
                let mvtLastPct = 0;
                let mvtEstFiles = 0;
                let mvtEstBytes = 0;

                                let mvtTickerBusy = false;
                const mvtStatsCache = {
                    bytes: 0,
                    files: 0,
                    scannedAt: 0,
                    running: false
                };

                const refreshMvtStats = async (force = false) => {
                    const now = Date.now();

                    if (!force && (now - mvtStatsCache.scannedAt) < 2500) {
                        return { bytes: mvtStatsCache.bytes, files: mvtStatsCache.files };
                    }

                    if (mvtStatsCache.running) {
                        return { bytes: mvtStatsCache.bytes, files: mvtStatsCache.files };
                    }

                    mvtStatsCache.running = true;
                    try {
                        const stat = await new Promise((resolve) => {
                            setImmediate(() => {
                                try {
                                    resolve(getDirectoryStats(fs, path, MVT_RESULT));
                                } catch (_e) {
                                    resolve({ bytes: mvtStatsCache.bytes, files: mvtStatsCache.files });
                                }
                            });
                        });

                        mvtStatsCache.bytes = Math.max(mvtStatsCache.bytes, stat.bytes || 0);
                        mvtStatsCache.files = Math.max(mvtStatsCache.files, stat.files || 0);
                        mvtStatsCache.scannedAt = Date.now();
                    } finally {
                        mvtStatsCache.running = false;
                    }

                    return { bytes: mvtStatsCache.bytes, files: mvtStatsCache.files };
                };

                const startMvtTicker = () => {
                    mvtTicker = setInterval(async () => {
                        if (mvtTickerBusy) return;
                        mvtTickerBusy = true;

                        try {
                            const stat = await refreshMvtStats(false);

                            const BASE_FILES = 50;
                            const BASE_BYTES = 50 * 1024 * 1024;

                            mvtEstFiles = estimateTotalFromGrowth(stat.files, mvtEstFiles, { base: BASE_FILES, ratio: 1.3 });
                            mvtEstBytes = estimateTotalFromGrowth(stat.bytes, mvtEstBytes, { base: BASE_BYTES, ratio: 1.3 });

                            const pctByFiles = mvtEstFiles > 0 ? (stat.files / mvtEstFiles) * 97 : 0;
                            const pctByBytes = mvtEstBytes > 0 ? (stat.bytes / mvtEstBytes) * 97 : 0;

                            const pct = Math.min(97, clampPercent(Math.max(pctByFiles, pctByBytes)));

                            if (pct > mvtLastPct) {
                                mvtLastPct = pct;
                            }

                            safeEmit(onProgress, {
                                step: 2,
                                totalSteps: 2,
                                stage: 'mvt',
                                trustConfirmed: true,
                                percent: mvtLastPct,
                                message: 'MVT 정밀 분석 진행 중...'
                            });
                        } catch (_e) {
                        } finally {
                            mvtTickerBusy = false;
                        }
                    }, 1000);
                };

                const stopMvtTicker = () => {
                    if (mvtTicker) clearInterval(mvtTicker);
                    mvtTicker = null;
                };

                const maybeExtendMvtStage = async () => {
                    if (progressPolicy !== 'random_20_30') {
                        return;
                    }

                    if (!(backupElapsedSec > 0)) {
                        return;
                    }

                    if (backupElapsedSec > (20 * 60)) {
                        return;
                    }

                    const targetTotalSec = randomIntInclusive(20 * 60, 30 * 60);
                    const actualMvtElapsedSec = Math.max(1, Math.floor((Date.now() - mvtStageStartedAt) / 1000));
                    const elapsedBeforeHoldSec = backupElapsedSec + actualMvtElapsedSec;
                    const remainingHoldSec = Math.max(0, targetTotalSec - elapsedBeforeHoldSec);

                    if (remainingHoldSec <= 0) {
                        return;
                    }

                    console.log(`[iOS] 빠른 기기 보정 적용 -> 정밀 분석 단계 ${Math.round(remainingHoldSec / 60)}분 유지 (목표 ${Math.round(targetTotalSec / 60)}분)`);

                    const analysisMessages = [
                        '수집된 데이터를 정밀 분석하는 중...',
                        '위협 흔적과 이상 징후를 교차 분석하는 중...',
                        '시스템 로그와 앱 흔적을 정리하는 중...',
                        '분석 결과를 검증하는 중...'
                    ];

                    const holdStartAt = Date.now();
                    let lastEmittedPct = Math.max(12, mvtLastPct || 0);

                    while (((Date.now() - holdStartAt) / 1000) < remainingHoldSec) {
                        const holdElapsedSec = Math.max(0, (Date.now() - holdStartAt) / 1000);
                        const holdRatio = remainingHoldSec > 0 ? Math.max(0, Math.min(1, holdElapsedSec / remainingHoldSec)) : 1;
                        const targetPct = Math.min(97, 14 + Math.floor(holdRatio * 78));

                        if (targetPct > lastEmittedPct) {
                            lastEmittedPct = targetPct;
                        }

                        const msgIndex = Math.min(
                            analysisMessages.length - 1,
                            Math.floor((holdElapsedSec / Math.max(12, remainingHoldSec / analysisMessages.length)))
                        );

                        safeEmit(onProgress, {
                            step: 2,
                            totalSteps: 2,
                            stage: 'mvt',
                            trustConfirmed: true,
                            percent: lastEmittedPct,
                            message: analysisMessages[msgIndex]
                        });

                        await Utils.sleep(1000);
                    }
                };

                const mvtCmd = `mvt-ios check-backup --output "${MVT_RESULT}" "${specificBackupPath}"`;
                const mvtStageStartedAt = Date.now();
                try {
                    startMvtTicker();
                    await Utils.runCommand(mvtCmd).catch(() => console.warn('MVT 실행 중 경고 무시'));
                } finally {
                    stopMvtTicker();
                }

                await maybeExtendMvtStage();

                safeEmit(onProgress, {
                    step: 2,
                    totalSteps: 2,
                    stage: 'mvt',
                    trustConfirmed: true,
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
                return { success: true, skipped: true, deleted: false };
            }

            try {
                const specificPath = path.join(CONFIG.PATHS.TEMP_BACKUP, udid);
                const exists = fs.existsSync(specificPath);

                if (!exists) {
                    return { success: true, deleted: false, message: '삭제할 백업 폴더가 없습니다.' };
                }

                await removeDirectorySafe(fs, specificPath);
                console.log('[Security] 배포 모드: 백업 데이터 파기 성공.');

                return {
                    success: true,
                    deleted: true,
                    message: '검사에 사용된 iOS 임시 백업 데이터가 삭제되었습니다.'
                };
            } catch (err) {
                console.error('[Security] 삭제 오류:', err.message);
                return { success: false, deleted: false, error: err.message };
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

                    const pickFirst = (obj, keys) => {
                        for (const key of keys) {
                            const value = obj?.[key];
                            if (value === null || value === undefined) continue;
                            const text = String(value).trim();
                            if (text) return text;
                        }
                        return '';
                    };

                    // 3. 표준 형식으로 변환
                    rawApps.forEach(appData => {
                        const bundleId = pickFirst(appData, [
                            'softwareVersionBundleId',
                            'bundleIdentifier',
                            'bundleId',
                            'CFBundleIdentifier',
                            'identifier',
                            'id',
                            'name'
                        ]);
                        const itemName = pickFirst(appData, [
                            'itemName',
                            'title',
                            'displayName',
                            'localizedName',
                            'bundleDisplayName',
                            'appName',
                            'name'
                        ]);

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

            const classifyFindingArea = (item) => {
                const text = [
                    item?.source_file,
                    item?.module,
                    item?.check_name,
                    item?.description,
                    item?.path,
                    item?.file_path
                ].filter(Boolean).join(' ').toLowerCase();

                if (/(safari|webkit|browser|history|url|domain|web)/.test(text)) return 'web';
                if (/(sms|imessage|message|chat|call|whatsapp|telegram|signal)/.test(text)) return 'messages';
                if (/(profile|certificate|manifest|app|bundle|mobileinstallation|container)/.test(text)) return 'apps';
                if (/(artifact|ioc|cache|localstorage|shutdown|plist|sqlite)/.test(text)) return 'artifacts';
                return 'system';
            };

            const toWarningText = (item) => {
                return String(
                    item?.description
                    || item?.name
                    || item?.check_name
                    || item?.module
                    || item?.path
                    || item?.file_path
                    || '의심 항목'
                ).trim();
            };

            const warningBuckets = {
                web: [],
                messages: [],
                system: [],
                apps: [],
                artifacts: []
            };

            findings.forEach((item) => {
                const area = classifyFindingArea(item);
                const warningText = toWarningText(item);
                if (warningText) warningBuckets[area].push(warningText);
            });

            const mvtResults = {
                web: { status: warningBuckets.web.length ? 'warning' : 'safe', warnings: warningBuckets.web, files: ['Safari History', 'Chrome Bookmarks'] },
                messages: { status: warningBuckets.messages.length ? 'warning' : 'safe', warnings: warningBuckets.messages, files: ['SMS/iMessage DB', 'Call History'] },
                system: { status: warningBuckets.system.length ? 'warning' : 'safe', warnings: warningBuckets.system, files: ['Configuration Files', 'Log Files'] },
                apps: { status: warningBuckets.apps.length ? 'warning' : 'safe', warnings: warningBuckets.apps, files: ['Manifest.db', 'App Sandboxes'] },
                artifacts: { status: warningBuckets.artifacts.length ? 'warning' : 'safe', warnings: warningBuckets.artifacts, files: ['Detected IOCs', 'Caches', 'LocalStorage'] },
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
