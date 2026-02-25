// Auto-split module: appDetail

import { Utils } from '../core/utils.js';
export function initAppDetail(ctx) {
    
    // --- Renderer helpers (avoid innerHTML for dynamic text) ---
    const setMainSubText = (el, mainText, subText = '', subClass = 'bd-detail-sub') => {
        if (!el) return;
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
const { State, ViewManager, CustomUI, dom, services, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    // Role-separated deps
    // (이 모듈은 auth를 직접 사용하지 않으므로 authService만 보관)
    const authService = services.auth;
    const { doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where, runTransaction, addDoc, serverTimestamp, deleteDoc, increment, limit } = services.firestore;

        // [8] 앱 상세 화면 (APP DETAIL MANAGER)
        // =========================================================
        const AppDetailManager = {
            lastScrollY: 0,
    
            show(app, displayName) {
                console.log("상세 정보 표시 실행:", displayName, "유형:", app.isApkFile ? "APK" : "설치됨");
    
                const iconWrapper = document.querySelector('.detail-icon-wrapper');
    
                if (iconWrapper) {
                    iconWrapper.classList.remove('suspicious');
                    iconWrapper.replaceChildren();
                }
    
                // 1. 화면 전환 로직
                const dashboard = document.getElementById('results-dashboard-view');
                const detailView = document.getElementById('app-detail-view');
                const resultsHeader = document.querySelector('.results-header');
                const privacyNotice = document.getElementById('privacy-footer-notice');
                const scrollContainer = document.querySelector('#logged-in-view .main-content');
    
                if (dashboard && detailView) {
                    this.lastScrollY = scrollContainer ? scrollContainer.scrollTop : 0;
                    dashboard.style.display = 'none';
                    if (resultsHeader) resultsHeader.style.display = 'none';
                    if (privacyNotice) privacyNotice.style.display = 'none';
    
                    detailView.classList.remove('hidden');
                    detailView.style.display = 'block';
                    if (scrollContainer) scrollContainer.scrollTop = 0;
                }
    
                // 2. 엘리먼트 참조
                document.getElementById('detail-app-name').textContent = app.cachedTitle || displayName;
                document.getElementById('detail-package-name').textContent = app.packageName;
    
                const sideloadEl = document.getElementById('detail-sideload');
                const bgStatusEl = document.getElementById('detail-bg');
                const networkEl = document.getElementById('detail-network');
                const neutralizeBtnEl = document.getElementById('neutralize-btn');
                const uninstallBtnEl = document.getElementById('uninstall-btn');
    
                // 라벨 제어 핵심
                // NOTE:
                //  - APK 상세에서 '저장 일시'로 라벨 텍스트가 바뀐 뒤,
                //    다시 설치된 앱/백그라운드 앱 상세로 들어오면 기존 구현(텍스트 includes 기반)은
                //    라벨을 못 찾아 '저장 일시'가 그대로 남는 버그가 발생했음.
                //  - 라벨은 DOM 구조상 항상 동일한 위치(2번째/3번째 detail-item)이므로,
                //    텍스트 기반 탐색을 제거하고 구조 기반으로 안정적으로 참조한다.
                const detailItems = Array.from(document.querySelectorAll('#app-detail-view .detail-item'));
                const bgLabel = detailItems?.[1]?.querySelector('.d-label') || null;
                const netLabel = detailItems?.[2]?.querySelector('.d-label') || null;
    
                // 3. [분기 로직]발견된 설치 파일(APK) vs 일반 앱
                if (app.isApkFile) {
    
                    if (bgLabel) bgLabel.textContent = "저장 일시";
                    if (netLabel) netLabel.textContent = "설치 유무";
    
                    if (sideloadEl) {
                        setMainSubText(sideloadEl, '외부 설치', app.apkPath || '-', 'bd-detail-sub bd-detail-sub--mono bd-break-all');
                    }
                    if (bgStatusEl) {
                        setMainSubText(bgStatusEl, app.installDate || '-', '(기기 내 파일 저장 시점)', 'bd-detail-sub bd-detail-sub--danger');
                    }
                    if (networkEl) {
                        setMainSubText(networkEl, app.installStatus || (app.isInstalled ? '설치된 파일' : '미설치 파일'), '', 'bd-detail-sub');
                    }
    
                    if (neutralizeBtnEl) neutralizeBtnEl.style.setProperty('display', 'none', 'important');
                    if (uninstallBtnEl) {
                        uninstallBtnEl.style.display = 'flex';
                        uninstallBtnEl.textContent = "🗑️ APK 파일 영구 삭제";
                    }
    
                    document.getElementById('detail-req-count').textContent = (app.requestedList || app.permissions || []).length;
                    document.getElementById('detail-grant-count').textContent = "-";
    
                } else {
                    // --- B. 일반 앱 (설치된 앱) 상세 설정 ---
                    if (bgLabel) bgLabel.textContent = "실행 상태";
                    if (netLabel) netLabel.textContent = "데이터 사용량";
    
                    if (sideloadEl) {
                        const originValue = app.origin || (app.isSideloaded ? '외부 설치' : '공식 스토어');
                        if (sideloadEl) { sideloadEl.textContent = originValue; sideloadEl.classList.add('bd-fw-bold'); }
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
                        neutralizeBtnEl.textContent = "🛡️ 무력화 (권한 박탈)";
                    }
                    if (uninstallBtnEl) {
                        uninstallBtnEl.style.display = 'flex';
                        uninstallBtnEl.textContent = "🗑️ 앱 강제 삭제";
                    }
    
                    document.getElementById('detail-req-count').textContent = app.requestedCount || 0;
                    document.getElementById('detail-grant-count').textContent = app.grantedCount || 0;
                }
    
                // 4. 공통 데이터셋 설정
                [neutralizeBtnEl, uninstallBtnEl].forEach(btn => {
                    if (btn) {
                        btn.dataset.package = app.packageName;
                        btn.dataset.appName = displayName;
                        btn.dataset.apkPath = app.apkPath || "";
                        btn.disabled = false;
                    }
                });
    
                // 5. 아이콘 처리 (스파이앱=빨간, 개인정보 유출 위협=노란)
                if (iconWrapper) {
                    // 기존 클래스 초기화
                    iconWrapper.classList.remove('suspicious', 'warning');

                    const reasonStr = String(app?.reason || '');
                    const verdictStr = String(app?.finalVerdict || app?.verdict || '').toUpperCase();
                    const riskLevelStr = String(app?.riskLevel || '').toUpperCase();

                    const isPrivacyRisk = (
                        riskLevelStr.includes('PRIVACY') ||
                        reasonStr.includes('[개인정보 유출 위협]') ||
                        reasonStr.includes('개인정보 유출')
                    );

                    const isSpyware = (
                        verdictStr.includes('SPY') ||
                        app?.isSpyware === true ||
                        reasonStr.includes('[최종 필터 확진]') ||
                        (reasonStr.includes('스파이') && !isPrivacyRisk)
                    );

                    // 스파이앱이면 전용 로고 + 빨간 강조, 개인정보 위험이면 노란 강조
                    const iconSrc = isSpyware
                        ? './assets/SpyAppLogo.png'
                        : (app?.cachedIconUrl || './assets/systemAppLogo.png');

                    if (isSpyware) iconWrapper.classList.add('suspicious');
                    else if (isPrivacyRisk) iconWrapper.classList.add('warning');

                    // 데이터 세팅 완료 후 이미지 삽입
                    iconWrapper.replaceChildren(); const img=document.createElement('img'); img.src=iconSrc; img.className='bd-icon-img'; iconWrapper.appendChild(img);
                }
    
                const totalPermsArr = app.requestedList || app.permissions || [];
                const totalCount = totalPermsArr.length;
                const grantedCount = (app.grantedList || []).length;
    
                const reqCountEl = document.getElementById('detail-req-count');
                const grantCountEl = document.getElementById('detail-grant-count');
    
                if (reqCountEl) reqCountEl.textContent = totalCount;
                if (grantCountEl) {
                    grantCountEl.textContent = app.isApkFile ? "-" : grantedCount;
                }
    
                // 6. 권한 리스트 렌더링
                const list = document.getElementById('detail-permission-list');
                if (list) {
                    list.replaceChildren();
                    const perms = app.requestedList || app.permissions || [];
                    if (perms.length > 0) {
                        // perms.forEach(perm => {
                        //     const spanElem = document.createElement('span');
                        //     if (app.isApkFile) {
                        //         // APK용 분석 모드 스타일
                        //         spanElem.className = 'perm-item perm-apk';
                        //         spanElem.textContent = "🔍 " + Utils.getKoreanPermission(perm);
                        //     } else {
                        //         // 일반 앱용 설치 모드 스타일
                        //         const isGranted = app.grantedList && app.grantedList.includes(perm);
                        //         spanElem.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                        //         spanElem.textContent = (isGranted ? '✅ ' : '🚫 ') + Utils.getKoreanPermission(perm);
                        //     }
                        //     list.appendChild(spanElem);
                        // });
                        const grantedSet = new Set(app.grantedList || []);

                        if (app.isApkFile) {
                            Utils.renderPermissionCategoriesReadOnly(perms, list, {
                                mode: 'apk',
                                getLabel: (p) => Utils.getKoreanPermission(p),
                            });
                        } else {
                            Utils.renderPermissionCategoriesReadOnly(perms, list, {
                                mode: 'installed',
                                grantedSet,
                                getLabel: (p) => Utils.getKoreanPermission(p),
                            });
                        }
                    } else {
                        const p=document.createElement('p'); p.className='bd-muted bd-pad-5'; p.textContent='분석된 권한 정보가 없습니다.'; list.appendChild(p);
                    }
                }
    
                document.getElementById('app-detail-view').scrollTo({ top: 0 });
            },
    
            setupActionButton(btnId, text, app, appName) {
                const btn = document.getElementById(btnId);
                if (btn) {
                    btn.dataset.package = app.packageName;
                    btn.dataset.appName = appName;
                    btn.dataset.apkPath = app.apkPath; // 파일 삭제 시 필요
                    btn.disabled = false;
                    btn.textContent = text;
                }
            }
        };
        // Expose manager as a shared service for other modules (e.g., scanController)
        if (ctx.services) {
            ctx.services.appDetailManager = AppDetailManager;
        }
        globalThis.AppDetailManager = AppDetailManager;

    
        // 뒤로가기 버튼
        document.getElementById('back-to-dashboard-btn')?.addEventListener('click', () => {
            const dashboard = document.getElementById('results-dashboard-view');
            const detailView = document.getElementById('app-detail-view');
            const resultsHeader = document.querySelector('.results-header');
            const privacyNotice = document.getElementById('privacy-footer-notice');
    
            // 1. 상세 보기 화면 숨김
            if (detailView) {
                detailView.classList.add('hidden');
                detailView.style.display = 'none';
            }
    
            // 2. 메인 결과 대시보드 다시 켜기 
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
    
            // 3. 이전 스크롤 위치로 복구
            const scrollContainer = document.querySelector('#logged-in-view .main-content');
            if (scrollContainer) {
                scrollContainer.scrollTo(0, AppDetailManager.lastScrollY);
            }
        });
    
        // =========================================================
}