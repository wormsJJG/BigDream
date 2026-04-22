export function createAndroidScanProgressHelpers({ ViewManager, Utils }) {
  function startPhase1AdbProgress() {
    let percent = 0;
    let finished = false;

    const tick = () => {
      if (finished) return;
      percent = Math.min(98, percent + 2);
      ViewManager.updateProgress(percent, '기기 메타데이터 수집 중...');
      if (!finished && percent < 98) {
        timer = setTimeout(tick, 120);
      }
    };

    let timer = setTimeout(tick, 120);

    return {
      finish() {
        finished = true;
        clearTimeout(timer);
        ViewManager.updateProgress(100, '메타데이터 수집 완료');
      }
    };
  }

  function startPhase2TimedProgress({ totalDurationMs, apps, onDone }) {
    const totalApps = Array.isArray(apps) ? apps.length : 0;
    const startedAt = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const ratio = totalDurationMs <= 0 ? 1 : Math.min(1, elapsed / totalDurationMs);
      const currentIndex = Math.min(totalApps, Math.max(1, Math.ceil(ratio * totalApps)));
      const percent = Math.min(99, Math.floor(ratio * 99));
      const app = apps[Math.max(0, currentIndex - 1)];
      const appName = app ? Utils.formatAppName(app.packageName) : '앱';

      ViewManager.updateProgress(percent, `[${currentIndex}/${totalApps}] ${appName} 정밀 분석 중...`);

      if (ratio >= 1) {
        onDone?.();
        return;
      }

      setTimeout(tick, 1000);
    };

    tick();
  }

  return {
    startPhase1AdbProgress,
    startPhase2TimedProgress
  };
}
