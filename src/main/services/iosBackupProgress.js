function createIosBackupProgressHelpers({ fs, path, Utils, formatBytes, getDirectoryStats, safeEmit, trustPromptMessage }) {
    async function getUsedBytes(infoPath, udid) {
        const keyTry = async (key) => {
            try {
                const out = await Utils.runCommand(`"${infoPath}" -u ${udid} -k ${key}`);
                const v = String(out || '').trim();
                const n = parseInt(v, 10);
                return Number.isFinite(n) ? n : 0;
            }
            catch (_e) {
                return 0;
            }
        };
        const cap = await keyTry('TotalDiskCapacity') || await keyTry('TotalDataCapacity');
        const avail = await keyTry('TotalDiskAvailable') || await keyTry('TotalDataAvailable');
        if (cap > 0 && avail >= 0 && cap >= avail) {
            return cap - avail;
        }
        return 0;
    }
    function buildBackupMessage(bytes, files) {
        return `아이폰 백업 진행 중... (파일 ${files.toLocaleString('en-US')}개 / ${formatBytes(bytes)})`;
    }
    function hasMeaningfulBackupStarted(bytes = 0, files = 0, trustedCount = null) {
        const MIN_MEANINGFUL_BACKUP_BYTES = 24 * 1024 * 1024;
        const MIN_MEANINGFUL_BACKUP_FILES = 25;
        const MIN_MEANINGFUL_BACKUP_COUNT = 25;
        const safeBytes = Number(bytes) || 0;
        const safeFiles = Number(files) || 0;
        const safeCurrent = Number(trustedCount?.cur) || 0;
        const safeTotal = Number(trustedCount?.total) || 0;
        return !!((safeCurrent >= MIN_MEANINGFUL_BACKUP_COUNT && safeTotal > 0)
            || safeBytes >= MIN_MEANINGFUL_BACKUP_BYTES
            || safeFiles >= MIN_MEANINGFUL_BACKUP_FILES);
    }
    function emitBackupProgress({ onProgress, percent, bytes, files, trustedCount, message }) {
        const stage = hasMeaningfulBackupStarted(bytes, files, trustedCount) ? 'backup' : 'device-check';
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
            message: message || (stage === 'backup'
                ? buildBackupMessage(bytes, files)
                : trustPromptMessage)
        });
    }
    function moveToward(current, target) {
        const c = Number(current) || 0;
        const t = Number(target) || 0;
        if (t <= c)
            return c;
        const gap = t - c;
        let step = gap >= 20 ? 4.2 :
            gap >= 12 ? 2.8 :
                gap >= 6 ? 1.8 : 1.0;
        if (t >= 90)
            step = Math.min(step, 1.2);
        if (t >= 96)
            step = Math.min(step, 0.8);
        return Math.min(t, c + step);
    }
    function createBackupStatsRefresher(specificBackupPath) {
        const statsCache = {
            bytes: 0,
            files: 0,
            scannedAt: 0,
            running: false
        };
        return async function refreshBackupStats(force = false) {
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
                        }
                        catch (_e) {
                            resolve({ bytes: statsCache.bytes, files: statsCache.files });
                        }
                    });
                });
                statsCache.bytes = Math.max(statsCache.bytes, stat.bytes || 0);
                statsCache.files = Math.max(statsCache.files, stat.files || 0);
                statsCache.scannedAt = Date.now();
            }
            finally {
                statsCache.running = false;
            }
            return { bytes: statsCache.bytes, files: statsCache.files };
        };
    }
    function computeRealTargetPct({ elapsedSec, estimatedTotalSec, estimatedRemainingSec, rawRatio, trustedRatio, countPct, stalledSec, displayBytes, displayFiles }) {
        let pctByTime = estimatedTotalSec > 0
            ? Math.pow(elapsedSec / estimatedTotalSec, 1.34) * 99
            : 0;
        if (elapsedSec < 60) {
            pctByTime = Math.min(pctByTime, 7);
        }
        else if (elapsedSec < 120) {
            pctByTime = Math.min(pctByTime, 15);
        }
        else if (elapsedSec < 240) {
            pctByTime = Math.min(pctByTime, 30);
        }
        else if (elapsedSec < 360) {
            pctByTime = Math.min(pctByTime, 45);
        }
        else if (elapsedSec < 480) {
            pctByTime = Math.min(pctByTime, 58);
        }
        const pctByBytes = Math.min(99, Math.pow(rawRatio, 1.18) * 100);
        const byteLeadAllowance = rawRatio < 0.40 ? 1.2 :
            rawRatio < 0.70 ? 2.0 : 3.5;
        let targetPct = Math.max(pctByTime, Math.min(pctByBytes, pctByTime + byteLeadAllowance));
        if (countPct !== null) {
            targetPct = Math.max(targetPct, Math.min(countPct, pctByTime + 4.5));
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
    }
    function computeTheaterTargetPct(elapsedSec, targetSec) {
        if (!(targetSec > 0))
            return 0;
        const ratio = Math.max(0, Math.min(1, elapsedSec / targetSec));
        let pct = Math.pow(ratio, 1.14) * 99;
        if (elapsedSec < 60) {
            pct = Math.min(pct, 4);
        }
        else if (elapsedSec < 120) {
            pct = Math.min(pct, 10);
        }
        else if (elapsedSec < 240) {
            pct = Math.min(pct, 21);
        }
        else if (elapsedSec < 360) {
            pct = Math.min(pct, 33);
        }
        return Math.min(99, pct);
    }
    return {
        getUsedBytes,
        buildBackupMessage,
        hasMeaningfulBackupStarted,
        emitBackupProgress,
        moveToward,
        createBackupStatsRefresher,
        computeRealTargetPct,
        computeTheaterTargetPct
    };
}

module.exports = { createIosBackupProgressHelpers };
