// Synced from TypeScript preview output. Source of truth: initAppDetail.ts
import { Utils } from '../../shared/utils.actual.js';
export function initAppDetail(ctx) {
    const setMainSubText = (el, mainText, subText = '', subClass = 'bd-detail-sub') => {
        if (!el)
            return;
        el.replaceChildren();
        const main = document.createTextNode(String(mainText ?? ''));
        el.appendChild(main);
        if (subText) {
            el.appendChild(document.createElement('br'));
            const span = document.createElement('span');
            span.className = subClass;
            span.textContent = String(subText ?? '');
            el.appendChild(span);
        }
    };
    const AppDetailManager = {
        lastScrollY: 0,
        show(app, displayName) {
            console.log('상세 정보 표시 실행:', displayName, '유형:', app.isApkFile ? 'APK' : '설치됨');
            const iconWrapper = document.querySelector('.detail-icon-wrapper');
            if (iconWrapper) {
                iconWrapper.classList.remove('suspicious');
                iconWrapper.replaceChildren();
            }
            const dashboard = document.getElementById('results-dashboard-view');
            const detailView = document.getElementById('app-detail-view');
            const resultsHeader = document.querySelector('.results-header');
            const privacyNotice = document.getElementById('privacy-footer-notice');
            const scrollContainer = document.querySelector('#logged-in-view .main-content');
            if (dashboard && detailView) {
                this.lastScrollY = scrollContainer ? scrollContainer.scrollTop : 0;
                dashboard.style.display = 'none';
                if (resultsHeader)
                    resultsHeader.style.display = 'none';
                if (privacyNotice)
                    privacyNotice.style.display = 'none';
                detailView.classList.remove('hidden');
                detailView.style.display = 'block';
                if (scrollContainer)
                    scrollContainer.scrollTop = 0;
            }
            const appNameEl = document.getElementById('detail-app-name');
            const packageEl = document.getElementById('detail-package-name');
            if (appNameEl)
                appNameEl.textContent = app.cachedTitle || displayName;
            if (packageEl)
                packageEl.textContent = app.packageName || '';
            const sideloadEl = document.getElementById('detail-sideload');
            const bgStatusEl = document.getElementById('detail-bg');
            const networkEl = document.getElementById('detail-network');
            const neutralizeBtnEl = document.getElementById('neutralize-btn');
            const uninstallBtnEl = document.getElementById('uninstall-btn');
            const detailItems = Array.from(document.querySelectorAll('#app-detail-view .detail-item'));
            const bgLabel = detailItems?.[1]?.querySelector('.d-label');
            const netLabel = detailItems?.[2]?.querySelector('.d-label');
            if (app.isApkFile) {
                if (bgLabel)
                    bgLabel.textContent = '저장 일시';
                if (netLabel)
                    netLabel.textContent = '설치 유무';
                if (sideloadEl) {
                    setMainSubText(sideloadEl, '외부 설치', app.apkPath || '-', 'bd-detail-sub bd-detail-sub--mono bd-break-all');
                }
                if (bgStatusEl) {
                    setMainSubText(bgStatusEl, app.installDate || '-', '(기기 내 파일 저장 시점)', 'bd-detail-sub bd-detail-sub--danger');
                }
                if (networkEl) {
                    setMainSubText(networkEl, app.installStatus || (app.isInstalled ? '설치된 파일' : '미설치 파일'), '', 'bd-detail-sub');
                }
                if (neutralizeBtnEl)
                    neutralizeBtnEl.style.setProperty('display', 'none', 'important');
                if (uninstallBtnEl) {
                    uninstallBtnEl.style.display = 'flex';
                    uninstallBtnEl.textContent = '🗑️ APK 파일 영구 삭제';
                }
                const reqEl = document.getElementById('detail-req-count');
                const grantEl = document.getElementById('detail-grant-count');
                if (reqEl)
                    reqEl.textContent = String((app.requestedList || app.permissions || []).length);
                if (grantEl)
                    grantEl.textContent = '-';
            }
            else {
                if (bgLabel)
                    bgLabel.textContent = '실행 상태';
                if (netLabel)
                    netLabel.textContent = '데이터 사용량';
                if (sideloadEl) {
                    const originValue = app.origin || (app.isSideloaded ? '외부 설치' : '공식 스토어');
                    const installDateSub = (originValue === '시스템 앱' || app.isSystemApp)
                        ? ''
                        : `설치 일시: ${app.installDate || '-'}`;
                    setMainSubText(sideloadEl, originValue, installDateSub, 'bd-detail-sub bd-detail-sub--sm');
                    sideloadEl.classList.add('bd-fw-bold');
                }
                if (bgStatusEl) {
                    bgStatusEl.textContent = app.isRunningBg ? '실행 중' : '중지됨';
                }
                if (networkEl) {
                    const usage = app.dataUsage || { rx: 0, tx: 0 };
                    const total = usage.rx + usage.tx;
                    setMainSubText(networkEl, `총 ${Utils.formatBytes(total)}`, `(수신: ${Utils.formatBytes(usage.rx)} / 송신: ${Utils.formatBytes(usage.tx)})`, 'bd-detail-sub bd-detail-sub--sm');
                }
                if (neutralizeBtnEl) {
                    neutralizeBtnEl.style.display = 'flex';
                    neutralizeBtnEl.textContent = '🛡️ 무력화 (권한 박탈)';
                }
                if (uninstallBtnEl) {
                    uninstallBtnEl.style.display = 'flex';
                    uninstallBtnEl.textContent = '🗑️ 앱 강제 삭제';
                }
                const reqEl = document.getElementById('detail-req-count');
                const grantEl = document.getElementById('detail-grant-count');
                if (reqEl)
                    reqEl.textContent = String(app.requestedCount || 0);
                if (grantEl)
                    grantEl.textContent = String(app.grantedCount || 0);
            }
            [neutralizeBtnEl, uninstallBtnEl].forEach(btn => {
                if (btn) {
                    btn.dataset.package = app.packageName || '';
                    btn.dataset.appName = displayName;
                    btn.dataset.apkPath = app.apkPath || '';
                    btn.disabled = false;
                }
            });
            if (iconWrapper) {
                iconWrapper.classList.remove('suspicious', 'warning');
                const reasonStr = String(app?.reason || '');
                const verdictStr = String(app?.finalVerdict || app?.verdict || '').toUpperCase();
                const riskLevelStr = String(app?.riskLevel || '').toUpperCase();
                const isPrivacyRisk = (riskLevelStr.includes('PRIVACY') ||
                    reasonStr.includes('[개인정보 유출 위협]') ||
                    reasonStr.includes('개인정보 유출'));
                const isSpyware = (verdictStr.includes('SPY') ||
                    app?.isSpyware === true ||
                    reasonStr.includes('[최종 필터 확진]') ||
                    (reasonStr.includes('스파이') && !isPrivacyRisk));
                const iconSrc = isSpyware
                    ? './assets/SpyAppLogo.png'
                    : (app?.cachedIconUrl || './assets/systemAppLogo.png');
                if (isSpyware)
                    iconWrapper.classList.add('suspicious');
                else if (isPrivacyRisk)
                    iconWrapper.classList.add('warning');
                iconWrapper.replaceChildren();
                const img = document.createElement('img');
                img.src = iconSrc;
                img.className = 'bd-icon-img';
                iconWrapper.appendChild(img);
            }
            const totalPermsArr = app.requestedList || app.permissions || [];
            const totalCount = totalPermsArr.length;
            const grantedCount = (app.grantedList || []).length;
            const reqCountEl = document.getElementById('detail-req-count');
            const grantCountEl = document.getElementById('detail-grant-count');
            if (reqCountEl)
                reqCountEl.textContent = String(totalCount);
            if (grantCountEl) {
                grantCountEl.textContent = app.isApkFile ? '-' : String(grantedCount);
            }
            const list = document.getElementById('detail-permission-list');
            if (list) {
                list.replaceChildren();
                const perms = app.requestedList || app.permissions || [];
                if (perms.length > 0) {
                    const grantedSet = new Set(app.grantedList || []);
                    if (app.isApkFile) {
                        Utils.renderPermissionCategoriesReadOnly(perms, list, {
                            mode: 'apk',
                            getLabel: (p) => Utils.getKoreanPermission(p),
                        });
                    }
                    else {
                        Utils.renderPermissionCategoriesReadOnly(perms, list, {
                            mode: 'installed',
                            grantedSet,
                            getLabel: (p) => Utils.getKoreanPermission(p),
                        });
                    }
                }
                else {
                    const p = document.createElement('p');
                    p.className = 'bd-muted bd-pad-5';
                    p.textContent = '분석된 권한 정보가 없습니다.';
                    list.appendChild(p);
                }
            }
            document.getElementById('app-detail-view')?.scrollTo({ top: 0 });
        },
        setupActionButton(btnId, text, app, appName) {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.dataset.package = app.packageName || '';
                btn.dataset.appName = appName;
                btn.dataset.apkPath = app.apkPath || '';
                btn.disabled = false;
                btn.textContent = text;
            }
        }
    };
    ctx.services = ctx.services || {};
    ctx.services.appDetailManager = AppDetailManager;
    document.getElementById('back-to-dashboard-btn')?.addEventListener('click', () => {
        const dashboard = document.getElementById('results-dashboard-view');
        const detailView = document.getElementById('app-detail-view');
        const resultsHeader = document.querySelector('.results-header');
        const privacyNotice = document.getElementById('privacy-footer-notice');
        if (detailView) {
            detailView.classList.add('hidden');
            detailView.style.display = 'none';
        }
        if (dashboard) {
            dashboard.classList.remove('hidden');
            dashboard.style.display = 'block';
        }
        if (resultsHeader) {
            resultsHeader.style.display = 'flex';
        }
        if (privacyNotice) {
            privacyNotice.style.display = 'block';
        }
        const scrollContainer = document.querySelector('#logged-in-view .main-content');
        if (scrollContainer) {
            scrollContainer.scrollTo(0, AppDetailManager.lastScrollY);
        }
    });
}
