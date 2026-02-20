// Feature module: scanView
// Scan-related DOM rendering helpers (keeps controllers slim and consistent).
//
// IMPORTANT
// - This module must remain side-effect free (no electronAPI calls, no state mutations).
// - It should only render based on the given data and existing DOM nodes.

export const BD_DOM = {
    clear(el) { if (el) el.replaceChildren(); },
    text(el, value) { if (el) el.textContent = value == null ? '' : String(value); },

    el(tag, opts = {}, ...children) {
        const n = document.createElement(tag);

        if (opts.className) n.className = opts.className;
        if (opts.id) n.id = opts.id;

        if (opts.attrs && typeof opts.attrs === 'object') {
            Object.entries(opts.attrs).forEach(([k, v]) => {
                if (v === undefined || v === null) return;
                n.setAttribute(k, String(v));
            });
        }

        if (opts.dataset && typeof opts.dataset === 'object') {
            Object.assign(n.dataset, opts.dataset);
        }

        if (opts.on && typeof opts.on === 'object') {
            Object.entries(opts.on).forEach(([evt, fn]) => {
                if (typeof fn === 'function') n.addEventListener(evt, fn);
            });
        }

        const flat = children.flat();
        flat.forEach((c) => {
            if (c === undefined || c === null) return;
            if (typeof c === 'string' || typeof c === 'number') n.appendChild(document.createTextNode(String(c)));
            else n.appendChild(c);
        });

        return n;
    },

    tableMsg(tbody, colspan, msg, variant = 'info') {
        if (!tbody) return;
        tbody.replaceChildren();
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = colspan;
        td.className = `bd-table-msg bd-table-msg--${variant}`;
        td.textContent = msg == null ? '' : String(msg);
        tr.appendChild(td);
        tbody.appendChild(tr);
    },

    boxMsg(container, msg, variant = 'info') {
        if (!container) return;
        container.replaceChildren();
        const div = document.createElement('div');
        div.className = `bd-box-msg bd-box-msg--${variant}`;
        div.textContent = msg == null ? '' : String(msg);
        container.appendChild(div);
    }
};

const normalizeReasons = (app) => {
    const reasons = Array.isArray(app?.riskReasons) ? app.riskReasons : [];
    if (reasons.length) {
        return reasons.map(r => {
            const title = r?.title || r?.code || '탐지 근거';
            const detail = r?.detail || r?.description || '';
            const sev = String(r?.severity || '').toUpperCase();
            return { title, detail, sev };
        });
    }
    // fallback: reason 문자열을 하나의 근거로 노출
    const fallback = app?.reason ? String(app.reason) : '';
    return fallback ? [{ title: '탐지 근거', detail: fallback, sev: 'HIGH' }] : [];
};

const sevLabel = (sev) => {
    const s = String(sev || '').toUpperCase();
    return (s === 'HIGH') ? '높음' : (s === 'MEDIUM' ? '중간' : '참고');
};

/**
 * 요약 탭: 스파이앱 탐지 근거 리스트 렌더
 * - 기존 innerHTML 템플릿을 DOM 생성 방식으로 교체
 */
export function renderSuspiciousListView({ suspiciousApps, isIos = false, Utils } = {}) {
    const container = document.getElementById('spyware-detail-container') || document.getElementById('suspicious-list-container');
    if (!container) return;

    const list = Array.isArray(suspiciousApps) ? suspiciousApps.slice() : [];
    BD_DOM.clear(container);

    if (list.length === 0) {
        const safeMessage = isIos
            ? '정밀 분석 결과, 알려진 스파이웨어 흔적이 발견되지 않았습니다.'
            : '정밀 분석 결과, 스파이앱으로 확정된 항목이 없습니다.';

        const wrap = BD_DOM.el('div', { className: 'empty-soft scs-1ca3ba3c' },
            BD_DOM.el('div', { className: 'scs-568eaa97' }, '✅'),
            BD_DOM.el('div', { className: 'scs-8e18acb2' }, '안전함 (Clean)'),
            BD_DOM.el('div', { className: 'scs-6503d6d6' }, safeMessage),
        );

        container.appendChild(wrap);
        return;
    }

    const listWrap = BD_DOM.el('div', { className: 'evidence-list scs-1be5ad5c' });
    container.appendChild(listWrap);

    // 권장 조치 (공통 안내)
    const actionChipsWrap = BD_DOM.el('div', { className: 'scs-4b8a213c' },
        BD_DOM.el('span', { className: 'scs-31de4950' }, '🛡️ 권한 무력화'),
        BD_DOM.el('span', { className: 'scs-31de4950' }, '🗑️ 강제 삭제'),
    );

    const actionHelp = BD_DOM.el('div', { className: 'scs-06b90fa5' });
    actionHelp.appendChild(BD_DOM.el('b', {}, '증거 보존을 원하신다면'));
    actionHelp.appendChild(document.createTextNode(' 우선 '));
    actionHelp.appendChild(BD_DOM.el('b', {}, '권한을 무력화'));
    actionHelp.appendChild(document.createTextNode('하여 증거를 보존하세요. 핵심 권한이 차단되면 스파이앱은 실질적인 활동을 수행하기 어렵습니다.'));
    actionHelp.appendChild(BD_DOM.el('br'));
    actionHelp.appendChild(BD_DOM.el('b', {}, '강제 삭제'));
    actionHelp.appendChild(document.createTextNode('는 증거 보존에는 불리할 수 있지만, 보고서(PDF)가 출력되므로 "찝찝함"을 해소하려면 삭제가 가장 확실한 방법입니다.'));

    list.forEach((app) => {
        const name = app?.cachedTitle
            || (Utils?.formatAppName ? Utils.formatAppName(app?.packageName) : null)
            || (app?.packageName || 'Unknown');

        const pkg = app?.packageName || app?.bundleId || '-';
        const narration = app?.aiNarration || app?.ai || app?.reason || '';
        const reasons = normalizeReasons(app);

        const details = BD_DOM.el('details', { className: 'evidence-item scs-840eea4c' });
        details.open = true;

        const summary = BD_DOM.el('summary', { className: 'scs-172f5022' },
            BD_DOM.el('div', { className: 'scs-088b1b25' },
                '🚨 ',
                String(name),
                ' ',
                BD_DOM.el('span', { className: 'scs-275677d5' }, `(${pkg})`)
            ),
            BD_DOM.el('span', { className: 'scs-b169df12' }, '최종 확정')
        );
        details.appendChild(summary);

        if (narration) {
            const narr = BD_DOM.el('div', { className: 'scs-df496d2a' },
                BD_DOM.el('b', {}, 'BD_SFA 해석'),
                BD_DOM.el('br'),
                String(narration),
            );
            details.appendChild(narr);
        }

        if (reasons.length) {
            const reasonsBox = BD_DOM.el('div', { className: 'scs-5371db16' },
                BD_DOM.el('div', { className: 'scs-481a87d1' }, '🤖 탐지 근거'),
            );

            const listBox = BD_DOM.el('div', { className: 'scs-5ba2fd66' });

            reasons.slice(0, 10).forEach((r) => {
                const row = BD_DOM.el('div', { className: 'scs-c2a105f8' });

                const head = BD_DOM.el('div', { className: 'scs-d03ad3be' },
                    BD_DOM.el('div', { className: 'scs-9e326a8b' }, r.title || '탐지 근거'),
                    BD_DOM.el('span', { className: 'scs-e2f81c9f' }, sevLabel(r.sev)),
                );

                row.appendChild(head);

                if (r.detail) {
                    row.appendChild(BD_DOM.el('div', { className: 'scs-59def752' }, String(r.detail)));
                }

                listBox.appendChild(row);
            });

            reasonsBox.appendChild(listBox);
            details.appendChild(reasonsBox);
        }

        // Recommended actions
        const actionBox = BD_DOM.el('div', { className: 'scs-002535c2' },
            BD_DOM.el('div', { className: 'scs-9e326a8b' }, '✅ 권장 조치'),
            actionChipsWrap.cloneNode(true),
            actionHelp.cloneNode(true),
        );
        details.appendChild(actionBox);

        listWrap.appendChild(details);
    });
}
