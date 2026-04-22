// Synced from TypeScript preview output. Source of truth: viewManager.ts
export function createViewManager(State) {
    let lastAndroidLogText = '';
    let lastAndroidLogTime = 0;
    return {
        showView(viewId) {
            document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
            const viewToShow = document.getElementById(viewId);
            if (viewToShow) {
                viewToShow.classList.add('active');
            }
        },
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
                'scan-info-screen',
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
            const reportHeaderRoot = document.getElementById('report-header-root');
            if (reportHeaderRoot) {
                const shouldShowReportHeader = (screenId === 'scan-results-screen' || screenId === 'scan-info-screen');
                reportHeaderRoot.classList.toggle('hidden', !shouldShowReportHeader);
                try {
                    const disconnectBtn = document.getElementById('disconnect-btn');
                    if (disconnectBtn) {
                        disconnectBtn.textContent = (State && State.isLoadedScan) ? '닫기' : '연결 끊기';
                    }
                }
                catch (_e) { /* noop */ }
            }
            const subMenu = document.getElementById('result-sub-menu');
            const iosSubMenu = document.getElementById('ios-sub-menu');
            const navCreate = document.getElementById('nav-create');
            const navOpen = document.getElementById('nav-open');
            const mode = String(State.currentDeviceMode || '').toLowerCase();
            const isIos = mode.includes('ios');
            const shouldShowResultMenu = (screenId === 'scan-results-screen' ||
                screenId === 'scan-info-screen' ||
                screenId === 'app-detail-view' ||
                screenId === 'res-privacy' ||
                screenId === 'admin-report-detail-screen' ||
                (!!State.lastScanData && screenId === 'admin-screen'));
            if (shouldShowResultMenu) {
                if (screenId === 'scan-info-screen') {
                    if (subMenu) {
                        subMenu.classList.add('hidden');
                        subMenu.style.setProperty('display', 'none', 'important');
                    }
                    if (iosSubMenu) {
                        iosSubMenu.classList.add('hidden');
                        iosSubMenu.style.setProperty('display', 'none', 'important');
                    }
                    if (navCreate)
                        navCreate.style.display = 'none';
                    if (navOpen)
                        navOpen.style.display = 'none';
                }
                else if (isIos) {
                    if (subMenu)
                        subMenu.style.setProperty('display', 'none', 'important');
                    if (iosSubMenu) {
                        iosSubMenu.classList.remove('hidden');
                        iosSubMenu.style.setProperty('display', 'block', 'important');
                    }
                }
                else {
                    if (iosSubMenu)
                        iosSubMenu.style.setProperty('display', 'none', 'important');
                    if (subMenu) {
                        subMenu.classList.remove('hidden');
                        subMenu.style.setProperty('display', 'block', 'important');
                        const isScanComplete = !!State.lastScanData;
                        const tabs = subMenu.querySelectorAll('li.res-tab');
                        tabs.forEach(tab => {
                            const target = tab.dataset.target;
                            tab.style.display =
                                target === 'scan-dashboard-screen'
                                    ? 'block'
                                    : isScanComplete
                                        ? (target === 'res-network' ? 'none' : 'block')
                                        : 'none';
                        });
                    }
                }
                if (navCreate)
                    navCreate.style.display = 'none';
                if (navOpen)
                    navOpen.style.display = 'none';
            }
            else {
                if (subMenu) {
                    subMenu.classList.add('hidden');
                    subMenu.style.setProperty('display', 'none', 'important');
                }
                if (iosSubMenu) {
                    iosSubMenu.classList.add('hidden');
                    iosSubMenu.style.setProperty('display', 'none', 'important');
                }
                if (navCreate)
                    navCreate.style.display = 'block';
                if (navOpen)
                    navOpen.style.display = 'block';
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
            }
        },
        updateIosStageProgress(stage, text) {
            const statusText = document.getElementById('scan-status-text');
            const stageItems = Array.from(document.querySelectorAll('#ios-stage-tracker .ios-stage-item'));
            const orderedStages = ['device-check', 'backup', 'mvt', 'finalize'];
            const normalizedStage = String(stage || '').trim().toLowerCase();
            const currentIndex = orderedStages.indexOf(normalizedStage);
            if (statusText && text) {
                statusText.textContent = text;
            }
            if (!stageItems.length)
                return;
            stageItems.forEach((item) => {
                item.classList.remove('is-active', 'is-done');
            });
            if (normalizedStage === 'complete') {
                stageItems.forEach((item) => item.classList.add('is-done'));
                return;
            }
            if (currentIndex < 0)
                return;
            stageItems.forEach((item, index) => {
                if (index < currentIndex)
                    item.classList.add('is-done');
                else if (index === currentIndex)
                    item.classList.add('is-active');
            });
        },
        updateProgress(percent, text, isIos) {
            const statusText = document.getElementById('scan-status-text');
            const androidStatusBar = document.getElementById('android-progress-bar');
            const androidStatusText = document.getElementById('android-scan-status-text');
            const androidProgressPercentText = document.getElementById('android-progress-percent-text');
            const androidRunningText = document.getElementById('android-scan-running-text');
            const logContainer = document.getElementById('log-container');
            const ensureLogScrollableWithoutScrollbar = () => {
                if (!logContainer)
                    return;
                logContainer.style.overflowY = 'auto';
                logContainer.style.scrollbarWidth = 'none';
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
                if (!logContainer || !rawText)
                    return;
                ensureLogScrollableWithoutScrollbar();
                const timeText = new Date().toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                let englishMsg = String(rawText)
                    .replace(/정밀\s*분석\s*중\.{0,3}/g, 'Analyzing...')
                    .replace(/분석\s*중\.{0,3}/g, 'Analyzing...')
                    .replace(/분석\s*완료!?.*/g, 'Analysis complete. Generating report...')
                    .replace(/리포트\s*생성\s*중\.{0,3}/g, 'Generating report...')
                    .replace(/검사\s*진행\s*중\.{0,3}/g, 'Scanning...')
                    .replace(/\[\s*\d+\s*\/\s*\d+\s*\]\s*/g, '')
                    .replace(/결과\s*리포트를\s*생성합니다\.?/g, '')
                    .replace(/리포트를\s*생성합니다\.?/g, '')
                    .replace(/결과\s*보고서를\s*생성합니다\.?/g, '')
                    .replace(/보고서를\s*생성합니다\.?/g, '')
                    .trim();
                if (!englishMsg)
                    return;
                const nowMs = Date.now();
                if (englishMsg === lastAndroidLogText && (nowMs - lastAndroidLogTime) < 1200)
                    return;
                lastAndroidLogText = englishMsg;
                lastAndroidLogTime = nowMs;
                const lineEl = document.createElement('div');
                lineEl.className = 'log-line';
                lineEl.textContent = `[${timeText}] ${englishMsg}`;
                const shouldStickToBottom = (logContainer.scrollTop + logContainer.clientHeight + 24) >= logContainer.scrollHeight;
                logContainer.appendChild(lineEl);
                const MAX_LOG_LINES = 200;
                while (logContainer.children.length > MAX_LOG_LINES) {
                    logContainer.removeChild(logContainer.firstChild);
                }
                if (shouldStickToBottom) {
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            };
            if (isIos) {
                if (statusText)
                    statusText.textContent = text;
            }
            else {
                if (androidStatusBar) {
                    androidStatusBar.style.width = `${percent}%`;
                    androidStatusBar.style.backgroundColor =
                        androidStatusBar.style.backgroundColor || '#5CB85C';
                }
                if (androidStatusText) {
                    const m = String(text || '').match(/\[(\d+)\s*\/\s*(\d+)\]/);
                    if (m)
                        androidStatusText.textContent = `${m[1]}/${m[2]}`;
                }
                if (androidProgressPercentText) {
                    androidProgressPercentText.textContent = `${Math.round(percent)}%`;
                }
                if (androidRunningText) {
                    const isDoneByPercent = Number.isFinite(percent) && Math.round(percent) >= 100;
                    const raw = String(text || '');
                    const isDoneByText = /analysis\s+complete/i.test(raw) || /complete\./i.test(raw) || /분석\s*완료/.test(raw);
                    const isPhase2 = /\[\s*\d+\s*\/\s*\d+\s*\]/.test(raw) || /검사\s*진행\s*중/.test(raw) || /검사\s*진행중/.test(raw);
                    androidRunningText.textContent = (isDoneByPercent || isDoneByText)
                        ? '검사 완료'
                        : (isPhase2 ? '검사 진행 중...' : '데이터 확보중...');
                }
                appendAndroidLogLine(text);
            }
        }
    };
}
