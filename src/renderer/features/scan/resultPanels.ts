import type { RendererState } from '../../../types/renderer-context';

type InitIosAppListArgs = {
  State: RendererState;
  Utils: {
    formatAppName(name: string): string;
  };
  apps: any[];
  container: HTMLElement | null;
};

type SuspiciousListArgs = {
  suspiciousApps: any[];
  isIos: boolean;
  formatAppName(name: string): string;
};

type PrivacyThreatListArgs = {
  privacyApps: any[];
  clear(target: Element): void;
  formatAppName(name: string): string;
};

export function initIosAppListControls({ State, Utils, apps, container }: InitIosAppListArgs): void {
  if (Array.isArray(State.scanRuntime?.androidListCleanup)) {
    State.scanRuntime.androidListCleanup.forEach(fn => { try { (fn as Function)?.(); } catch (_) { /* noop */ } });
  }
  State.scanRuntime.androidListCleanup = [];

  const input = document.getElementById('apps-search') as HTMLInputElement | null;
  if (!input || !container) return;

  const getName = (app: any) => {
    const name = app?.cachedTitle || app?.name || app?.displayName || Utils.formatAppName(app?.packageName || app?.bundleId || '');
    return String(name || '');
  };
  void getName;

  const list = Array.isArray(apps) ? apps : [];
  void list;

  const apply = () => {
    const q = String(input.value || '').trim().toLowerCase();
    const cards = container.querySelectorAll('.ios-app-card');
    if (!cards.length) return;

    cards.forEach(card => {
      const titleEl = card.querySelector('.ios-app-name');
      const title = titleEl ? String(titleEl.textContent || '').toLowerCase() : '';
      (card as HTMLElement).style.display = (!q || title.includes(q)) ? '' : 'none';
    });
  };

  const onInput = () => apply();
  input.addEventListener('input', onInput);
  State.scanRuntime.androidListCleanup.push(() => input.removeEventListener('input', onInput));

  apply();
}

export function renderSuspiciousList({ suspiciousApps, isIos, formatAppName }: SuspiciousListArgs): void {
  const container = document.getElementById('spyware-detail-container') || document.getElementById('suspicious-list-container');
  if (!container) return;

  const list = Array.isArray(suspiciousApps) ? suspiciousApps.slice() : [];

  if (list.length === 0) {
    const safeMessage = isIos
      ? '정밀 분석 결과, 알려진 스파이웨어 흔적이 발견되지 않았습니다.'
      : '정밀 분석 결과, 스파이앱으로 확정된 항목이 없습니다.';
    container.innerHTML = `
                    <div class="empty-soft scs-1ca3ba3c">
                        <div class="scs-568eaa97">✅</div>
                        <div class="scs-8e18acb2">안전함 (Clean)</div>
                        <div class="scs-6503d6d6">${safeMessage}</div>
                    </div>
                `;
    return;
  }

  const escapeHtml = (v: unknown) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeReasons = (app: any) => {
    const reasons = Array.isArray(app?.riskReasons) ? app.riskReasons : [];
    if (reasons.length) {
      return reasons.map((r: any) => {
        const title = r?.title || r?.code || '탐지 근거';
        const detail = r?.detail || r?.description || '';
        const sev = String(r?.severity || '').toUpperCase();
        return { title, detail, sev };
      });
    }
    const fallback = app?.reason ? String(app.reason) : '';
    return fallback ? [{ title: '탐지 근거', detail: fallback, sev: 'HIGH' }] : [];
  };

  const sevBadge = (sev: unknown) => {
    const s = String(sev || '').toUpperCase();
    const label = (s === 'HIGH') ? '높음' : (s === 'MEDIUM' ? '중간' : '참고');
    return `<span class="scs-e2f81c9f">${label}</span>`;
  };

  const actionChips = `
                <div class="scs-4b8a213c">
                    <span class="scs-31de4950">🛡️ 권한 무력화</span>
                    <span class="scs-31de4950">🗑️ 강제 삭제</span>
                </div>
                <div class="scs-06b90fa5">
                    <b>증거 보존을 원하신다면</b> 우선 <b>권한을 무력화</b>하여 증거를 보존하세요. 핵심 권한이 차단되면 스파이앱은 실질적인 활동을 수행하기 어렵습니다.<br/>
                    <b>강제 삭제</b>는 증거 보존에는 불리할 수 있지만, 보고서(PDF)가 출력되므로 "찝찝함"을 해소하려면 삭제가 가장 확실한 방법입니다.
                </div>
            `;

  const html = ['<div class="evidence-list scs-1be5ad5c">'];
  list.forEach(app => {
    const name = app.cachedTitle || formatAppName(app.packageName);
    const pkg = app.packageName || app.bundleId || '-';
    const narration = app.aiNarration || app.ai || app.reason || '';
    const reasons = normalizeReasons(app);

    const reasonsHtml = reasons.length ? `
                    <div class="scs-5371db16">
                        <div class="scs-481a87d1">🤖 탐지 근거</div>
                        <div class="scs-5ba2fd66">
                            ${reasons.slice(0, 10).map((r: any) => `
                                <div class="scs-c2a105f8">
                                    <div class="scs-d03ad3be">
                                        <div class="scs-9e326a8b">${escapeHtml(r.title)}</div>
                                        ${sevBadge(r.sev)}
                                    </div>
                                    ${r.detail ? `<div class="scs-59def752">${escapeHtml(r.detail)}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : '';

    html.push(`
                    <details class="evidence-item" open class="scs-840eea4c">
                        <summary class="scs-172f5022">
                            <div class="scs-088b1b25">🚨 ${escapeHtml(name)} <span class="scs-275677d5">(${escapeHtml(pkg)})</span></div>
                            <span class="scs-b169df12">최종 확정</span>
                        </summary>
                        ${narration ? `<div class="scs-df496d2a"><b>BD_SFA 해석</b><br/>${escapeHtml(narration)}</div>` : ''}
                        ${reasonsHtml}
                        <div class="scs-002535c2">
                            <div class="scs-9e326a8b">✅ 권장 조치</div>
                            ${actionChips}
                        </div>
                    </details>
                `);
  });
  html.push('</div>');
  container.innerHTML = html.join('');
}

export function renderPrivacyThreatList({ privacyApps, clear, formatAppName }: PrivacyThreatListArgs): void {
  const containers = [
    document.getElementById('privacy-threat-detail-container'),
    document.getElementById('privacy-threat-list-container')
  ].filter(Boolean) as HTMLElement[];
  if (containers.length === 0) return;

  containers.forEach(c => { clear(c); });

  const normalizedApps = (Array.isArray(privacyApps) ? privacyApps : [])
    .filter(Boolean)
    .map((app, index) => {
      if (typeof app !== 'object') {
        return {
          packageName: `unknown.app.${index + 1}`,
          cachedTitle: String(app),
          aiNarration: '[개인정보 유출 위협] 세부 데이터를 해석하지 못했습니다.',
          riskReasons: [],
          recommendation: [{ label: '세부 데이터 확인' }]
        };
      }

      const identifier = String(
        app.packageName
        || app.bundleId
        || app.identifier
        || app.id
        || `unknown.app.${index + 1}`
      );

      const displayName = String(
        app.cachedTitle
        || app.name
        || app.displayName
        || app.title
        || formatAppName(identifier)
      );

      return {
        ...app,
        packageName: identifier,
        cachedTitle: displayName,
        aiNarration: app.aiNarration || app.ai || app.reason || '[개인정보 유출 위협] 세부 안내를 불러오지 못했습니다.',
        riskReasons: Array.isArray(app.riskReasons) ? app.riskReasons : (Array.isArray(app.reasons) ? app.reasons : []),
        recommendation: Array.isArray(app.recommendation) ? app.recommendation : (Array.isArray(app.recommendations) ? app.recommendations : [{ label: '공유 설정/기록 점검' }, { label: '백그라운드 실행 제한' }])
      };
    });

  if (normalizedApps.length === 0) {
    const emptyHtml = `
                                    <div class="scs-3116fb7c">
                                        ✅ 탐지된 개인정보 유출 위협이 없습니다.
                                    </div>`;
    containers.forEach(c => { c.innerHTML = emptyHtml; });
    return;
  }

  const buildChips = (items: any[], host: HTMLElement | null) => {
    if (!Array.isArray(items) || items.length === 0 || !host) return;
    items.forEach((x) => {
      const chip = document.createElement('span');
      chip.className = 'scs-a0b0d84f';
      chip.textContent = String(x?.label || x || '');
      host.appendChild(chip);
    });
  };

  const buildReasons = (reasons: any[], host: HTMLElement | null) => {
    if (!Array.isArray(reasons) || reasons.length === 0) return '';

    const toReasonText = (r: any) => {
      if (r == null) return '';
      if (typeof r === 'string') return r;
      if (typeof r === 'number' || typeof r === 'boolean') return String(r);

      if (typeof r === 'object') {
        const title = r.title ?? r.name ?? r.rule ?? r.label ?? r.type ?? r.code ?? '';
        const detail = r.detail ?? r.desc ?? r.description ?? r.reason ?? r.value ?? '';

        if (title && detail) return `${title} - ${detail}`;
        if (title) return String(title);
        if (detail) return String(detail);

        try {
          return JSON.stringify(r);
        } catch (_e) {
          return String(r);
        }
      }

      return String(r);
    };

    reasons
      .filter(Boolean)
      .slice(0, 8)
      .forEach((r) => {
        const t = toReasonText(r).trim();
        if (!t || !host) return;

        let title = t;
        let desc = '';
        const separators = [' - ', ' — ', ' – ', ': ', ' : '];
        for (const sep of separators) {
          const idx = t.indexOf(sep);
          if (idx > 0 && idx < t.length - sep.length) {
            title = t.slice(0, idx).trim();
            desc = t.slice(idx + sep.length).trim();
            break;
          }
        }

        const li = document.createElement('li');
        li.className = 'scs-dddb9c88';

        const dot = document.createElement('span');
        dot.className = 'scs-9f4a211c';
        li.appendChild(dot);

        const body = document.createElement('div');
        body.className = 'scs-3f9f96c6';

        const titleEl = document.createElement('div');
        titleEl.className = 'scs-a6341b0b';
        titleEl.textContent = title;
        body.appendChild(titleEl);

        if (desc) {
          const descEl = document.createElement('div');
          descEl.className = 'scs-56d5d3f9';
          descEl.textContent = desc;
          body.appendChild(descEl);
        }

        li.appendChild(body);
        host.appendChild(li);
      });
  };

  containers.forEach((container) => {
    normalizedApps.forEach((app) => {
      const dName = app.cachedTitle || formatAppName(app.packageName);
      const policyLabel = app.policyLabel || app.policy || '';
      const aiText = app.aiNarration || app.ai || app.reason || '[개인정보 유출 위협] 위치 기반 정보 공유 가능성이 있습니다.';
      const reasons = app.riskReasons || app.reasons || [];
      const recs = app.recommendation || app.recommendations || [
        { label: '공유 설정/기록 점검' },
        { label: '백그라운드 실행 제한' }
      ];

      const card = document.createElement('div');
      card.className = 'scs-51065922';

      const head = document.createElement('div');
      head.className = 'scs-ca5e0e95';

      const title = document.createElement('div');
      title.className = 'scs-84b9e4a2';
      title.textContent = `⚠️ ${dName} `;
      const pkg = document.createElement('span');
      pkg.className = 'scs-0fcb4300';
      pkg.textContent = `(${app.packageName})`;
      title.appendChild(pkg);
      head.appendChild(title);

      if (policyLabel) {
        const policy = document.createElement('div');
        policy.className = 'scs-c3c4423e';
        policy.textContent = `정책: ${policyLabel}`;
        head.appendChild(policy);
      }

      const aiBox = document.createElement('div');
      aiBox.className = 'scs-6551985d';
      const aiLabel = document.createElement('div');
      aiLabel.className = 'scs-989b00fa';
      aiLabel.textContent = '🤖 AI 안내';
      const aiBody = document.createElement('div');
      aiBody.className = 'scs-a73acd8b';
      aiBody.textContent = aiText;
      aiBox.appendChild(aiLabel);
      aiBox.appendChild(aiBody);

      const reasonsBox = document.createElement('div');
      reasonsBox.className = 'scs-6b9902a8';
      const reasonsLabel = document.createElement('div');
      reasonsLabel.className = 'scs-989b00fa';
      reasonsLabel.textContent = '🤖 AI 판단 근거';
      reasonsBox.appendChild(reasonsLabel);
      const reasonsList = document.createElement('ul');
      reasonsList.className = 'scs-54163068';
      buildReasons(reasons, reasonsList);
      reasonsBox.appendChild(reasonsList);

      const recBox = document.createElement('div');
      recBox.className = 'scs-5371db16';
      const recLabel = document.createElement('div');
      recLabel.className = 'scs-3493d013';
      recLabel.textContent = '✅ 권장 조치';
      const chipsHost = document.createElement('div');
      buildChips(recs, chipsHost);
      recBox.appendChild(recLabel);
      recBox.appendChild(chipsHost);

      card.appendChild(head);
      card.appendChild(aiBox);
      card.appendChild(reasonsBox);
      card.appendChild(recBox);
      container.appendChild(card);
    });
  });
}
