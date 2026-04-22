export function createAndroidScanRunner({ State, ViewManager, Utils, getNormalizedScanApps, androidScanProgress, scanPostActions }) {
    async function run({ onSuccess, onError, toggleLaser }) {
        try {
            const phase1 = androidScanProgress.startPhase1AdbProgress();
            const scanData = await window.electronAPI.runScan();
            phase1.finish();
            const apps = getNormalizedScanApps(scanData);
            const totalApps = apps.length;
            if (totalApps === 0) {
                toggleLaser(false);
                onSuccess(scanData);
                scanPostActions.scheduleAndroidCleanupNotice();
                return;
            }
            let targetMinutes;
            if (State.userRole === 'user') {
                targetMinutes = Math.floor(Math.random() * (30 - 20 + 1) + 20);
                console.log(`[Security Policy] 일반 업체 - 랜덤 시간 적용: ${targetMinutes}분`);
            }
            else {
                targetMinutes = State.androidTargetMinutes || 0;
                console.log(`[Security Policy] 특권 계정 - 설정 시간 적용: ${targetMinutes}분`);
            }
            setTimeout(() => {
                ViewManager.updateProgress(0, '검사 진행중...');
            }, 300);
            if (targetMinutes > 0) {
                const totalDurationMs = targetMinutes * 60 * 1000;
                console.log(`[Theater Mode] 총 ${totalApps}개 앱, 목표 ${targetMinutes}분(시간 기반)`);
                androidScanProgress.startPhase2TimedProgress({
                    totalDurationMs,
                    apps,
                    onDone: () => {
                        toggleLaser(false);
                        onSuccess(scanData);
                        scanPostActions.scheduleAndroidCleanupNotice();
                    }
                });
                return;
            }
            const timePerApp = 35;
            console.log(`[Theater Mode] 빠른 모드, 총 ${totalApps}개 앱`);
            let currentIndex = 0;
            const processNextApp = () => {
                if (currentIndex >= totalApps) {
                    toggleLaser(false);
                    onSuccess(scanData);
                    scanPostActions.scheduleAndroidCleanupNotice();
                    return;
                }
                const app = apps[currentIndex];
                const appName = Utils.formatAppName(app.packageName);
                const percent = Math.floor(((currentIndex + 1) / totalApps) * 100);
                ViewManager.updateProgress(Math.min(99, percent), `[${currentIndex + 1}/${totalApps}] ${appName} 정밀 분석 중...`);
                currentIndex++;
                setTimeout(processNextApp, timePerApp);
            };
            processNextApp();
        }
        catch (error) {
            toggleLaser(false);
            onError(error);
        }
    }
    return {
        run
    };
}
