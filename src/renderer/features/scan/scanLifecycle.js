export function createScanLifecycleHelpers({ State, ViewManager, ResultsRenderer, loggedInView }) {
  function resetSmartphoneUI() {
    const scanScreen = document.getElementById('scan-progress-screen');
    if (!scanScreen) return;

    const screen = scanScreen.querySelector('.phone-screen');
    if (!screen) return;

    screen.style.backgroundColor = '';

    const icon = screen.querySelector('.hack-icon');
    const alertText = screen.querySelector('.hack-alert');
    const statusList = screen.querySelector('div[style*="margin-top:20px"]');

    if (icon) {
      icon.className = 'hack-icon';
      icon.style.color = '';
    }

    if (alertText) {
      alertText.textContent = 'SYSTEM SCANNING';
      alertText.classList.add('sc-preline');
      alertText.style.color = '';
      alertText.style.textShadow = '';
    }

    if (statusList) {
      statusList.textContent = '[!] 비정상 권한 접근 탐지...\n\n                    [!] 실시간 프로세스 감시...\n\n                    [!] AI 기반 지능형 위협 분석 중...';
      statusList.classList.add('sc-preline');
    }

    const particles = document.querySelectorAll('.data-particle');
    particles.forEach((particle) => {
      particle.style.display = 'block';
      particle.style.opacity = '1';
    });
  }

  function finishScan(data, { endLogTransaction, toggleLaser }) {
    State.scanRuntime.inProgress = false;
    State.scanRuntime.phase = 'completed';

    endLogTransaction?.('completed');
    ViewManager.updateProgress(100, '분석 완료! 결과 리포트를 생성합니다.');
    toggleLaser?.(false);

    const particles = document.querySelectorAll('.data-particle');
    particles.forEach((particle) => {
      particle.style.opacity = '0';
      particle.style.display = 'none';
    });

    try {
      data.meta = data.meta || {};
      const clientInfo = State.clientInfo || {};
      if (clientInfo.name) data.meta.clientName = clientInfo.name;
      if (clientInfo.phone) data.meta.clientPhone = clientInfo.phone;
    } catch (_e) {}

    State.lastScanData = data;
    State.lastScanData = data;

    setTimeout(() => {
      document.querySelectorAll('.nav-item, .res-tab').forEach((element) => {
        element.classList.remove('active');
      });

      ViewManager.showScreen(loggedInView, 'scan-results-screen');
      requestAnimationFrame(() => {
        ResultsRenderer.render(data);

        const summaryTab = document.querySelector('.res-tab[data-target="res-summary"]');
        if (summaryTab) summaryTab.classList.add('active');
      });
    }, 1500);
  }

  function handleError(error, { endLogTransaction }) {
    State.scanRuntime.inProgress = false;
    State.scanRuntime.phase = 'error';

    console.error(error);
    endLogTransaction?.('error', error.message);

    const statusText = document.getElementById('scan-status-text');
    const statusBar = document.getElementById('progress-bar');
    if (statusText) statusText.textContent = '오류: ' + error.message;
    if (statusBar) statusBar.style.backgroundColor = '#d9534f';
  }

  return {
    resetSmartphoneUI,
    finishScan,
    handleError
  };
}
