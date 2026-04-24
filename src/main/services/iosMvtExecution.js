function createIosMvtExecutionHelpers({ fs, path, Utils, getDirectoryStats, estimateTotalFromGrowth, clampPercent, randomIntInclusive, safeEmit }) {
    function createMvtStatsRefresher(outputDir) {
        const mvtStatsCache = {
            bytes: 0,
            files: 0,
            scannedAt: 0,
            running: false
        };
        return async function refreshMvtStats(force = false) {
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
                            resolve(getDirectoryStats(fs, path, outputDir));
                        }
                        catch (_e) {
                            resolve({ bytes: mvtStatsCache.bytes, files: mvtStatsCache.files });
                        }
                    });
                });
                mvtStatsCache.bytes = Math.max(mvtStatsCache.bytes, stat.bytes || 0);
                mvtStatsCache.files = Math.max(mvtStatsCache.files, stat.files || 0);
                mvtStatsCache.scannedAt = Date.now();
            }
            finally {
                mvtStatsCache.running = false;
            }
            return { bytes: mvtStatsCache.bytes, files: mvtStatsCache.files };
        };
    }
    function createMvtTicker({ onProgress, outputDir }) {
        let mvtTicker = null;
        let mvtLastPct = 0;
        let mvtEstFiles = 0;
        let mvtEstBytes = 0;
        let mvtTickerBusy = false;
        const refreshMvtStats = createMvtStatsRefresher(outputDir);
        const start = () => {
            mvtTicker = setInterval(async () => {
                if (mvtTickerBusy)
                    return;
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
                }
                catch (_e) {
                }
                finally {
                    mvtTickerBusy = false;
                }
            }, 1000);
        };
        const stop = () => {
            if (mvtTicker)
                clearInterval(mvtTicker);
            mvtTicker = null;
        };
        return {
            start,
            stop,
            getLastPercent: () => mvtLastPct
        };
    }
    async function maybeExtendMvtStage({ onProgress, progressPolicy, backupElapsedSec, mvtStageStartedAt, initialPercent }) {
        if (progressPolicy !== 'random_20_30') {
            return;
        }
        if (!(backupElapsedSec && backupElapsedSec > 0)) {
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
        let lastEmittedPct = Math.max(12, initialPercent || 0);
        while (((Date.now() - holdStartAt) / 1000) < remainingHoldSec) {
            const holdElapsedSec = Math.max(0, (Date.now() - holdStartAt) / 1000);
            const holdRatio = remainingHoldSec > 0 ? Math.max(0, Math.min(1, holdElapsedSec / remainingHoldSec)) : 1;
            const targetPct = Math.min(97, 14 + Math.floor(holdRatio * 78));
            if (targetPct > lastEmittedPct) {
                lastEmittedPct = targetPct;
            }
            const msgIndex = Math.min(analysisMessages.length - 1, Math.floor((holdElapsedSec / Math.max(12, remainingHoldSec / analysisMessages.length))));
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
    }
    async function runMvtAnalysis({ onProgress, progressPolicy, backupElapsedSec, outputDir, backupPath }) {
        const ticker = createMvtTicker({ onProgress, outputDir });
        const mvtCmd = `mvt-ios check-backup --output "${outputDir}" "${backupPath}"`;
        const mvtStageStartedAt = Date.now();
        try {
            ticker.start();
            await Utils.runCommand(mvtCmd).catch(() => console.warn('MVT 실행 중 경고 무시'));
        }
        finally {
            ticker.stop();
        }
        await maybeExtendMvtStage({
            onProgress,
            progressPolicy,
            backupElapsedSec,
            mvtStageStartedAt,
            initialPercent: ticker.getLastPercent()
        });
        safeEmit(onProgress, {
            step: 2,
            totalSteps: 2,
            stage: 'mvt',
            trustConfirmed: true,
            percent: 100,
            message: ' MVT 정밀 분석 완료 ✅'
        });
    }
    return {
        runMvtAnalysis
    };
}

module.exports = { createIosMvtExecutionHelpers };
