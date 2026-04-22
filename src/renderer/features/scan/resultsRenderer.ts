export function createResultsRenderer(ctx: any, deps: any) {
    const { State, ViewManager } = ctx;
    const { BD_DOM, Utils, renderSuspiciousListView, buildIosPrivacyThreatApps, renderApkList, deviceSecurityStatusController, iosCoreAreasRenderer, renderIosInstalledApps, renderMvtAnalysisPanel, bindIosAppListControls, renderPrivacyThreatPanel, renderSuspiciousPanel, getNormalizedScanApps, androidAppListController, showAppDetail } = deps;
    const ResultsRenderer = {
        render(data) {
            console.log("ResultsRenderer.render 시작", data);


            State.lastScanData = data;
            const containers = [
                'app-grid-container',
                'bg-app-grid-container',
                'apk-grid-container',
                // 요약(보고서)
                'spyware-detail-container',
                'privacy-threat-detail-container',
                // (호환) 일부 탭/구버전 컨테이너
                'privacy-threat-list-container',
                // iOS 5대 핵심영역(분리된 메뉴) 컨테이너
                'ios-web-container',
                'ios-messages-container',
                'ios-system-container',
                'ios-appsprofiles-container',
                'ios-artifacts-container',
                // (구버전 호환) 단일 MVT 컨테이너
                'mvt-analysis-container'
            ];
            containers.forEach(id => {
                const el = document.getElementById(id);
                if (el) BD_DOM.clear(el);
            });

            // 2. 모든 결과 섹션을 일단 숨김 처리 
            document.querySelectorAll('.result-content-section').forEach(sec => {
                (sec as any).style.display = 'none';
                sec.classList.remove('active');
            });

            // 3. 기기 정보 텍스트 초기화
            ['res-model', 'res-serial', 'res-phone', 'res-root'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '-';
            });

            // ✅ OS 모드 자동 판별 (검사 열기/로컬 파일 열기에서 State가 꼬여도 iOS/Android를 정확히 분기)
            const inferDeviceMode = (payload) => {
                const raw = payload?.deviceInfo?.os || payload?.deviceInfo?.osMode || payload?.osMode || payload?.deviceMode || payload?.deviceInfo?.type;
                const normalized = String(raw || '').toLowerCase();

                // 1) explicit markers
                if (normalized.includes('ios')) return 'ios';
                if (normalized.includes('android')) return 'android';

                // 2) device model hint (iPhone/iPad/iPod)
                const model = String(payload?.deviceInfo?.model || '').toLowerCase();
                if (model.includes('iphone') || model.includes('ipad') || model.includes('ipod')) return 'ios';

                // 3) payload shape hints
                if (payload?.mvtResults || payload?.mvtAnalysis || payload?.mvt) return 'ios';
                if (typeof payload?.runningCount === 'number') return 'android';
                if (Array.isArray(payload?.apkFiles) && payload.apkFiles.length > 0) return 'android';

                // 4) fallback
                return State.currentDeviceMode || 'android';
            };

            const detectedMode = inferDeviceMode(data);
            State.currentDeviceMode = detectedMode;
            if (data?.deviceInfo && !data.deviceInfo.os) data.deviceInfo.os = detectedMode;

            const isIos = detectedMode === 'ios';

            /* [BD-PATCH] IOS_CLEANUP_ANDROID_LISTENERS */
            // If previously bound Android search/sort listeners exist, remove them when rendering iOS to prevent UI corruption.
            if (isIos && Array.isArray(State.scanRuntime?.androidListCleanup)) {
                State.scanRuntime.androidListCleanup.forEach(fn => { try { fn && fn(); } catch (_) { } });
                State.scanRuntime.androidListCleanup = [];
            }




            // --- [요약 UI 바인딩] (기기정보는 대시보드로 이동했으므로 여기서는 결과 요약 중심) ---
            try {
                const spywareCount = Array.isArray(data?.suspiciousApps) ? data.suspiciousApps.length : 0;
                const privacyCount = Array.isArray(data?.privacyThreatApps) ? data.privacyThreatApps.length : 0;
                const totalApps = Array.isArray(data?.allApps) ? data.allApps.length : 0;

                const setText = (id, value) => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = String(value);
                };

                setText('res-spyware-count', spywareCount);
                setText('res-privacy-count', privacyCount);
                setText('res-total-apps', totalApps);

                const modeEl = document.getElementById('res-scan-mode');
                if (modeEl) modeEl.textContent = isIos ? 'MVT기반 분석 + BD_SFA 행동 분석' : 'ADB + BD_SFA 행동 분석';

                const narrationEl = document.getElementById('res-summary-narration');
                if (narrationEl) {
                    const apkCount = Array.isArray(data?.apkFiles) ? data.apkFiles.length : 0;
                    const runningCount = Number.isFinite(data?.runningCount) ? data.runningCount : 0;
                    const parts = [];
                    parts.push(`설치된 앱 ${totalApps}개`);
                    if (!isIos) parts.push(`백그라운드 실행 ${runningCount}개`);
                    if (!isIos && apkCount > 0) parts.push(`발견된 APK ${apkCount}개`);
                    const basis = parts.join(' · ');

                    if (spywareCount > 0 && privacyCount > 0) {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 스파이앱 <b>${spywareCount}건</b>, 개인정보 유출 위협 <b>${privacyCount}건</b>이 탐지되었습니다.`);
                    } else if (spywareCount > 0) {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 스파이앱 <b>${spywareCount}건</b>이 탐지되었습니다.`);
                    } else if (privacyCount > 0) {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 개인정보 유출 위협 <b>${privacyCount}건</b>이 탐지되었습니다.`);
                    } else {
                        BD_DOM.setBoldText(narrationEl, `이번 정밀 검사는 <b>${basis}</b>를 기반으로 분석했습니다. 현재 결과 기준으로 명확한 스파이웨어 흔적은 확인되지 않았습니다.`);
                    }
                }

                const stepsEl = document.getElementById('res-scan-steps');
                if (stepsEl) {
                    const apkCount = Array.isArray(data?.apkFiles) ? data.apkFiles.length : 0;
                    const runningCount = Number.isFinite(data?.runningCount) ? data.runningCount : 0;

                    const steps = [];
                    if (isIos) {
                        steps.push('기기 백업과 로그(또는 MVT 결과)에서 웹 활동·메시지·시스템 로그·설치 앱/프로파일 등 핵심 아티팩트를 수집합니다.');
                        steps.push('IOC(의심 도메인/키워드/패턴) 매칭 및 정책 기반 규칙으로 위험 신호를 추출합니다.');
                        steps.push('수집된 메타데이터를 통해 BD-SFA가 정밀 분석합니다.');
                        steps.push('탐지된 단서를 근거로 요약/상세 영역에 설명을 생성해 제공합니다.');
                    } else {
                        steps.push(`ADB로 설치된 앱 ${totalApps}개, 백그라운드 실행 ${runningCount}개 정보를 수집합니다.`);
                        if (apkCount > 0) steps.push(`저장소에서 발견된 APK 파일 ${apkCount}개를 추가 수집해 설치 대기/유입 경로 위험을 평가합니다.`);
                        steps.push('권한(접근성/기기관리자/민감 권한), 서비스/리시버, 실행 지속성, 알려진 스턱웨어/스파이웨어 행위 신호를 정규화합니다.');
                        steps.push('<b>BD_SFA</b>가 행동 분석 기반으로 위험도를 산출하고, 정책 기반 규칙과 결합해 1차 분류합니다.');
                        steps.push('최종적으로 <b>접근성/기기관리자/지속성</b> 조합 신호가 강한 경우에만 스파이앱으로 확정(미탐 최소화)합니다.');
                    }

                    BD_DOM.clear(stepsEl);
                    const frag = document.createDocumentFragment();
                    steps.forEach((s) => {
                        const li = document.createElement('li');
                        // allow only <b> tags inside step text
                        BD_DOM.setBoldText(li, String(s));
                        frag.appendChild(li);
                    });
                    stepsEl.appendChild(frag);
                }
            } catch (e) {
                console.warn('[Summary] binding failed', e);
            }
            // 1. 공통 기기 정보 바인딩 (모델명, 시리얼 등)
            if (document.getElementById('res-model')) document.getElementById('res-model').textContent = data.deviceInfo?.model || '-';
            if (document.getElementById('res-serial')) document.getElementById('res-serial').textContent = data.deviceInfo?.serial || '-';
            if (document.getElementById('res-phone')) document.getElementById('res-phone').textContent = data.deviceInfo?.phoneNumber || '-';
            if (document.getElementById('res-root')) document.getElementById('res-root').textContent = data.deviceInfo?.isRooted ? "O" : 'X';


            // 주요 섹션 및 그리드 요소 가져오기
            const summarySection = document.getElementById('res-summary');
            const appsSection = document.getElementById('res-apps');
            const threatsSection = document.getElementById('res-threats');
            const appGrid = document.getElementById('app-grid-container');
            const bgAppGrid = document.getElementById('bg-app-grid-container');
            const apkGrid = document.getElementById('apk-grid-container');

            try {
                // 문구 변경을 위한 엘리먼트 참조 (공통으로 사용)
                const threatsTitle = document.getElementById('res-threats-title');
                const threatsDesc = document.getElementById('res-threats-desc');
                const iosAppDesc = document.getElementById('ios-app-list-description');
                const appsHeader = document.querySelector('#res-apps h3');

                if (isIos) {
                    // ==========================================
                    // --- [iOS 전용 렌더링 및 문구 설정] ---
                    // ==========================================

                    // 1. iOS 5대 핵심 영역 제목 및 설명 변경
                    if (threatsTitle) threatsTitle.textContent = "🔍 상세 분석 결과 (5대 핵심 영역)";
                    if (threatsDesc) threatsDesc.textContent = "스파이웨어 흔적 탐지를 위한 5가지 시스템 영역 분석 결과입니다.";

                    // 2. 검사 대상 앱 목록 설명 추가 및 제목 업데이트
                    const totalApps = data.allApps ? data.allApps.length : 0;
                    if (appsHeader) appsHeader.textContent = `📲 검사 대상 애플리케이션 목록 (총 ${totalApps}개)`;
                    if (iosAppDesc) {
                        (iosAppDesc as any).style.display = 'block'; // iOS에서만 노출
                        iosAppDesc.textContent = `${totalApps}개의 앱 데이터베이스 및 파일 흔적**을 검사하는 데 활용되었습니다.`;
                    }

                    // 3. 데이터 렌더링 호출
                    // (1) 요약 탭: 기기정보 + 정밀 분석 결과
                    try {
                        renderSuspiciousListView({ suspiciousApps: (data.suspiciousApps || []), isIos: true, Utils });
                    } catch (e) {
                        console.warn('[IosResults] suspicious list render failed', e);
                    }
                    // (2) 5대 핵심영역: 영역별 상세 리포트(분리 메뉴)
                    try {
                        this.renderIosCoreAreas(data.mvtResults || {});
                    } catch (e) {
                        console.warn('[IosResults] core areas render failed', e);
                    }

                    // (2-1) iOS 개인정보 유출 위협: 정책 기반(앱 번들ID) + AI 안내
                    const normalizedApps = getNormalizedScanApps(data).filter((app) => app && typeof app === 'object');
                    const iosPrivacyApps = buildIosPrivacyThreatApps(
                        normalizedApps,
                        Array.isArray(data.privacyThreatApps) ? data.privacyThreatApps : []
                    );
                    try {
                        renderPrivacyThreatPanel({
                            privacyApps: iosPrivacyApps,
                            clear: (el) => BD_DOM.clear(el),
                            formatAppName: (name) => Utils.formatAppName(name)
                        });
                    } catch (e) {
                        console.warn('[IosResults] privacy list render failed', e);
                    }

                    // (3) 앱 목록 탭: iOS 전용 리스트
                    if (appGrid) {
                        try {
                            BD_DOM.clear(appGrid);
                            appGrid.className = ""; // iOS는 리스트 형태이므로 클래스 초기화
                            renderIosInstalledApps({
                                apps: normalizedApps,
                                container: appGrid,
                                clear: (el) => BD_DOM.clear(el),
                                formatAppName: (name) => Utils.formatAppName(name)
                            });
                            bindIosAppListControls({
                                State,
                                Utils,
                                apps: normalizedApps,
                                container: appGrid
                            });
                        } catch (e) {
                            console.warn('[IosResults] installed apps render failed', e);
                            BD_DOM.clear(appGrid);
                            appGrid.appendChild(BD_DOM.emptyMessage('iOS 앱 목록을 렌더링하지 못했습니다.'));
                        }
                    }

                    // 초기 화면 설정: 요약 섹션만 보이고 나머지는 숨김
                    document.querySelectorAll('.result-content-section').forEach(sec => {
                        (sec as any).style.display = (sec.id === 'res-summary') ? 'block' : 'none';
                    });

                } else {
                    // ==========================================
                    // --- [Android 전용 렌더링 및 문구 복구] ---
                    // ==========================================

                    // 1. 안드로이드 원래 문구로 복구 
                    if (threatsTitle) threatsTitle.textContent = "🔐 기기 보안 상태";
                    if (threatsDesc) threatsDesc.textContent = "스파이앱 침입 가능성을 높이는 설정을 점검합니다.";
                    if (iosAppDesc) (iosAppDesc as any).style.display = 'none'; // 안드로이드에선 숨김

                    const totalApps = data.allApps ? data.allApps.length : 0; // 전체 앱 개수 계산
                    const runningApps = data.runningCount || 0;
                    if (appsHeader) {
                        appsHeader.textContent = `📲 설치된 애플리케이션 (총 ${totalApps}개)`;
                    }

                    const bgHeader = document.querySelector('#res-background h3');
                    if (bgHeader) {
                        bgHeader.textContent = `🚀 실행 중인 백그라운드 앱 (총 ${runningApps}개)`;
                    }

                    // 2. 데이터 렌더링 호출
                    // (1) 위협 탐지 목록 (요약 탭 상단)

                    try {
                        renderSuspiciousListView({ suspiciousApps: (data.suspiciousApps || []), isIos: false, Utils });
                    } catch (e) {
                        console.warn('[AndroidResults] suspicious list render failed', e);
                    }
                    try {
                        renderPrivacyThreatPanel({
                            privacyApps: Array.isArray(data.privacyThreatApps) ? data.privacyThreatApps : [],
                            clear: (el) => BD_DOM.clear(el),
                            formatAppName: (name) => Utils.formatAppName(name)
                        });
                    } catch (e) {
                        console.warn('[AndroidResults] privacy list render failed', e);
                    }

                    // (2) 모든 설치된 앱 (앱 목록 탭)
                    const allAndroidApps = getNormalizedScanApps(data).filter((app) => app && typeof app === 'object');

                    if (appGrid) {
                        try {
                            BD_DOM.clear(appGrid);
                            appGrid.className = 'app-grid';
                            if (allAndroidApps.length > 0) {
                                allAndroidApps.forEach(app => androidAppListController.createAppIcon(app, appGrid, 'installed'));
                            } else {
                                appGrid.appendChild(BD_DOM.emptyMessage('설치된 앱 데이터를 불러오지 못했습니다.'));
                            }
                        } catch (e) {
                            console.warn('[AndroidResults] installed apps render failed', e);
                            BD_DOM.clear(appGrid);
                            appGrid.appendChild(BD_DOM.emptyMessage('설치된 앱 화면을 렌더링하지 못했습니다.'));
                        }
                    }

                    // (3) 백그라운드 앱 (백그라운드 탭)
                    if (bgAppGrid) {
                        try {
                            BD_DOM.clear(bgAppGrid);
                            const bgApps = allAndroidApps.filter(a => a.isRunningBg);
                            if (bgApps.length > 0) {
                                bgApps.forEach(app => androidAppListController.createAppIcon(app, bgAppGrid, 'bg'));
                            } else {
                                bgAppGrid.appendChild(BD_DOM.emptyMessage('실행 중인 백그라운드 앱이 없습니다.'));
                            }
                        } catch (e) {
                            console.warn('[AndroidResults] background apps render failed', e);
                            BD_DOM.clear(bgAppGrid);
                            bgAppGrid.appendChild(BD_DOM.emptyMessage('백그라운드 앱 화면을 렌더링하지 못했습니다.'));
                        }
                    }


                    // ✅ Android 앱 리스트 검색/정렬 기능 바인딩 (검색/정렬 시 아이콘 재로딩 없음)
                    try {
                        androidAppListController.initAndroidAppListControls(allAndroidApps);
                    } catch (e) {
                        console.warn('[AndroidResults] app list controls bind failed', e);
                    }

                    // (4) 발견된 설치 파일(APK) (설치 파일 탭)
                    if (apkGrid) {
                        try {
                            const apkHeader = document.querySelector('#res-apk h3');
                            const apkFiles = Array.isArray(data.apkFiles) ? data.apkFiles.filter((apk) => apk && typeof apk === 'object') : [];

                            if (apkHeader) {
                                apkHeader.textContent = `📁 발견된 APK 파일 (총 ${apkFiles.length}개)`;
                            }

                            renderApkList({
                                apkFiles,
                                container: apkGrid,
                                clear: (el) => BD_DOM.clear(el),
                                showAppDetail
                            });
                        } catch (e) {
                            console.warn('[AndroidResults] apk list render failed', e);
                            BD_DOM.clear(apkGrid);
                            apkGrid.appendChild(BD_DOM.emptyMessage('APK 목록을 렌더링하지 못했습니다.'));
                        }
                    }

                    // (5) 🔐 기기 보안 상태 (Android 전용)
                    try {
                        const container = document.getElementById('device-security-container');
                        if (container && window.electronAPI?.getDeviceSecurityStatus) {
                            deviceSecurityStatusController.load(container);
                        }
                    } catch (e) {
                        console.warn('[DeviceSecurityStatus] load failed', e);
                    }

                    // 초기 화면 설정: 요약 섹션만 보이고 나머지는 숨김
                    document.querySelectorAll('.result-content-section').forEach(sec => {
                        (sec as any).style.display = (sec.id === 'res-summary') ? 'block' : 'none';
                    });
                }
            } catch (err) {
                console.error("렌더링 도중 오류 발생:", err);
            }

            // 2. 최종 화면 전환 (결과 스크린으로 이동)
            ViewManager.showScreen(document.getElementById('logged-in-view'), 'scan-results-screen');

            // 3. 좌측 탭 하이라이트 활성화 (iOS/Android 각각의 메뉴 뭉치에서 첫 번째 탭 선택)
            const targetMenuId = isIos ? 'ios-sub-menu' : 'result-sub-menu';
            const firstTab = document.querySelector(`#${targetMenuId} .res-tab[data-target="res-summary"]`);
            if (firstTab) {
                // 모든 탭의 활성화 클래스 제거
                document.querySelectorAll('.res-tab').forEach(t => t.classList.remove('active'));
                // 현재 모드에 맞는 첫 번째 탭만 활성화
                firstTab.classList.add('active');
            }
        },

        // [MVT 분석 박스 렌더링 함수]

        // =========================================================
        // [iOS 5대 핵심영역 - 메뉴 분리용 렌더링]
        // =========================================================
        renderIosCoreAreas(mvtResults) {
            iosCoreAreasRenderer.render(mvtResults);
        },

        // -------------------------------------------------
        // MVT 상세 분석 렌더링 함수 (iOS 전용)
        // -------------------------------------------------
        renderMvtAnalysis(mvtResults, isIos) {
            renderMvtAnalysisPanel({ mvtResults, isIos });
        },

        renderSuspiciousList(suspiciousApps, isIos = false) {
            renderSuspiciousPanel({
                suspiciousApps,
                isIos,
                formatAppName: (name) => Utils.formatAppName(name)
            });
        },
        renderPrivacyThreatList(privacyApps) {
            renderPrivacyThreatPanel({
                privacyApps,
                clear: (el) => BD_DOM.clear(el),
                formatAppName: (name) => Utils.formatAppName(name)
            });
        },


        forceRenderIosCoreAreas() {
            try {
                const data = State.lastScanData || {};
                this.renderIosCoreAreas(data.mvtResults || {});
            } catch (e) {
                console.error('[iOS] forceRenderIosCoreAreas failed:', e);
            }
        }
    };
    return ResultsRenderer;
}
