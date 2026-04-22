type FileSystemLike = {
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: string): string;
    writeFileSync(path: string, data: string): void;
};

type PathLike = {
    join(...parts: string[]): string;
};

type DirectoryStats = {
    bytes: number;
    files: number;
};

type ProgressPayload = {
    step: number;
    totalSteps: number;
    stage: string;
    trustConfirmed: boolean;
    percent: number;
    message: string;
};

type OnProgress = ((payload: ProgressPayload) => void) | undefined;

type BackupMeta = {
    complete?: boolean;
    totalBytes?: number;
    totalFiles?: number;
};

export function createIosBackupCacheHelpers({
    fs,
    path,
    getDirectoryStats,
    removeDirectorySafe,
    safeEmit,
    trustPromptMessage
}: {
    fs: FileSystemLike;
    path: PathLike;
    getDirectoryStats(fs: FileSystemLike, path: PathLike, dirPath: string): DirectoryStats;
    removeDirectorySafe(fs: FileSystemLike, targetPath: string): Promise<boolean>;
    safeEmit(onProgress: OnProgress, payload: ProgressPayload): void;
    trustPromptMessage: string;
}) {
    function emitTrustPrompt(onProgress: OnProgress) {
        safeEmit(onProgress, {
            step: 1,
            totalSteps: 2,
            stage: 'device-check',
            trustConfirmed: false,
            percent: 0,
            message: trustPromptMessage
        });
    }

    function emitReuseReady(onProgress: OnProgress) {
        safeEmit(onProgress, {
            step: 1,
            totalSteps: 2,
            stage: 'device-check',
            trustConfirmed: true,
            percent: 100,
            message: '기존 백업 파일을 확인했습니다. 백업 파일 기반으로 바로 분석을 시작합니다.'
        });
    }

    async function resolveReusableBackup({
        specificBackupPath,
        backupMetaPath,
        onProgress
    }: {
        specificBackupPath: string;
        backupMetaPath: string;
        onProgress: OnProgress;
    }) {
        let isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));

        const manifestDb = path.join(specificBackupPath, 'Manifest.db');
        let meta: BackupMeta | null = null;
        if (fs.existsSync(backupMetaPath)) {
            try {
                meta = JSON.parse(fs.readFileSync(backupMetaPath, 'utf8')) as BackupMeta;
            } catch (_e) {
                meta = null;
            }
        }

        const hasManifest = fs.existsSync(manifestDb);
        const metaSaysComplete = !!(meta && meta.complete === true);

        emitTrustPrompt(onProgress);

        if (isBackupComplete && hasManifest && metaSaysComplete) {
            emitReuseReady(onProgress);
            return { isBackupComplete: true, meta };
        }

        if (isBackupComplete || fs.existsSync(specificBackupPath)) {
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

                    emitReuseReady(onProgress);
                    return { isBackupComplete: true, meta };
                } catch (_e) {
                    isBackupComplete = false;
                }
            } else {
                isBackupComplete = false;
                try {
                    if (fs.existsSync(specificBackupPath)) {
                        await removeDirectorySafe(fs, specificBackupPath);
                    }
                } catch (_e) { }
            }
        }

        return { isBackupComplete, meta };
    }

    return {
        emitTrustPrompt,
        emitReuseReady,
        resolveReusableBackup
    };
}
