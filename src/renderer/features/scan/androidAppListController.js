export function createAndroidAppListController({ State, Utils, clear, showAppDetail, getAppData }) {
    const elementCache = new WeakMap();
    const fetchPromiseCache = new WeakMap();
    const indexCache = new WeakMap();
    const getElementBucket = (app) => {
        if (!app || typeof app !== 'object')
            return null;
        let bucket = elementCache.get(app);
        if (!bucket) {
            bucket = new Map();
            elementCache.set(app, bucket);
        }
        return bucket;
    };
    const createAppIcon = (app, container, listKey = 'installed') => {
        if (!app || typeof app !== 'object' || !container)
            return;
        const div = document.createElement('div');
        const elementBucket = getElementBucket(app);
        const cachedEl = elementBucket?.get(listKey);
        if (cachedEl && typeof cachedEl === 'object' && cachedEl.nodeType === 1) {
            container.appendChild(cachedEl);
            return;
        }
        else if (cachedEl) {
            try {
                elementBucket?.delete(listKey);
            }
            catch (_) { /* noop */ }
        }
        const packageName = String(app.packageName || '');
        const initialName = app.cachedTitle || Utils.formatAppName(packageName);
        div.innerHTML = `
                    <div class="app-icon-wrapper">
                        <img src="" class="app-real-icon scs-cb458930" alt="${initialName}">
                        <span class="app-fallback-icon scs-412ba910">📱</span>
                    </div>
                    <div class="app-display-name">${initialName}</div>
                `;
        const imgTag = div.querySelector('.app-real-icon');
        const spanTag = div.querySelector('.app-fallback-icon');
        if (!imgTag || !spanTag)
            return;
        const reasonStr = String(app?.reason || '');
        const verdictStr = String(app?.finalVerdict || app?.verdict || '').toUpperCase();
        const riskLevelStr = String(app?.riskLevel || '').toUpperCase();
        const isSpyApp = (app?.isSpyware === true ||
            verdictStr.includes('SPY') ||
            verdictStr.includes('MAL') ||
            reasonStr.includes('[최종 필터 확진]') ||
            (reasonStr.includes('스파이') && !reasonStr.includes('개인정보')));
        const isPrivacyRisk = (app?.isPrivacyRisk === true ||
            riskLevelStr.includes('PRIVACY') ||
            reasonStr.includes('[개인정보') ||
            reasonStr.includes('개인정보 유출'));
        let riskClass = '';
        if (isSpyApp)
            riskClass = 'suspicious';
        else if (isPrivacyRisk)
            riskClass = 'warning';
        div.className = `app-item ${riskClass}`;
        const getLocalIconPath = () => {
            if (isSpyApp)
                return './assets/SpyAppLogo.png';
            return './assets/systemAppLogo.png';
        };
        const handleImageError = (isLocalFallback = false) => {
            if (!imgTag || !spanTag)
                return;
            if (isLocalFallback) {
                imgTag.style.display = 'none';
                spanTag.style.display = 'flex';
                return;
            }
            const localPath = getLocalIconPath();
            if (localPath) {
                imgTag.src = localPath;
                imgTag.style.display = 'block';
                spanTag.style.display = 'none';
                imgTag.onerror = () => handleImageError(true);
            }
            else {
                handleImageError(true);
            }
        };
        imgTag.onerror = () => handleImageError(false);
        if (app.cachedIconUrl) {
            imgTag.src = app.cachedIconUrl;
            imgTag.style.display = 'block';
            spanTag.style.display = 'none';
        }
        else if (!app.cachedIconUrl || !app.cachedTitle) {
            const ensureAppData = () => {
                const cachedPromise = fetchPromiseCache.get(app);
                if (cachedPromise)
                    return cachedPromise;
                const promise = getAppData(packageName);
                fetchPromiseCache.set(app, promise);
                return promise;
            };
            ensureAppData().then(result => {
                if (!result) {
                    handleImageError(false);
                    return;
                }
                if (result.icon) {
                    app.cachedIconUrl = result.icon;
                    imgTag.src = result.icon;
                    imgTag.onload = () => {
                        imgTag.style.display = 'block';
                        spanTag.style.display = 'none';
                    };
                }
                else {
                    handleImageError(false);
                }
                if (result.title) {
                    app.cachedTitle = result.title;
                    const nameEl = div.querySelector('.app-display-name');
                    if (nameEl)
                        nameEl.textContent = result.title;
                }
            }).catch(() => {
                handleImageError(false);
            });
        }
        div.addEventListener('click', () => {
            const nameEl = div.querySelector('.app-display-name');
            showAppDetail(app, String(nameEl?.textContent || ''));
        });
        elementBucket?.set(listKey, div);
        container.appendChild(div);
    };
    const initAndroidAppListControls = (allAndroidApps) => {
        if (Array.isArray(State.scanRuntime?.androidListCleanup)) {
            State.scanRuntime.androidListCleanup.forEach(fn => {
                try {
                    fn?.();
                }
                catch (_e) { /* noop */ }
            });
        }
        State.scanRuntime.androidListCleanup = [];
        const appGrid = document.getElementById('app-grid-container');
        const bgGrid = document.getElementById('bg-app-grid-container');
        const appsSearch = document.getElementById('apps-search');
        const appsSort = document.getElementById('apps-sort');
        const bgSearch = document.getElementById('bg-search');
        const bgSort = document.getElementById('bg-sort');
        if (!appGrid || !appsSearch || !appsSort)
            return;
        const baseAll = (Array.isArray(allAndroidApps) ? allAndroidApps : []).filter((app) => app && typeof app === 'object');
        const baseBg = baseAll.filter(a => a && a.isRunningBg);
        baseAll.forEach((app, i) => {
            if (app && !indexCache.has(app))
                indexCache.set(app, i);
        });
        const getName = (app) => {
            const name = app?.cachedTitle || Utils.formatAppName(app?.packageName || '');
            return String(name || '');
        };
        const getPkg = (app) => String(app?.packageName || '');
        const getPermCount = (app) => {
            const req = Array.isArray(app?.requestedList) ? app.requestedList : [];
            const grt = Array.isArray(app?.grantedList) ? app.grantedList : [];
            return new Set([...req, ...grt]).size;
        };
        const compare = (sortKey) => (a, b) => {
            const ai = indexCache.get(a) ?? 0;
            const bi = indexCache.get(b) ?? 0;
            if (sortKey === 'permDesc' || sortKey === 'permAsc') {
                const ap = getPermCount(a);
                const bp = getPermCount(b);
                const diff = sortKey === 'permDesc' ? (bp - ap) : (ap - bp);
                if (diff !== 0)
                    return diff;
                const n = getName(a).localeCompare(getName(b));
                if (n !== 0)
                    return n;
                const p = getPkg(a).localeCompare(getPkg(b));
                if (p !== 0)
                    return p;
                return ai - bi;
            }
            if (sortKey === 'nameAsc') {
                const n = getName(a).localeCompare(getName(b));
                if (n !== 0)
                    return n;
                const p = getPkg(a).localeCompare(getPkg(b));
                if (p !== 0)
                    return p;
                return ai - bi;
            }
            const p = getPkg(a).localeCompare(getPkg(b));
            if (p !== 0)
                return p;
            const n = getName(a).localeCompare(getName(b));
            if (n !== 0)
                return n;
            return ai - bi;
        };
        const renderList = ({ base, container, listKey, query, sortKey, emptyMessage }) => {
            const q = String(query || '').trim().toLowerCase();
            const filtered = q.length === 0
                ? base
                : base.filter(app => getName(app).toLowerCase().includes(q));
            const sorted = [...filtered].sort(compare(sortKey || 'permDesc'));
            clear(container);
            if (sorted.length === 0) {
                container.innerHTML = `<p class="scs-8a8fe311">${emptyMessage}</p>`;
                return;
            }
            sorted.forEach(app => {
                const el = app ? elementCache.get(app)?.get(listKey) : null;
                if (el)
                    container.appendChild(el);
            });
        };
        const bind = ({ inputEl, selectEl, container, base, listKey, emptyMessage }) => {
            if (!inputEl || !selectEl || !container)
                return;
            const apply = () => renderList({
                base,
                container,
                listKey,
                query: inputEl.value,
                sortKey: selectEl.value,
                emptyMessage
            });
            const onInput = () => apply();
            const onChange = () => apply();
            inputEl.addEventListener('input', onInput);
            selectEl.addEventListener('change', onChange);
            State.scanRuntime.androidListCleanup.push(() => inputEl.removeEventListener('input', onInput));
            State.scanRuntime.androidListCleanup.push(() => selectEl.removeEventListener('change', onChange));
            apply();
        };
        bind({
            inputEl: appsSearch,
            selectEl: appsSort,
            container: appGrid,
            base: baseAll,
            listKey: 'installed',
            emptyMessage: '검색 결과가 없습니다.'
        });
        if (bgGrid && bgSearch && bgSort) {
            bind({
                inputEl: bgSearch,
                selectEl: bgSort,
                container: bgGrid,
                base: baseBg,
                listKey: 'bg',
                emptyMessage: '검색 결과가 없습니다.'
            });
        }
    };
    return {
        createAppIcon,
        initAndroidAppListControls
    };
}
