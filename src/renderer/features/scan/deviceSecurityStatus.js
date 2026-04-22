export function createDeviceSecurityStatusController() {
    const escapeHtml = (v) => String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    const badge = (status, level) => {
        const raw = String(status || 'UNKNOWN');
        const upper = raw.toUpperCase();
        const s = upper.startsWith('ON') ? 'ON'
            : upper.startsWith('OFF') ? 'OFF'
                : upper.startsWith('UNKNOWN') ? 'UNKNOWN'
                    : upper;
        const sev = String(level || '').toLowerCase();
        let cls = 'pill';
        let style = '';
        if (s === 'ON' && (sev === 'high' || sev === 'medium')) {
            cls += ' pill-danger';
        }
        else if (s === 'ON' && sev === 'info') {
            cls += ' pill-warn';
        }
        else if (s === 'OFF') {
            style = 'background:#ecfdf3;color:#027a48;border:1px solid #abefc6;';
        }
        else {
            style = 'background:#f2f4f7;color:#344054;border:1px solid #eaecf0;';
        }
        const suffix = upper.startsWith('ON') && raw.includes('(') ? escapeHtml(raw.slice(2).trim()) : '';
        return `<span class="${cls}" style="${style}">${s}${suffix ? ` <span style="opacity:.8; font-weight:500;">${suffix}</span>` : ''}</span>`;
    };
    const renderChips = (list) => {
        if (!Array.isArray(list) || list.length === 0)
            return '';
        const chips = list.map((x) => `<span class="ds-chip">${escapeHtml(x)}</span>`).join('');
        return `<div class="ds-chip-row">${chips}</div>`;
    };
    const renderActions = (actions, itemId) => {
        if (!Array.isArray(actions) || actions.length === 0)
            return '';
        const btns = actions.map((a) => {
            const kind = String(a.kind || '').toLowerCase();
            const label = escapeHtml(a.label || (kind === 'opensettings' ? '설정 열기' : '실행'));
            const data = {
                kind: a.kind,
                target: a.target,
                value: a.value,
                intent: a.intent,
                component: a.component,
                itemId
            };
            const encoded = encodeURIComponent(JSON.stringify(data));
            return `<button class="ds-btn ds-action-btn" data-ds-kind="${escapeHtml(kind)}" data-ds-action="${encoded}">${label}</button>`;
        }).join('');
        return `<div class="ds-actions">${btns}</div>`;
    };
    const render = (payload, container) => {
        if (!container)
            return;
        if (payload && typeof payload.then === 'function') {
            container.textContent = '상태 확인 중...';
            payload
                .then((resolved) => render(resolved, container))
                .catch((e) => {
                console.warn('[DeviceSecurityStatus] load failed', e);
                container.textContent = '기기 보안 상태를 불러오지 못했습니다.';
            });
            return;
        }
        const resolvedPayload = payload;
        if (!resolvedPayload || resolvedPayload.ok === false) {
            container.textContent = resolvedPayload?.error ? `불러오기 실패: ${resolvedPayload.error}` : '불러오기 실패';
            return;
        }
        const items = Array.isArray(resolvedPayload.items) ? resolvedPayload.items : [];
        if (items.length === 0) {
            container.textContent = '표시할 점검 항목이 없습니다.';
            return;
        }
        const rows = items.map((it) => {
            const note = it.note ? `<div class="ds-note">${escapeHtml(it.note)}</div>` : '';
            const detailText = it.detail || it.desc || '';
            const chips = renderChips(it.list);
            return `
              <div class="ds-card ds-${escapeHtml(String(it.level || 'unknown').toLowerCase())}">
                <div class="ds-head">
                  <div class="ds-title">${escapeHtml(it.title)}</div>
                  ${badge(it.status, it.level)}
                </div>
                ${detailText ? `<div class="ds-desc">${escapeHtml(detailText)}</div>` : ''}
                ${chips}
                ${renderActions(it.actions, it.id)}
                ${note}
              </div>
            `;
        }).join('');
        container.innerHTML = `
          <div class="ds-guide">
            <div class="ds-guide-title">안내</div>
            <div class="ds-guide-desc">
              이 메뉴는 스파이앱 침입에 악용될 수 있는 설정을 점검합니다. 목록에 앱이 표시된다고 해서 <b>곧바로 스파이앱</b>을 의미하지는 않습니다.
              다만 사용자가 설치/허용한 앱 중 <b>모르는 앱</b>이 있으면 점검이 필요합니다.
              <br><br>
              <b>USB 디버깅(ADB)</b>은 정밀 검사 수행을 위해 활성화될 수 있으며, 검사 종료 후에는 비활성화하는 것을 권장합니다.
            </div>
          </div>
          ${rows}
        `;
        try {
            if (!container.__dsBound) {
                container.addEventListener('click', async (ev) => {
                    const target = ev.target;
                    const btn = target && target.closest ? target.closest('.ds-action-btn') : null;
                    if (!btn)
                        return;
                    const raw = btn.getAttribute('data-ds-action');
                    if (!raw)
                        return;
                    let actionPayload = null;
                    try {
                        actionPayload = JSON.parse(decodeURIComponent(raw));
                    }
                    catch (_e) {
                        actionPayload = null;
                    }
                    if (!actionPayload || !actionPayload.kind)
                        return;
                    if (!window.electronAPI || typeof window.electronAPI.performDeviceSecurityAction !== 'function') {
                        console.warn('[DeviceSecurityStatus] performDeviceSecurityAction not available');
                        return;
                    }
                    btn.disabled = true;
                    const oldText = btn.textContent;
                    btn.textContent = '처리 중...';
                    try {
                        await window.electronAPI.performDeviceSecurityAction({ action: actionPayload });
                        const refreshed = await window.electronAPI.getDeviceSecurityStatus();
                        render(refreshed, container);
                    }
                    catch (e) {
                        console.warn('[DeviceSecurityStatus] action failed', e);
                        try {
                            btn.textContent = oldText || '실패';
                        }
                        catch (_e) { /* noop */ }
                    }
                    finally {
                        try {
                            btn.disabled = false;
                        }
                        catch (_e) { /* noop */ }
                        try {
                            btn.textContent = oldText;
                        }
                        catch (_e) { /* noop */ }
                    }
                });
                container.__dsBound = true;
            }
        }
        catch (_e) {
            /* noop */
        }
    };
    return {
        async load(container) {
            if (!container || !window.electronAPI?.getDeviceSecurityStatus)
                return;
            container.textContent = '상태 확인 중...';
            try {
                const sec = await window.electronAPI.getDeviceSecurityStatus();
                render(sec, container);
            }
            catch (e) {
                console.warn('[DeviceSecurityStatus] load failed', e);
                try {
                    container.textContent = '기기 보안 상태를 불러오지 못했습니다.';
                }
                catch (_e) { /* noop */ }
            }
        },
        render
    };
}
