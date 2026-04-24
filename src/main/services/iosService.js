const iosBackupRuntimeUtilsModule = require('./iosBackupRuntimeUtils.js');
const iosPairingModule = require('./iosPairing.js');
const iosBackupCacheModule = require('./iosBackupCache.js');
const iosBackupProgressModule = require('./iosBackupProgress.js');
const iosMvtParserModule = require('./iosMvtParser.js');
const iosMvtExecutionModule = require('./iosMvtExecution.js');

const iosBackupRuntimeUtils = iosBackupRuntimeUtilsModule.default || iosBackupRuntimeUtilsModule;
const { createIosPairingHelpers } = iosPairingModule.default || iosPairingModule;
const { createIosBackupCacheHelpers } = iosBackupCacheModule.default || iosBackupCacheModule;
const { createIosBackupProgressHelpers } = iosBackupProgressModule.default || iosBackupProgressModule;
const { createIosMvtParser } = iosMvtParserModule.default || iosMvtParserModule;
const { createIosMvtExecutionHelpers } = iosMvtExecutionModule.default || iosMvtExecutionModule;
const { safeEmit, formatBytes, getDirectoryStats, removeDirectorySafe, estimateTotalFromGrowth, parseBackupProgressLine, clampPercent, randomIntInclusive, normalizeIosProgressPolicy, spawnWithLineStream } = iosBackupRuntimeUtils;
const IOS_TRUST_PROMPT_MESSAGE = "검사를 위해 iPhone에서 PIN 입력 후 '이 컴퓨터 신뢰'를 승인해주세요.";
function isBoolTrue(v) {
    if (v === true)
        return true;
    if (v === false)
        return false;
    if (v === 1)
        return true;
    if (v === 0)
        return false;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return (s === 'true' || s === '1' || s === 'yes' || s === 'y');
    }
    return false;
}
const noop = () => { };
function createIosService({ fs, path, os, log, CONFIG, Utils }) {
    if (!fs)
        throw new Error('createIosService requires fs');
    const iosPairing = createIosPairingHelpers({ fs, CONFIG, Utils });
    const iosBackupCache = createIosBackupCacheHelpers({
        fs,
        path,
        getDirectoryStats,
        removeDirectorySafe,
        safeEmit,
        trustPromptMessage: IOS_TRUST_PROMPT_MESSAGE
    });
    const iosBackupProgress = createIosBackupProgressHelpers({
        fs,
        path,
        Utils,
        formatBytes,
        getDirectoryStats,
        safeEmit,
        trustPromptMessage: IOS_TRUST_PROMPT_MESSAGE
    });
    const iosMvtParser = createIosMvtParser({
        fs,
        path,
        Utils
    });
    const iosMvtExecution = createIosMvtExecutionHelpers({
        fs,
        path,
        Utils,
        getDirectoryStats,
        estimateTotalFromGrowth,
        clampPercent,
        randomIntInclusive,
        safeEmit
    });
    const service = {
        async checkConnection() {
            console.log(`[iOS] 연결 확인 시작: ${CONFIG.PATHS.IOS_ID}`);
            try {
                const cmdId = `"${CONFIG.PATHS.IOS_ID}" -l`;
                const udidOutput = await Utils.runCommand(cmdId);
                const udid = (udidOutput || '').trim();
                if (!udid)
                    return { status: 'disconnected' };
                const pairing = await iosPairing.validatePairing(udid);
                if (!pairing.ok) {
                    return { status: 'unauthorized', error: pairing.message || 'PAIRING_FAILED' };
                }
                const cmdInfo = `"${CONFIG.PATHS.IOS_INFO}" -u ${udid} -k DeviceName`;
                const nameOutput = await Utils.runCommand(cmdInfo);
                const modelName = nameOutput ? nameOutput.trim() : 'iPhone Device';
                return { status: 'connected', model: modelName, udid, type: 'ios' };
            }
            catch (error) {
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
                const pairing = await iosPairing.validatePairing(udid);
                if (!pairing.ok) {
                    throw new Error(pairing.message);
                }
                const { isBackupComplete: reusableBackupExists } = await iosBackupCache.resolveReusableBackup({
                    specificBackupPath,
                    backupMetaPath,
                    onProgress
                });
                let isBackupComplete = reusableBackupExists;
                if (!isBackupComplete) {
                    console.log('[iOS] 신규 검사를 위해 백업을 시작합니다...');
                    iosBackupCache.emitTrustPrompt(onProgress);
                    try {
                        await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => undefined);
                        await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => undefined);
                    }
                    catch (_e) { /* noop */ }
                    if (fs.existsSync(specificBackupPath)) {
                        await removeDirectorySafe(fs, specificBackupPath);
                    }
                    if (!fs.existsSync(TEMP_BACKUP))
                        fs.mkdirSync(TEMP_BACKUP, { recursive: true });
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
                    }
                    catch (_e) { /* noop */ }
                    let ticker = null;
                    let tickerBusy = false;
                    const emitBackupProgress = (percent, bytes, files, message) => iosBackupProgress.emitBackupProgress({
                        onProgress,
                        percent,
                        bytes,
                        files,
                        trustedCount,
                        message
                    });
                    const moveToward = iosBackupProgress.moveToward;
                    scanStartAt = Date.now();
                    const usedBytes = await iosBackupProgress.getUsedBytes(CONFIG.PATHS.IOS_INFO, udid).catch(() => 0);
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
                    let lastObservedAt = Date.now();
                    let lastMeaningfulGrowthAt = Date.now();
                    let bytesPerSecEma = 0;
                    let progressStrategy = 'real';
                    let strategyLocked = true;
                    let displayTargetSec = 0;
                    let fastPredictionHits = 0;
                    let slowPredictionHits = 0;
                    const refreshBackupStats = iosBackupProgress.createBackupStatsRefresher(specificBackupPath);
                    const computeRealTargetPct = iosBackupProgress.computeRealTargetPct;
                    const computeTheaterTargetPct = iosBackupProgress.computeTheaterTargetPct;
                    const startTicker = () => {
                        ticker = setInterval(async () => {
                            if (tickerBusy)
                                return;
                            tickerBusy = true;
                            try {
                                const elapsedSec = Math.max(1, ((Date.now() - scanStartAt) / 1000));
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
                                if (Number.isFinite(stat.bytes))
                                    maxBytesSeen = Math.max(maxBytesSeen, stat.bytes);
                                if (Number.isFinite(stat.files))
                                    maxFilesSeen = Math.max(maxFilesSeen, stat.files);
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
                                lastObservedAt = now;
                                const tailBuffer = displayBytes < 4 * GB ? 8 * GB :
                                    displayBytes < 8 * GB ? 6 * GB :
                                        displayBytes < 14 * GB ? 4 * GB :
                                            displayBytes < 20 * GB ? 2 * GB :
                                                1 * GB;
                                const rateBuffer = bytesPerSecEma > 0
                                    ? Math.max(768 * MB, Math.min(2 * GB, bytesPerSecEma * 150))
                                    : (1280 * MB);
                                const observedNeed = displayBytes + Math.max(tailBuffer, rateBuffer);
                                adaptiveTotalBytes = Math.max(displayBytes + 512 * MB, observedNeed, adaptiveTotalBytes);
                                if (usedBytes > 0) {
                                    adaptiveTotalBytes = Math.max(adaptiveTotalBytes, Math.max(usedBytes * 1.12, 8 * GB));
                                }
                                const effectiveTotal = adaptiveTotalBytes;
                                const rawRatio = effectiveTotal > 0
                                    ? Math.max(0, Math.min(1, displayBytes / effectiveTotal))
                                    : 0;
                                const avgBytesPerSec = elapsedSec > 0 ? (displayBytes / elapsedSec) : 0;
                                const blendedRate = Math.max(1 * MB, bytesPerSecEma > 0
                                    ? (bytesPerSecEma * 0.68) + (avgBytesPerSec * 0.32)
                                    : avgBytesPerSec);
                                const remainingBytes = Math.max(0, effectiveTotal - displayBytes);
                                const remainingPenalty = rawRatio < 0.35 ? 1.55 :
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
                                    const hasEnoughSignal = elapsedSec >= STRATEGY_OBSERVATION_SEC
                                        && (displayBytes >= 192 * MB
                                            || rawRatio >= 0.05
                                            || (trustedCount && trustedCount.cur >= 150));
                                    if (hasEnoughSignal) {
                                        if (estimatedTotalSec <= FAST_DEVICE_THRESHOLD_SEC)
                                            fastPredictionHits += 1;
                                        else
                                            slowPredictionHits += 1;
                                        if (fastPredictionHits >= 2 || slowPredictionHits >= 2 || elapsedSec >= 120) {
                                            if (estimatedTotalSec <= FAST_DEVICE_THRESHOLD_SEC) {
                                                progressStrategy = 'theater';
                                                displayTargetSec = randomIntInclusive(RANDOM_DURATION_MIN_SEC, RANDOM_DURATION_MAX_SEC);
                                            }
                                            else {
                                                progressStrategy = 'real';
                                            }
                                            strategyLocked = true;
                                        }
                                    }
                                }
                                if (progressStrategy === 'theater'
                                    && displayTargetSec > 0
                                    && elapsedSec >= 180
                                    && estimatedTotalSec > (displayTargetSec * 1.15)) {
                                    progressStrategy = 'real';
                                    displayTargetSec = 0;
                                }
                                let targetPct = realTargetPct;
                                if (progressStrategy === 'theater' && displayTargetSec > 0) {
                                    const theaterTargetPct = computeTheaterTargetPct(elapsedSec, displayTargetSec);
                                    const maxLeadOverReal = elapsedSec < 600 ? 5.5 : 7.5;
                                    targetPct = Math.min(99, Math.min(theaterTargetPct, realTargetPct + maxLeadOverReal));
                                    if (displayBytes > 0 || displayFiles > 0)
                                        targetPct = Math.max(targetPct, 1);
                                }
                                lastPctF = moveToward(lastPctF, targetPct);
                                lastPct = Math.floor(lastPctF);
                                const backupMessage = iosBackupProgress.hasMeaningfulBackupStarted(displayBytes, displayFiles, trustedCount)
                                    ? undefined
                                    : IOS_TRUST_PROMPT_MESSAGE;
                                emitBackupProgress(lastPct, displayBytes, displayFiles, backupMessage);
                            }
                            catch (_e) {
                                /* noop */
                            }
                            finally {
                                tickerBusy = false;
                            }
                        }, 1000);
                    };
                    const stopTicker = () => {
                        if (ticker)
                            clearInterval(ticker);
                        ticker = null;
                    };
                    let disconnected = false;
                    let watch = null;
                    try {
                        startTicker();
                        const watchIntervalMs = 1500;
                        let watchBusy = false;
                        watch = setInterval(async () => {
                            if (disconnected || watchBusy)
                                return;
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
                                    try {
                                        await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => undefined);
                                    }
                                    catch (_e) { /* noop */ }
                                    try {
                                        await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => undefined);
                                    }
                                    catch (_e) { /* noop */ }
                                }
                            }
                            catch (_e) {
                                /* noop */
                            }
                            finally {
                                watchBusy = false;
                            }
                        }, watchIntervalMs);
                        const backupRun = await spawnWithLineStream(IOS_BACKUP, ['backup', '--full', TEMP_BACKUP, '-u', udid], {
                            onLine: (line) => {
                                const parsed = parseBackupProgressLine(line);
                                if (!parsed)
                                    return;
                                if (parsed.total < 100)
                                    return;
                                if (lastCount && lastCount.cur === parsed.cur && lastCount.total === parsed.total)
                                    return;
                                lastCount = parsed;
                                if (countSeriesTotal === parsed.total && parsed.cur > countSeriesLastCur)
                                    countSeriesHits += 1;
                                else {
                                    countSeriesTotal = parsed.total;
                                    countSeriesHits = 1;
                                }
                                countSeriesLastCur = parsed.cur;
                                if (countSeriesHits < 4)
                                    return;
                                trustedCount = { cur: parsed.cur, total: parsed.total };
                                const pctRaw = (parsed.cur / parsed.total) * 100;
                                const pct = Math.min(99, clampPercent(pctRaw));
                                trustedPercentTarget = trustedPercentTarget === null ? pct : Math.max(trustedPercentTarget, pct);
                            }
                        });
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
                            const step = gap >= 6 ? 0.85 : gap >= 3 ? 0.55 : 0.35;
                            lastPctF = Math.min(settleTarget, lastPctF + step);
                            lastPct = Math.floor(lastPctF);
                            emitBackupProgress(lastPct, finalBytes, finalFiles);
                            await Utils.sleep(120);
                        }
                        if (backupRun && Number.isFinite(backupRun.code) && backupRun.code !== 0) {
                            console.warn(`[iOS] idevicebackup2 종료 코드 경고: ${backupRun.code}`);
                        }
                    }
                    catch (_backupErr) {
                        console.warn('[iOS] 백업 종료 과정에서 경고가 발생했으나, 데이터 무결성을 확인합니다...');
                    }
                    finally {
                        stopTicker();
                        if (watch)
                            clearInterval(watch);
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
                try {
                    const stat = getDirectoryStats(fs, path, specificBackupPath);
                    fs.writeFileSync(backupMetaPath, JSON.stringify({
                        complete: true,
                        totalBytes: stat.bytes,
                        totalFiles: stat.files,
                        completedAt: Date.now()
                    }, null, 2));
                }
                catch (_e) { /* noop */ }
                safeEmit(onProgress, {
                    step: 1,
                    totalSteps: 2,
                    stage: 'backup',
                    trustConfirmed: true,
                    percent: 100,
                    message: '아이폰 백업 완료 ✅'
                });
                try {
                    await Utils.sleep(600);
                }
                catch (_e) { /* noop */ }
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
                        if (version)
                            deviceInfo.os = `iOS ${version}`;
                    }
                }
                catch (_e) {
                    console.warn('기기 정보 추출 실패(무시하고 진행)');
                }
                Utils.cleanDirectory(MVT_RESULT);
                if (!fs.existsSync(MVT_RESULT))
                    fs.mkdirSync(MVT_RESULT);
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
                await iosMvtExecution.runMvtAnalysis({
                    onProgress,
                    progressPolicy,
                    backupElapsedSec,
                    outputDir: MVT_RESULT,
                    backupPath: specificBackupPath
                });
                const results = iosMvtParser.parseMvtResults(MVT_RESULT, deviceInfo);
                return results;
            }
            catch (err) {
                console.error('iOS 검사 프로세스 오류:', err.message);
                return { error: '검사 실패: ' + err.message };
            }
        },
        async deleteBackup(udid) {
            console.log(`--- [Security] 삭제 요청 수신 (전달된 UDID: ${udid}) ---`);
            if (!udid)
                return { success: false, error: 'No UDID provided' };
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
                return {
                    success: true,
                    deleted: true,
                    message: '검사에 사용된 iOS 임시 백업 데이터가 삭제되었습니다.'
                };
            }
            catch (err) {
                console.error('[Security] 삭제 오류:', err.message);
                return { success: false, deleted: false, error: err.message };
            }
        }
    };
    return service;
}

module.exports = { createIosService };
