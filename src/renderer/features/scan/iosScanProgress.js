export function createIosScanProgressHelpers({ Utils, IOS_TRUST_PROMPT_MESSAGE }) {
  function setIosStep(step, text) {
    const progressBar = document.getElementById('progress-bar');
    const stepperProgress = document.getElementById('ios-stepper-progress');
    const statusText = document.getElementById('scan-status-text');
    const percentMap = { 1: 20, 2: 55, 3: 85, 4: 98 };
    const stepperPercentMap = { 1: 0, 2: 25, 3: 50, 4: 75 };
    const percent = percentMap[step] || 0;
    const stepperPercent = stepperPercentMap[step] || 0;

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (stepperProgress) stepperProgress.style.width = `${stepperPercent}%`;
    if (statusText) statusText.textContent = text || IOS_TRUST_PROMPT_MESSAGE;

    for (let index = 1; index <= 4; index += 1) {
      const stepElement = document.getElementById(`ios-step-${index}`);
      if (!stepElement) continue;

      stepElement.classList.remove('done', 'current', 'pending');

      if (index < step) {
        stepElement.classList.add('done');
      } else if (index === step) {
        stepElement.classList.add('current');
      } else {
        stepElement.classList.add('pending');
      }
    }
  }

  function hasMeaningfulBackupSignal(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const backupProgress = Number(payload.backupProgress || 0);
    const filesProcessed = Number(payload.filesProcessed || 0);
    return backupProgress > 0 || filesProcessed > 0;
  }

  function resolveIosStageMessage(payload) {
    if (!payload || typeof payload !== 'object') return IOS_TRUST_PROMPT_MESSAGE;
    const message = String(payload.message || '').trim();
    if (message) return message;
    const stage = String(payload.stage || '').trim().toLowerCase();
    if (stage === 'backup') return '검사 데이터 수집 중...';
    if (stage === 'mvt') return '정밀 분석 진행 중...';
    return IOS_TRUST_PROMPT_MESSAGE;
  }

  return {
    setIosStep,
    hasMeaningfulBackupSignal,
    resolveIosStageMessage
  };
}
