export function createScanLayoutRuntimeHelpers({ BD_DOM, document }) {
  function resetAndroidDashboardUI() {
    const log = document.getElementById('log-container');
    if (log) BD_DOM.clear(log);

    const badge = document.getElementById('dash-connection');
    if (badge) {
      badge.textContent = '● CONNECTION';
      badge.classList.remove('is-disconnected');
    }

    const safeSet = (id, text) => {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    };

    safeSet('live-bat-text', '--%');
    safeSet('live-ram-text', '--%');
    safeSet('live-temp-text', '--.- °C');
    safeSet('live-bat-val', '0');
    safeSet('live-ram-val', '0');
    safeSet('live-temp-val', '0');
    safeSet('live-model-name', '-');
    safeSet('live-os-version', 'ANDROID');
    safeSet('live-serial-number', '-');

    const rootedEl = document.getElementById('live-rooted-status');
    if (rootedEl) {
      rootedEl.textContent = 'UNKNOWN';
      rootedEl.classList.remove('status-safe', 'status-danger');
    }

    const tbody = document.getElementById('dash-top-tbody');
    if (tbody) {
      BD_DOM.clear(tbody);
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'empty';
      td.textContent = '데이터 대기 중...';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    const status = document.getElementById('android-scan-running-text');
    if (status) {
      status.textContent = '검사 준비 중';
      status.style.color = '';
    }

    const percentEl = document.getElementById('android-progress-percent-text');
    if (percentEl) percentEl.textContent = '0%';

    const procEl = document.getElementById('android-scan-status-text');
    if (procEl) procEl.textContent = '0/0';

    const bar = document.getElementById('android-progress-bar');
    if (bar) bar.style.width = '0%';
  }

  function setDashboardScrollLock(on) {
    const root = document.documentElement;
    const body = document.body;
    const main = document.querySelector('.main-content');
    const value = !!on;

    if (root) root.classList.toggle('bd-no-scroll', value);
    if (body) body.classList.toggle('bd-no-scroll', value);
    if (main) main.classList.toggle('bd-no-scroll', value);
  }

  return {
    resetAndroidDashboardUI,
    setDashboardScrollLock
  };
}
