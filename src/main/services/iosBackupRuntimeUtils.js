const { spawn } = require('child_process');

const noop = () => { };

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

module.exports = {
    safeEmit,
    formatBytes,
    getDirectoryStats,
    removeDirectorySafe,
    estimateTotalFromGrowth,
    parseBackupProgressLine,
    clampPercent,
    randomIntInclusive,
    normalizeIosProgressPolicy,
    spawnWithLineStream
};
