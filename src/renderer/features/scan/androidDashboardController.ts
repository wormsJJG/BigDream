import { setCircularGauge } from '../../lib/circularGauge.js';
import type { RendererState } from '../../../types/renderer-context';

type DashboardDeps = {
  State: RendererState;
  CustomUI: {
    alert(message: string): Promise<void>;
  };
  clear(target: Element): void;
};

type DashboardMetrics = {
  batteryLevel?: number;
  memUsagePercent?: number;
  deviceTempC?: number;
  connected?: boolean;
};

type DashboardSpec = {
  model?: string;
  android?: string;
  serial?: string;
  rooted?: string;
};

type DashboardTopItem = {
  pid?: string | number;
  cpu?: string | number;
  mem?: string | number;
  name?: string;
};

type DashboardPayload = {
  ok?: boolean;
  metrics?: DashboardMetrics;
  spec?: DashboardSpec;
  top?: DashboardTopItem[];
};

export function createAndroidDashboardController({ State, CustomUI, clear }: DashboardDeps) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let failCount = 0;
  let disconnectedNotified = false;

  const setText = (id: string, val: unknown) => {
    const el = document.getElementById(id);
    if (el) el.textContent = (val === undefined || val === null || val === '') ? '-' : String(val);
  };

  const setGauge = (gaugeId: string, valId: string, percent: unknown) => {
    const el = document.getElementById(gaugeId);
    const valEl = document.getElementById(valId);
    const p = Number(percent);
    const safe = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;

    if (valEl) {
      valEl.textContent = String(Math.round(safe));
    }
    if (!el) return;

    setCircularGauge(el, safe);
  };

  const notifyDisconnectedOnce = async () => {
    if (disconnectedNotified) return;
    disconnectedNotified = true;
    try {
      await CustomUI.alert('⚠️ 기기 연결이 끊겼습니다. USB 연결을 확인해주세요.');
    } catch (_) {
      /* noop */
    }
  };

  const renderView = ({ metrics, spec, top }: { metrics?: DashboardMetrics; spec?: DashboardSpec; top?: DashboardTopItem[] }) => {
    if (metrics) {
      const bat = (metrics.batteryLevel !== undefined) ? Number(metrics.batteryLevel) : null;
      setText('live-bat-text', (bat === null || !Number.isFinite(bat)) ? '--%' : `${bat}%`);
      setGauge('bat-gauge', 'live-bat-val', bat);

      const ram = (metrics.memUsagePercent !== undefined) ? Number(metrics.memUsagePercent) : null;
      setText('live-ram-text', (ram === null || !Number.isFinite(ram)) ? '--%' : `${ram}%`);
      setGauge('ram-gauge', 'live-ram-val', ram);

      const t = (metrics.deviceTempC !== undefined) ? Number(metrics.deviceTempC) : null;
      setText('live-temp-text', (t === null || !Number.isFinite(t)) ? '--.- °C' : `${t.toFixed(1)} °C`);
      const tempValEl = document.getElementById('live-temp-val');
      if (tempValEl) {
        tempValEl.textContent = (t === null || !Number.isFinite(t)) ? '-' : String(Math.round(t));
      }
      const tPct = (t === null || !Number.isFinite(t)) ? 0 : t;
      setGauge('temp-gauge', 'live-temp-val', tPct);

      const status = document.getElementById('dash-connection');
      if (status) {
        const isConnected = metrics.connected !== false;
        status.textContent = isConnected ? '● CONNECTION' : '● DISCONNECTED';
        status.classList.toggle('is-disconnected', !isConnected);
      }
    }

    if (spec) {
      setText('live-model-name', spec.model || '-');
      setText('live-os-version', spec.android || 'ANDROID');
      setText('live-serial-number', spec.serial || '-');
      const rootedEl = document.getElementById('live-rooted-status');
      if (rootedEl) {
        const rooted = String(spec.rooted || '').toLowerCase();
        const isSafe = (rooted === 'off' || rooted === 'false' || rooted.includes('safe'));
        rootedEl.textContent = spec.rooted || 'UNKNOWN';
        rootedEl.classList.toggle('status-safe', isSafe);
        rootedEl.classList.toggle('status-danger', !isSafe);
      }
    }

    const tbody = document.getElementById('dash-top-tbody');
    if (!tbody) return;

    clear(tbody);
    if (Array.isArray(top) && top.length) {
      const frag = document.createDocumentFragment();
      top.forEach((p) => {
        const tr = document.createElement('tr');
        const tdPid = document.createElement('td');
        const tdCpu = document.createElement('td');
        const tdMem = document.createElement('td');
        const tdName = document.createElement('td');

        tdPid.textContent = (p && p.pid != null) ? String(p.pid) : '-';
        tdCpu.textContent = (p && p.cpu != null) ? String(p.cpu) : '-';
        tdMem.textContent = (p && p.mem != null) ? String(p.mem) : '-';
        tdName.className = 'name';
        tdName.textContent = (p && p.name != null) ? String(p.name) : '-';

        tr.appendChild(tdPid);
        tr.appendChild(tdCpu);
        tr.appendChild(tdMem);
        tr.appendChild(tdName);
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);
      return;
    }

    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = '데이터 대기 중...';
    tr.appendChild(td);
    tbody.appendChild(tr);
  };

  const render = async () => {
    try {
      const res = await window.electronAPI?.getAndroidDashboardData?.() as DashboardPayload | undefined;
      if (!res || !res.ok) {
        failCount += 1;
        if (failCount >= 3) await notifyDisconnectedOnce();
        return;
      }
      failCount = 0;
      renderView(res);
      if (res.metrics && res.metrics.connected === false) {
        await notifyDisconnectedOnce();
      }
    } catch (_e) {
      failCount += 1;
      if (failCount >= 3) await notifyDisconnectedOnce();
    }
  };

  return {
    start() {
      this.stop();
      if (State.currentDeviceMode !== 'android') return;
      failCount = 0;
      render();
      timer = setInterval(render, 1000);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    render: renderView
  };
}
