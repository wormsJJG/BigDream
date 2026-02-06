// Auto-split module: appDetail

import { Utils } from '../core/utils.js';
export function initAppDetail(ctx) {
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
                    iconWrapper.innerHTML = '';
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
                const allLabels = Array.from(document.querySelectorAll('#app-detail-view .d-label'));
                const bgLabel = allLabels.find(el => el.textContent.includes("실행 상태") || el.textContent.includes("설치 일시"));
                const netLabel = allLabels.find(el => el.textContent.includes("데이터 사용량") || el.textContent.includes("파일 크기"));
    
                // 3. [분기 로직]발견된 설치 파일(APK) vs 일반 앱
                if (app.isApkFile) {
    
                    if (bgLabel) bgLabel.textContent = "저장 일시";
                    if (netLabel) netLabel.textContent = "파일 크기";
    
                    if (sideloadEl) {
                        sideloadEl.innerHTML = `외부 설치 (미설치 파일)<br><span style="font-size:11px; color:#888; font-family:monospace; word-break:break-all;">${app.apkPath || '-'}</span>`;
                    }
                    if (bgStatusEl) {
                        bgStatusEl.innerHTML = `${app.installDate || '-'}<br><span style="font-size:11px; color:#d9534f;">(기기 내 파일 저장 시점)</span>`;
                    }
                    if (networkEl) {
                        networkEl.innerHTML = `${app.fileSize || '분석 중'}<br><span style="font-size:11px; color:#888;">(APK 패키지 용량)</span>`;
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
                        sideloadEl.innerHTML = `<span style="font-weight: bold; color: #333;">${originValue}</span>`;
                    }
                    if (bgStatusEl) {
                        bgStatusEl.textContent = app.isRunningBg ? '실행 중' : '중지됨';
                    }
                    if (networkEl) {
                        const usage = app.dataUsage || { rx: 0, tx: 0 };
                        const total = usage.rx + usage.tx;
                        networkEl.innerHTML = `총 ${Utils.formatBytes(total)}<br><span style="font-size:12px; color:#888;">(수신: ${Utils.formatBytes(usage.rx)} / 송신: ${Utils.formatBytes(usage.tx)})</span>`;
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
    
                // 5. 아이콘 처리
                if (iconWrapper) {
                    const iconSrc = app.reason
                        ? './assets/SpyAppLogo.png'
                        : (app.cachedIconUrl || './assets/systemAppLogo.png');
    
                    if (app.reason) {
                        iconWrapper.classList.add('suspicious');
                    }
    
                    // 데이터 세팅 완료 후 이미지 삽입
                    iconWrapper.innerHTML = `<img src="${iconSrc}" style="width:100%; height:100%; object-fit:cover; border-radius: 12px;">`;
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
                    list.innerHTML = '';
                    const perms = app.requestedList || app.permissions || [];
                    if (perms.length > 0) {
                        perms.forEach(perm => {
                            const spanElem = document.createElement('span');
                            if (app.isApkFile) {
                                // APK용 분석 모드 스타일
                                spanElem.className = 'perm-item';
                                spanElem.style.cssText = "background:#fff3e0; border:1px solid #ffe0b2; color:#e65100; padding:4px 8px; border-radius:4px; margin:2px; display:inline-block;";
                                spanElem.textContent = "🔍 " + Utils.getKoreanPermission(perm);
                            } else {
                                // 일반 앱용 설치 모드 스타일
                                const isGranted = app.grantedList && app.grantedList.includes(perm);
                                spanElem.className = `perm-item ${isGranted ? 'perm-granted' : 'perm-denied'}`;
                                spanElem.textContent = (isGranted ? '✅ ' : '🚫 ') + Utils.getKoreanPermission(perm);
                            }
                            list.appendChild(spanElem);
                        });
                    } else {
                        list.innerHTML = '<p style="color:#999; padding:5px;">분석된 권한 정보가 없습니다.</p>';
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