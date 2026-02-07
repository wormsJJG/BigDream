// src/renderer/core/viewManager.js

export function createViewManager(State) {
    return {
        // 큰 뷰 전환 (로그인 전/후)
        showView(viewId) {
            document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
            const viewToShow = document.getElementById(viewId);
            if (viewToShow) viewToShow.classList.add('active');
        },

        // 내부 스크린 전환 (로그인 후 콘텐츠)
        showScreen(parentView, screenId) {
            if (!parentView) return;

            const allScreens = [
                'create-scan-screen',
                'device-connection-screen',
                'open-scan-screen',
                'scan-progress-screen',
                'scan-results-screen',
                'admin-screen',
                'admin-report-detail-screen',
                'app-detail-view',
            ];

            allScreens.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.classList.remove('active');
                    el.classList.add('hidden');
                    el.style.display = 'none';
                }
            });

            const screenToShow = document.getElementById(screenId);
            if (screenToShow) {
                screenToShow.classList.remove('hidden');
                screenToShow.classList.add('active');
                screenToShow.style.display = 'block';
            }

            const subMenu = document.getElementById('result-sub-menu');
            const iosSubMenu = document.getElementById('ios-sub-menu');
            const navCreate = document.getElementById('nav-create');
            const navOpen = document.getElementById('nav-open');
            const isIos = State.currentDeviceMode === 'ios';

            const shouldShowResultMenu = (
                screenId === 'scan-results-screen' ||
                screenId === 'app-detail-view' ||
                screenId === 'res-privacy' ||
                (window.lastScanData && screenId === 'admin-screen')
            );

            console.log("📍 [Debug] 최종 판단 - shouldShowResultMenu:", shouldShowResultMenu);

            if (shouldShowResultMenu) {
                if (isIos) {
                    if (subMenu) subMenu.style.setProperty('display', 'none', 'important');
                    if (iosSubMenu) {
                        iosSubMenu.classList.remove('hidden');
                        iosSubMenu.style.setProperty('display', 'block', 'important');
                    }
                } else {
                    if (iosSubMenu) iosSubMenu.style.setProperty('display', 'none', 'important');
                    if (subMenu) {
                        subMenu.classList.remove('hidden');
                        subMenu.style.setProperty('display', 'block', 'important');

                        const tabs = subMenu.querySelectorAll('li.res-tab');
                        tabs.forEach(tab => {
                            const target = tab.dataset.target;
                            if (target === 'res-network' || target === 'res-threats') {
                                tab.style.setProperty('display', 'none', 'important');
                            } else {
                                tab.style.setProperty('display', 'block', 'important');
                            }
                        });
                    }
                }

                if (navCreate) navCreate.style.display = 'none';
                if (navOpen) navOpen.style.display = 'none';

            } else {
                if (subMenu) {
                    subMenu.classList.add('hidden');
                    subMenu.style.setProperty('display', 'none', 'important');
                }
                if (iosSubMenu) {
                    iosSubMenu.classList.add('hidden');
                    iosSubMenu.style.setProperty('display', 'none', 'important');
                }
                if (navCreate) navCreate.style.display = 'block';
                if (navOpen) navOpen.style.display = 'block';
            }

            const privacyNotice = document.getElementById('privacy-footer-notice');
            if (privacyNotice) {
                const allowedScreens = [
                    'create-scan-screen',
                    'device-connection-screen',
                    'scan-progress-screen',
                    'scan-results-screen',
                    'res-summary',
                    'res-apps',
                    'res-background',
                    'res-apk',
                    'res-privacy',
                    'res-threats',

                    // iOS 분리 메뉴
                    'res-ios-web',
                    'res-ios-messages',
                    'res-ios-system',
                    'res-ios-appsprofiles',
                    'res-ios-artifacts'
                ];
                privacyNotice.style.display = allowedScreens.includes(screenId) ? 'block' : 'none';
            }
        },

        activateMenu(targetId) {
            document.querySelectorAll('#logged-in-view .nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const target = document.getElementById(targetId);
            if (target) {
                target.classList.add('active');
                console.log(`메뉴 활성화됨: ${targetId}`);
            }
        },

        updateProgress(percent, text) {
            const statusBar = document.getElementById('progress-bar');
            const statusText = document.getElementById('scan-status-text');
            if (statusBar) statusBar.style.width = `${percent}%`;
            if (statusText) statusText.textContent = text;
            if (statusBar) statusBar.style.backgroundColor = '#5CB85C';
        }
    };
}
