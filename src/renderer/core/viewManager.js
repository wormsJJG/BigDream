// src/renderer/core/viewManager.js

export function createViewManager(State) {
    // Android dashboard log de-dup (avoid repeated completion lines)
    let lastAndroidLogText = '';
    let lastAndroidLogTime = 0;

    return {
        // 큰 뷰 전환 (로그인 전/후)
        showView(viewId) {
            document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
            const viewToShow = document.getElementById(viewId);
            if (viewToShow) {
                viewToShow.classList.add('active');
            }
        },

        // 내부 스크린 전환 (로그인 후 콘텐츠)
        showScreen(parentView, screenId) {
            if (!parentView) {
                return;
            }

            const allScreens = [
                'create-scan-screen',
                'device-connection-screen',
                'open-scan-screen',
                'scan-progress-screen',
                'scan-results-screen',
                'admin-screen',
                'admin-report-detail-screen',
                'app-detail-view',
                'scan-dashboard-screen'
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

            const _mode = String(State.currentDeviceMode || '').toLowerCase();
            const isIos = _mode.includes('ios');

            // 결과 메뉴는 "결과 화면"(scan-results) 및 결과 상세(app-detail)에서만 노출
            // 스캔 진행 중 대시보드(scan-dashboard)에서는 결과 메뉴가 보이면 UX가 혼동되어 숨김 처리
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
                        
                        const isScanComplete = !!window.lastScanData;

                            const tabs = subMenu.querySelectorAll('li.res-tab');
                            tabs.forEach(tab => {
                                const target = tab.dataset.target;

                                if (target === 'scan-dashboard-screen') {
                                    tab.style.display = 'block';
                                } 
                                else {
                                    if (isScanComplete) {
                                        if (target === 'res-network' || target === 'res-threats') {
                                            tab.style.display = 'none';
                                        } else {
                                            tab.style.display = 'block';
                                        }
                                    } else {
                                        tab.style.display = 'none';
                                    }
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

        updateProgress(percent, text, isIos) {
            const statusBar = document.getElementById('progress-bar');
            const statusText = document.getElementById('scan-status-text');

            // Optional dashboard widgets
            const percentText = document.getElementById('progress-percent-text');
            const procGauge = document.getElementById('proc-gauge');
            const procVal = document.getElementById('live-proc-val');

            const androidStatusBar = document.getElementById('android-progress-bar');
            const androidStatusText = document.getElementById('android-scan-status-text');
            const androidProgressPercentText = document.getElementById('android-progress-percent-text');
            const androidRunningText = document.getElementById('android-scan-running-text');
            const logContainer = document.getElementById('log-container');

            const ensureLogScrollableWithoutScrollbar = () => {
                if (!logContainer) {
                    return;
                }

                // Enable wheel scrolling even if CSS accidentally set overflow hidden.
                logContainer.style.overflowY = 'auto';

                // Keep no visible scrollbar (design), but allow scroll.
                logContainer.style.scrollbarWidth = 'none';

                // Inject a single global rule for webkit scrollbar hiding.
                if (!document.getElementById('bd-log-scroll-hide-style')) {
                    const styleEl = document.createElement('style');
                    styleEl.id = 'bd-log-scroll-hide-style';
                    styleEl.textContent = `
                        #log-container::-webkit-scrollbar {
                            width: 0px;
                            height: 0px;
                            display: none;
                        }
                    `;
                    document.head.appendChild(styleEl);
                }
            };

            const appendAndroidLogLine = (rawText) => {
                if (!logContainer || !rawText) {
                    return;
                }

                ensureLogScrollableWithoutScrollbar();

                // Normalize timestamp to English/neutral format.
                const timeText = new Date().toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                let englishMsg = String(rawText);

                // Common Korean phrases we saw during scan -> English.
                englishMsg = englishMsg
                    .replace(/정밀\s*분석\s*중\.{0,3}/g, 'Analyzing...')
                    .replace(/분석\s*중\.{0,3}/g, 'Analyzing...')
                    .replace(/분석\s*완료!?.*/g, 'Analysis complete. Generating report...')
                    .replace(/리포트\s*생성\s*중\.{0,3}/g, 'Generating report...')
                    .replace(/검사\s*진행\s*중\.{0,3}/g, 'Scanning...');
                // Remove count tokens like "[185/328]" anywhere.
                englishMsg = englishMsg.replace(/\[\s*\d+\s*\/\s*\d+\s*\]\s*/g, '').trim();

                // Remove Korean "report generating" suffixes that should not be shown.
                englishMsg = englishMsg
                    .replace(/결과\s*리포트를\s*생성합니다\.?/g, '')
                    .replace(/리포트를\s*생성합니다\.?/g, '')
                    .replace(/결과\s*보고서를\s*생성합니다\.?/g, '')
                    .replace(/보고서를\s*생성합니다\.?/g, '')
                    .trim();

                // If the message becomes empty after filtering, skip.
                if (!englishMsg) {
                    return;
                }

                // De-dup: same log within 1200ms => skip (prevents repeated completion lines).
                const nowMs = Date.now();
                if (englishMsg === lastAndroidLogText && (nowMs - lastAndroidLogTime) < 1200) {
                    return;
                }
                lastAndroidLogText = englishMsg;
                lastAndroidLogTime = nowMs;

                const lineEl = document.createElement('div');
                lineEl.className = 'log-line';
                lineEl.textContent = `[${timeText}] ${englishMsg}`;

                // If user is already at (or near) bottom, keep following new logs automatically.
                const shouldStickToBottom =
                    (logContainer.scrollTop + logContainer.clientHeight + 24) >= logContainer.scrollHeight;

                logContainer.appendChild(lineEl);

                // Keep history but prevent unbounded growth.
                const MAX_LOG_LINES = 200;
                while (logContainer.children.length > MAX_LOG_LINES) {
                    logContainer.removeChild(logContainer.firstChild);
                }

                if (shouldStickToBottom) {
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            };

            if (isIos) {
                if (statusBar) {
                    statusBar.style.width = `${percent}%`;
                    // Keep existing green on legacy screens; new dashboard overrides via CSS
                    statusBar.style.backgroundColor = statusBar.style.backgroundColor || '#5CB85C';
                }
                if (statusText) statusText.textContent = text;
                if (percentText) percentText.textContent = `${Math.round(percent)}%`;
            } else {
                if (androidStatusBar) {
                    androidStatusBar.style.width = `${percent}%`;
                    // Keep existing green on legacy screens; new dashboard overrides via CSS
                    androidStatusBar.style.backgroundColor = androidStatusBar.style.backgroundColor || '#5CB85C';
                }

                // KPI: show only "x/y" if we can parse it. Otherwise keep current.
                if (androidStatusText) {
                    const m = String(text || '').match(/\[(\d+)\s*\/\s*(\d+)\]/);
                    if (m) {
                        androidStatusText.textContent = `${m[1]}/${m[2]}`;
                    }
                }

                if (androidProgressPercentText) {
                    androidProgressPercentText.textContent = `${Math.round(percent)}%`;
                }

                // if (procGauge) {
                //     const safePct = Math.max(0, Math.min(100, percent));
                //     // CSS 변수(--brand) 색상으로 채우기 (conic-gradient 활용)
                //     procGauge.style.background = `conic-gradient(var(--brand) 0% ${safePct}%, #1E293B ${safePct}% 100%)`;
                // }
                // if (procVal) {
                //     procVal.textContent = Math.round(percent) + '%';
                // }

                if (androidRunningText) {
                    const p = Number(percent);
                    const isDoneByPercent = Number.isFinite(p) && Math.round(p) >= 100;
                    const raw = String(text || '');
                    const isDoneByText = /analysis\s+complete/i.test(raw) || /complete\./i.test(raw) || /분석\s*완료/.test(raw);
                    androidRunningText.textContent = (isDoneByPercent || isDoneByText) ? '검사 완료' : '검사 진행 중...';
                }

                appendAndroidLogLine(text);
            }
        }
    };
}