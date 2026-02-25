/**
 * Auto-extracted from legacy bootstrap.js for maintainable structure.
 * Responsibility: Android domain operations only (no IPC wiring).
 */
function createAndroidService({ client, adb, ApkReader, fs, path, os, crypto, log, exec, CONFIG, analyzeAppWithStaticModel }) {
    // NOTE: bootstrap.js passes a single options object.
    if (!client) throw new Error('createAndroidService requires client');
    if (!adb) throw new Error('createAndroidService requires adb');
    const { evaluateAndroidAppRisk, RISK_LEVELS } = require('../../shared/risk/riskRules');
    const { evaluateAndroidSpywareFinalVerdict } = require('../../shared/spyware/spywareFinalFilter');


    const service = {
        /**
         * Check first connected device status + model.
         * Returns: { status: 'disconnected'|'unauthorized'|'offline'|'connected'|'error', model?, error? }
         */
        async checkConnection() {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) return { status: 'disconnected' };

                const device = devices[0];
                if (device.type === 'unauthorized') return { status: 'unauthorized' };
                if (device.type === 'offline') return { status: 'offline' };

                let model = 'Android Device';
                try {
                    const info = await service.getDeviceInfo(device.id);
                    model = info.model || model;
                } catch (_e) { }

                return { status: 'connected', model };
            } catch (err) {
                return { status: 'error', error: err.message };
            }
        },

        /**
         * Delete APK file inside device.
         */
        async deleteApkFile(serial, filePath) {
            if (!serial || !filePath) throw new Error('serial and filePath are required');
            try {
                await client.shell(serial, `rm -f "${filePath}"`);
                return { success: true, message: "파일이 기기에서 영구적으로 삭제되었습니다." };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        /**
         * Main Android scan pipeline (moved from IPC layer).
         */
        async runScan() {
            console.log('--- AI 정밀 분석 시작 ---');
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 없음');
                const serial = devices[0].id;

                // ✅ (무료 최종 필터 정확도 향상)
                // 접근성 서비스 활성/기기 관리자 활성 상태는 앱별로 매번 조회하지 않고, 스캔 시작 시 한 번만 수집합니다.
                // - dumpsys accessibility: Enabled services에서 패키지 추출
                // - dumpsys device_policy: Active admin에서 패키지 추출
                const [enabledA11yPkgs, activeAdminPkgs] = await Promise.all([
                    service.getEnabledAccessibilityPackages(serial),
                    service.getActiveDeviceAdminPackages(serial)
                ]);

                const deviceInfo = await service.getDeviceInfo(serial);
                deviceInfo.os = 'ANDROID';

                const allApps = await service.getInstalledApps(serial);
                const apkFiles = await service.findApkFiles(serial);
                const networkMap = await service.getNetworkUsageMap(serial);

                const processedApks = await Promise.all(apkFiles.map(async (apk) => {
                    const perms = await service.getApkPermissionsOnly(serial, apk.apkPath);
                    return {
                        ...apk,
                        requestedList: perms,
                        requestedCount: perms.length
                    };
                }));

                const processedApps = [];
                const analyze = analyzeAppWithStaticModel;

                for (let i = 0; i < allApps.length; i += 20) {
                    const chunk = allApps.slice(i, i + 20);
                    const results = await Promise.all(chunk.map(async (app) => {
                        try {
                            const [isRunningBg, permData] = await Promise.all([
                                service.checkIsRunningBackground(serial, app.packageName),
                                service.getAppPermissions(serial, app.packageName)
                            ]);

                            const permissions = [...new Set([
                                ...(permData.requestedList || []),
                                ...(permData.grantedList || [])
                            ])];

                            const netStats = networkMap[app.uid] || { rx: 0, tx: 0 };

                            const trustedPrefixes = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'android'];
                            const isMasquerading = trustedPrefixes.some(p => app.packageName.startsWith(p)) && !app.isSystemApp;

                            const aiPayload = {
                                packageName: app.packageName,
                                permissions,
                                isSideloaded: app.isSideloaded,
                                isSystemPath: app.apkPath.startsWith('/system') || app.apkPath.startsWith('/vendor') || app.apkPath.startsWith('/product'),
                                isMasquerading,
                                services_cnt: permData.servicesCount || 0,
                                receivers_cnt: permData.receiversCount || 0
                            };

                            const aiResult = analyze ? await analyze(aiPayload) : { score: 0, grade: 'SAFE', reason: '' };

                            if (aiResult.score >= 50) {
                                console.log(`\n🚨 [AI 탐지 로그: ${app.packageName}]`);
                                console.log(`- 판정 점수: ${aiResult.score}점 (${aiResult.grade})`);
                                console.log(`- 앱 경로: ${app.apkPath}`);
                                console.log(`- 시스템 경로 판정: ${aiPayload.isSystemPath}`);
                                console.log(`- 서비스 개수: ${permData.servicesCount}`);
                                console.log(`- 리시버 개수: ${permData.receiversCount}`);
                                console.log(`- 권한 개수: ${permissions.length}`);
                                console.log(`- 사이드로드 여부: ${app.isSideloaded}`);
                                console.log(`- 원인: ${aiResult.reason}`);
                                console.log(`-------------------------------------------\n`);
                            }

                            const isAccessibilityEnabled = enabledA11yPkgs.has(app.packageName);
                            const isDeviceAdminActive = activeAdminPkgs.has(app.packageName);

                            return {
                                ...app,
                                isRunningBg,
                                isAccessibilityEnabled,
                                isDeviceAdminActive,
                                ...permData,
                                dataUsage: netStats,
                                aiScore: aiResult.score,
                                aiGrade: aiResult.grade,
                                reason: aiResult.reason,
                                servicesCount: permData.servicesCount,
                                receiversCount: permData.receiversCount
                            };
                        } catch (e) {
                            console.error(`Error analyzing ${app.packageName}:`, e);
                            return { ...app, error: true };
                        }
                    }));
                    processedApps.push(...results);
                }

                let suspiciousApps = processedApps.filter(app => app.aiGrade === 'DANGER' || app.aiGrade === 'WARNING');
                // ✅ VT(유료) 정밀 검사는 사용하지 않습니다. (최종 필터는 내부 정책 기반)

                // 2) ✅ 최종 분류
                // - 2-1) 스파이앱 최종 확정(무료): src/shared/spyware/spywareFinalFilter.js
                // - 2-2) 개인정보 유출 위협: src/shared/risk/riskRules.js
                processedApps.forEach((app) => {
                    // (A) 최종 스파이 확정 필터 (AI 의심 앱만 대상으로 조합 기반 확정)
                    const finalVerdict = evaluateAndroidSpywareFinalVerdict(app);

                    if (finalVerdict.isSpyware) {
                        app.riskLevel = RISK_LEVELS.SPYWARE;
                        app.riskReasons = finalVerdict.reasons || [];
                        app.recommendation = [
                            { action: 'UNINSTALL', label: '앱 삭제 권장' },
                            { action: 'REVOKE_PERMISSIONS', label: '권한 회수(전체)' },
                            { action: 'CHECK_ACCOUNTS', label: '계정/인증정보 점검' }
                        ];
                        app.aiNarration = finalVerdict.narration || '스파이앱으로 분류했습니다.';
                        app.reason = `[최종 필터 확진] ${app.aiNarration}`;
                        return;
                    }

                    // (B) 개인정보 유출 위협 평가
                    const evaluated = evaluateAndroidAppRisk(app);

                    app.riskLevel = evaluated.riskLevel;
                    app.riskReasons = evaluated.riskReasons;
                    app.recommendation = evaluated.recommendation;
                    app.aiNarration = evaluated.aiNarration;

                    // UI 호환용 reason도 유지 (대표 문장 1개)
                    if (app.riskLevel === RISK_LEVELS.PRIVACY_RISK) {
                        app.reason = `[개인정보 유출 위협] ${evaluated.aiNarration}`;
                    } else if (!app.reason) {
                        app.reason = '';
                    }
                });

                const spywareApps = processedApps.filter(app => app.riskLevel === RISK_LEVELS.SPYWARE);
                const privacyThreatApps = processedApps.filter(app => app.riskLevel === RISK_LEVELS.PRIVACY_RISK);

                const runningAppsCount = processedApps.filter(app => app.isRunningBg).length;

                return { deviceInfo, allApps: processedApps, suspiciousApps: spywareApps, privacyThreatApps, apkFiles: processedApks, runningCount: runningAppsCount };
            } catch (err) {
                console.error(err);
                return { error: err.message };
            }
        },
        // 기기 정보 가져오기
        async getDeviceInfo(serial) {
            const modelCmd = await client.shell(serial, 'getprop ro.product.model');
            const model = (await adb.util.readAll(modelCmd)).toString().trim();

            let isRooted = false;
            try {
                const rootCmd = await client.shell(serial, 'which su');
                if ((await adb.util.readAll(rootCmd)).toString().trim().length > 0) isRooted = true;
            } catch (e) { }

            let phoneNumber = '알 수 없음';
            try {
                const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
                const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
                if (phoneOut.includes('Line 1 Number')) phoneNumber = phoneOut;
            } catch (e) { }

            return { model, serial, isRooted, phoneNumber };
        },

        // ---------------------------------------------------------
        // ✅ [Helper] adb shell 결과를 "문자열"로 받기 (Stream -> String)
        async adbShell(serial, cmd) {
            const out = await client.shell(serial, cmd);
            return (await adb.util.readAll(out)).toString().trim();
        },

        // ---------------------------------------------------------
        // ✅ [Helper] adbShell with timeout (prevents UI hang)
        async adbShellWithTimeout(serial, cmd, timeoutMs = 7000) {
            return await Promise.race([
                service.adbShell(serial, cmd),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`adb timeout: ${cmd}`)), timeoutMs))
            ]);
        },

        // ---------------------------------------------------------
        // ✅ [Android] Device Security Status
        // Returns: { ok: boolean, items: Array<{id,title,status,level,detail?,note?}>, error? }
        async getDeviceSecurityStatus(serial) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 안 됨');
                const target = serial || devices[0].id;

                const getSetting = async (namespace, key) => {
                    try {
                        const out = await service.adbShellWithTimeout(target, `settings get ${namespace} ${key}`);
                        if (!out || out === 'null' || out === 'undefined') return null;
                        return out.trim();
                    } catch (_e) {
                        return null;
                    }
                };

                const asBool = (v) => {
                    if (v == null) return null;
                    const s = String(v).trim();
                    if (s === '1' || s.toLowerCase() === 'true') return true;
                    if (s === '0' || s.toLowerCase() === 'false') return false;
                    return null;
                };

                // Core settings
                const devOpt = asBool(await getSetting('global', 'development_settings_enabled'));
                const usbDebug = asBool(await getSetting('global', 'adb_enabled'));
                const wifiDebug = asBool(await getSetting('global', 'adb_wifi_enabled')) ?? asBool(await getSetting('secure', 'adb_wifi_enabled'));

                // (요구사항) Play 스토어 보안/자동 차단 관련 항목은 현재 화면에서 제외합니다.

                // Unknown sources (legacy; modern Android is per-app, so this may be null)
                const unknownSources = asBool(await getSetting('secure', 'install_non_market_apps'));

                // Accessibility / Device Admin / Notification access
                const a11yEnabled = asBool(await getSetting('secure', 'accessibility_enabled'));
                const enabledA11yPkgs = await service.getEnabledAccessibilityPackages(target);
                const activeAdminPkgs = await service.getActiveDeviceAdminPackages(target);
                const notifListenersRaw = await getSetting('secure', 'enabled_notification_listeners');
                const notifListenerPkgs = new Set();
                if (notifListenersRaw) {
                    // format: com.pkg/.Service:com.other/.Svc
                    String(notifListenersRaw).split(':').forEach((entry) => {
                        const m = entry.trim().match(/^([a-zA-Z0-9_\.]+)\//);
                        if (m && m[1]) notifListenerPkgs.add(m[1]);
                    });
                }

                const items = [];

                // Action descriptors used by renderer to show "끄기/켜기/설정 열기" buttons.
                // Renderer will call IPC to apply these actions.
                const buildActions = (id, boolVal) => {
                    // Renderer가 기대하는 스키마: { kind: 'toggle'|'openSettings', ... }
                    // 요구사항:
                    // - 개발자 옵션 / USB 디버깅: 화면에 "끄기" 버튼 제거
                    // - 무선 디버깅: ON일 때만 "끄기" 제공 (OFF일 때 "켜기" 미제공)

                    if (id === 'wifiDebug') {
                        const actions = [];
                        if (boolVal === true) {
                            actions.push({ kind: 'toggle', label: '끄기', target: 'wifiDebug', value: false });
                        }
                        actions.push({ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS' });
                        return actions;
                    }

                    if (id === 'devOptions') {
                        return [];
                    }

                    if (id === 'usbDebug') {
                        return [];
                    }

                    if (id === 'unknownSources') {
                        return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.MANAGE_UNKNOWN_APP_SOURCES' }];
                    }
                    if (id === 'accessibility') {
                        return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.ACCESSIBILITY_SETTINGS' }];
                    }
                    if (id === 'deviceAdmin') {
                        return [{ kind: 'openSettings', label: '설정 열기', intent: 'com.android.settings/.DeviceAdminSettings' }];
                    }
                    if (id === 'notificationAccess') {
                        return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS' }];
                    }

                    return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.SETTINGS' }];
                };

                const push = (id, title, boolVal, { levelOn = 'warn', levelOff = 'ok', unknown = 'unknown', detailOn = '', detailOff = '', note } = {}) => {
                    if (boolVal === true) {
                        items.push({ id, title, status: 'ON', level: levelOn, detail: detailOn, actions: buildActions(id, true), ...(note ? { note } : {}) });
                    } else if (boolVal === false) {
                        items.push({ id, title, status: 'OFF', level: levelOff, detail: detailOff, actions: buildActions(id, false), ...(note ? { note } : {}) });
                    } else {
                        items.push({ id, title, status: 'UNKNOWN', level: unknown, detail: '기기/OS 정책으로 확인할 수 없거나 권한이 부족합니다.', actions: buildActions(id, null), ...(note ? { note } : {}) });
                    }
                };

                push('devOptions', '개발자 옵션', devOpt, {
                    levelOn: 'warn',
                    levelOff: 'ok',
                    detailOn: '개발자 옵션이 활성화되어 있습니다. 악성 앱이 디버그 기능을 악용할 여지가 증가할 수 있습니다.',
                    detailOff: '개발자 옵션이 비활성화되어 있습니다.'
                });

                // USB debugging: informational, because BD-SCANNER uses it
                push('usbDebug', 'USB 디버깅', usbDebug, {
                    levelOn: 'info',
                    levelOff: 'ok',
                    detailOn: '검사를 위해 일시적으로 필요합니다. 검사 종료 시 자동으로 비활성화될 수 있도록 안내합니다.',
                    detailOff: 'USB 디버깅이 비활성화되어 있습니다.',
                    note: 'BD-SCANNER 검사 수행을 위해 USB 디버깅이 사용될 수 있습니다. 검사 종료 후에는 비활성화하는 것을 권장합니다.'
                });

                push('wifiDebug', '무선 디버깅', wifiDebug, {
                    levelOn: 'warn',
                    levelOff: 'ok',
                    detailOn: '무선 디버깅이 켜져 있습니다. 동일 네트워크에서 디버깅 연결 위험이 증가할 수 있습니다.',
                    detailOff: '무선 디버깅이 꺼져 있습니다.'
                });

                push('unknownSources', '출처를 알 수 없는 앱 설치 허용(레거시)', unknownSources, {
                    levelOn: 'high',
                    levelOff: 'ok',
                    unknown: 'unknown',
                    detailOn: '공식 스토어 외 설치가 허용되어 있습니다. 스파이앱 유입 위험이 증가합니다.',
                    detailOff: '공식 스토어 외 설치가 제한되어 있습니다.',
                    note: '최신 Android는 “앱별로” 알 수 없는 앱 설치 권한을 관리합니다. 이 값이 UNKNOWN일 수 있습니다.'
                });

                // (요구사항) Play 스토어 관련 항목은 표시하지 않습니다.


                // Accessibility services
                const a11yCount = enabledA11yPkgs.size;
                items.push({
                    id: 'accessibility',
                    title: '접근성 서비스 활성 앱',
                    status: a11yCount > 0 ? `ON (${a11yCount})` : 'OFF',
                    level: a11yCount > 0 ? 'high' : 'ok',
                    detail: a11yCount > 0
                        ? `활성화된 접근성 서비스: ${Array.from(enabledA11yPkgs).slice(0, 10).join(', ')}${a11yCount > 10 ? ' ...' : ''}`
                        : '활성화된 접근성 서비스가 감지되지 않았습니다.',
                    list: Array.from(enabledA11yPkgs),
                    note: '접근성 권한은 화면 조작/입력 가로채기에 악용될 수 있어 스파이앱 탐지에서 매우 중요합니다.',
                    actions: buildActions('accessibility', a11yCount > 0)
                });

                // Device admin
                const adminCount = activeAdminPkgs.size;
                items.push({
                    id: 'deviceAdmin',
                    title: '기기 관리자(Device Admin) 활성 앱',
                    status: adminCount > 0 ? `ON (${adminCount})` : 'OFF',
                    level: adminCount > 0 ? 'warn' : 'ok',
                    detail: adminCount > 0
                        ? `활성 기기 관리자: ${Array.from(activeAdminPkgs).slice(0, 10).join(', ')}${adminCount > 10 ? ' ...' : ''}`
                        : '활성 기기 관리자 앱이 감지되지 않았습니다.',
                    list: Array.from(activeAdminPkgs),
                    note: '기기 관리자 권한은 삭제 방해/잠금 등 악용될 수 있습니다.',
                    actions: buildActions('deviceAdmin', adminCount > 0)
                });

                // Notification listeners
                const notifCount = notifListenerPkgs.size;
                items.push({
                    id: 'notificationAccess',
                    title: '알림 접근(Notification Access) 앱',
                    status: notifCount > 0 ? `ON (${notifCount})` : 'OFF',
                    level: notifCount > 0 ? 'warn' : 'ok',
                    detail: notifCount > 0
                        ? `알림 접근 허용: ${Array.from(notifListenerPkgs).slice(0, 10).join(', ')}${notifCount > 10 ? ' ...' : ''}`
                        : '알림 접근 권한 앱이 감지되지 않았습니다.',
                    list: Array.from(notifListenerPkgs),
                    note: '알림 접근은 OTP/메신저 알림 가로채기에 악용될 수 있습니다.',
                    actions: buildActions('notificationAccess', notifCount > 0)
                });

                // Additional context: accessibility_enabled setting
                if (a11yEnabled === false && a11yCount > 0) {
                    items.push({
                        id: 'accessibilityMismatch',
                        title: '접근성 설정 불일치',
                        status: 'WARN',
                        level: 'warn',
                        detail: 'accessibility_enabled 값은 OFF인데 활성 서비스가 존재합니다. 기기/OS 특성 또는 파싱 차이일 수 있어 재확인이 필요합니다.'
                    });
                }

                return { ok: true, items };
            } catch (err) {
                return { ok: false, error: err.message, items: [] };
            }
        },

        // ---------------------------------------------------------
        // ✅ Apply device security action (best-effort)
        // ---------------------------------------------------------
        async setDeviceSecuritySetting(serial, settingId, enabled) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 안 됨');
                const target = serial || devices[0].id;

                const on = enabled ? '1' : '0';
                const id = String(settingId || '');

                // Some settings require WRITE_SECURE_SETTINGS (usually granted to shell on userdebug/eng).
                // We'll try best-effort and return a friendly error if blocked.
                if (id === 'devOptions') {
                    // Some devices mirror this in secure as well.
                    try { await service.adbShellWithTimeout(target, `settings put global development_settings_enabled ${on}`); } catch (_e) { }
                    try { await service.adbShellWithTimeout(target, `settings put secure development_settings_enabled ${on}`); } catch (_e) { }
                    return { ok: true, changed: true, settingId: id, enabled: !!enabled };
                }
                if (id === 'usbDebug') {
                    // Best-effort: settings provider + usb functions fallback.
                    try { await service.adbShellWithTimeout(target, `settings put global adb_enabled ${on}`); } catch (_e) { }
                    try { await service.adbShellWithTimeout(target, `settings put secure adb_enabled ${on}`); } catch (_e) { }
                    // Some OEMs require adjusting usb functions to actually drop adb.
                    if (!enabled) {
                        try { await service.adbShellWithTimeout(target, `svc usb setFunctions mtp`); } catch (_e) { }
                        try { await service.adbShellWithTimeout(target, `svc usb setFunctions none`); } catch (_e) { }
                    }
                    return { ok: true, changed: true, settingId: id, enabled: !!enabled };
                }
                if (id === 'wifiDebug') {
                    // Some devices store this in global, others in secure. Try both.
                    try {
                        await service.adbShellWithTimeout(target, `settings put global adb_wifi_enabled ${on}`);
                    } catch (_e) {
                        // ignore
                    }
                    try {
                        await service.adbShellWithTimeout(target, `settings put secure adb_wifi_enabled ${on}`);
                    } catch (_e) {
                        // ignore
                    }
                    return { ok: true, changed: true, settingId: id, enabled: !!enabled };
                }

                if (id === 'securityAutoBlock') {
                    // Best-effort: "app verification / play protect" style toggles.
                    // NOTE: OEM features (e.g., Samsung Auto Blocker) may not be controllable via ADB settings.
                    // We still try common keys to improve the odds.
                    const cmds = [
                        `settings put global package_verifier_enable ${on}`,
                        `settings put secure package_verifier_enable ${on}`,
                        `settings put global verifier_verify_adb_installs ${on}`,
                        `settings put secure verifier_verify_adb_installs ${on}`,
                    ];
                    for (const c of cmds) {
                        try { await service.adbShellWithTimeout(target, c); } catch (_e) { }
                    }
                    return { ok: true, changed: true, settingId: id, enabled: !!enabled };
                }

                return { ok: false, error: `지원하지 않는 설정입니다: ${id}` };
            } catch (err) {
                return { ok: false, error: err?.message || String(err) };
            }
        },

        // ---------------------------------------------------------
        // ✅ Open Android Settings screen via ADB (best-effort)
        // ---------------------------------------------------------
        async openAndroidSettings(serial, screen) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 안 됨');
                const target = serial || devices[0].id;

                const s = String(screen || '').toUpperCase();
                // Default fallback
                let intent = 'android.settings.SETTINGS';

                if (s === 'DEVELOPER_OPTIONS') intent = 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS';
                else if (s === 'ACCESSIBILITY_SETTINGS') intent = 'android.settings.ACCESSIBILITY_SETTINGS';
                else if (s === 'DEVICE_ADMIN_SETTINGS') intent = 'android.settings.DEVICE_ADMIN_SETTINGS';
                else if (s === 'NOTIFICATION_LISTENER_SETTINGS') intent = 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS';
                else if (s === 'UNKNOWN_APP_SOURCES') intent = 'android.settings.MANAGE_UNKNOWN_APP_SOURCES';
                else if (s === 'SECURITY_SETTINGS') intent = 'android.settings.SECURITY_SETTINGS';

                // Best-effort start settings activity (some devices require user/flags)
                try {
                    await service.adbShellWithTimeout(target, `am start --user 0 -W -a ${intent} -f 0x10000000`, 12000);
                } catch (_e) {
                    // Fallback for some Android versions
                    await service.adbShellWithTimeout(target, `cmd activity start-activity --user 0 -W -a ${intent}`, 12000);
                }
                return { ok: true, opened: true, screen: s || 'SETTINGS' };
            } catch (err) {
                return { ok: false, error: err?.message || String(err) };
            }
        },

        // ---------------------------------------------------------
        // ✅ Compatibility action API used by renderer patches
        // action: { kind: 'toggle'|'openSettings', target?, value?, intent? }
        // ---------------------------------------------------------
       async performDeviceSecurityAction(serial, action) {
            try {
                const act = action || {};
                const kind = String(act.kind || '').toLowerCase();

                if (kind === 'opensettings') {
                    const devices = await client.listDevices();
                    if (devices.length === 0) throw new Error('기기 연결 안 됨');
                    const target = serial || devices[0].id;

                    // Prefer explicit component if provided (more reliable on some OEM devices)
                    const component = act.component ? String(act.component).trim() : '';
                    if (component) {
                        try {
                            await service.adbShellWithTimeout(target, `am start --user 0 -W -n ${component} -f 0x10000000`);
                            return { ok: true, opened: true, component };
                        } catch (_e) {
                            try {
                                await service.adbShellWithTimeout(target, `cmd activity start-activity --user 0 -W -n ${component}`);
                                return { ok: true, opened: true, component };
                            } catch (_e2) { /* fallthrough */ }
                        }
                    }

                    // If renderer passes raw intent, use it.
                    const intent = act.intent ? String(act.intent).trim() : '';
                    if (intent) {
                        try {

                            if (intent == 'com.android.settings/.DeviceAdminSettings') {

                                await service.adbShellWithTimeout(target, `am start -n ${intent}`);
                            } else {

                                await service.adbShellWithTimeout(target, `am start --user 0 -W -a ${intent} -f 0x10000000`);
                            }
                        } catch (_e) {
                            await service.adbShellWithTimeout(target, `cmd activity start-activity --user 0 -W -a ${intent}`);
                        }
                        return { ok: true, opened: true, intent };
                    }

                    // Fallback to generic settings
                    return await service.openAndroidSettings(serial, 'SETTINGS');
                }

                if (kind === 'toggle') {
                    const tgt = String(act.target || '').trim();
                    const enabled = act.value === true;
                    // Map legacy targets -> settingId
                    const map = {
                        wifiDebug: 'wifiDebug',
                        usbDebug: 'usbDebug',
                        devOptions: 'devOptions',
                        securityAutoBlock: 'securityAutoBlock',
                    };
                    const settingId = map[tgt] || tgt;
                    return await service.setDeviceSecuritySetting(serial, settingId, enabled);
                }

                return { ok: false, error: 'INVALID_ACTION' };
            } catch (err) {
                return { ok: false, error: err?.message || String(err) };
            }
        },

        // ---------------------------------------------------------
        // ✅ [Helper] 접근성(Accessibility) 활성 서비스 패키지 목록
        // dumpsys accessibility 출력에서 Enabled services / Enabled Accessibility Services 항목을 파싱합니다.
        async getEnabledAccessibilityPackages(serial) {
            try {
                const raw = await service.adbShell(serial, 'dumpsys accessibility');
                if (!raw) return new Set();

                const pkgs = new Set();
                const lines = raw.split(/\r?\n/);

                // "Enabled services:" 블록 이후에 컴포넌트 라인이 여러 줄 나오는 케이스가 많습니다.
                let inEnabledBlock = false;
                for (const line of lines) {
                    const trimmed = line.trim();

                    if (/^Enabled (Accessibility )?services\s*:/i.test(trimmed)) {
                        inEnabledBlock = true;
                        continue;
                    }

                    // 블록 종료 조건: 다음 섹션 헤더가 나오면 종료
                    if (inEnabledBlock && (/^[A-Z][A-Za-z\s]+:/.test(trimmed) || trimmed.startsWith('m'))) {
                        // dumpsys 출력은 포맷이 다양하므로 너무 공격적으로 끊지 않고,
                        // 빈 줄이거나 다음 섹션처럼 보이는 라인에서만 종료
                        if (trimmed === '' || /^[A-Z][A-Za-z\s]+:/.test(trimmed)) {
                            inEnabledBlock = false;
                        }
                    }

                    if (!inEnabledBlock) continue;

                    // componentName 예: com.example.app/com.example.app.AccessibilityService
                    const m = trimmed.match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.$]+/);
                    if (m && m[1]) pkgs.add(m[1]);
                }

                return pkgs;
            } catch (e) {
                console.warn('⚠️ 접근성 활성 서비스 목록 조회 실패:', e?.message || e);
                return new Set();
            }
        },

        // ---------------------------------------------------------
        // ✅ [Helper] 기기 관리자(Device Admin) 활성 패키지 목록
        // dumpsys device_policy 출력에서 Active admin / Active Admins 항목의 ComponentInfo를 파싱합니다.
        async getActiveDeviceAdminPackages(serial) {
            try {
                const raw = await service.adbShell(serial, 'dumpsys device_policy');
                if (!raw) return new Set();

                const pkgs = new Set();

                // 1) ComponentInfo{com.pkg/.Receiver}
                const re = /ComponentInfo\{([^\/\}\s]+)\//g;
                let match;
                while ((match = re.exec(raw)) !== null) {
                    if (match[1]) pkgs.add(match[1]);
                }

                // 2) 혹시 dumpsys가 다른 포맷이면 dpm list도 시도(지원되는 기기에서만)
                if (pkgs.size === 0) {
                    try {
                        const out = await service.adbShell(serial, 'dpm list active-admins');
                        const lines = String(out || '').split(/\r?\n/);
                        for (const line of lines) {
                            const m = line.trim().match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.$]+/);
                            if (m && m[1]) pkgs.add(m[1]);
                        }
                    } catch (_e) { }
                }

                return pkgs;
            } catch (e) {
                console.warn('⚠️ 기기 관리자 활성 목록 조회 실패:', e?.message || e);
                return new Set();
            }
        },

        // 앱 삭제 (Disable -> Uninstall)
        async uninstallApp(packageName) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 끊김');
                const serial = devices[0].id;

                console.log(`[Android] 삭제 시도 전 기기 관리자 권한 해제 시도: ${packageName}`);

                // 1. [핵심 추가] 기기 관리자 권한 강제 해제 (Active Admin 제거)
                try {
                    await client.shell(serial, `dpm remove-active-admin ${packageName}`);
                } catch (e) {
                    console.log("기기 관리자 권한이 없거나 이미 해제됨");
                }

                // 2. 앱 비활성화 (pm disable)
                const disableCmd = await client.shell(serial, `pm disable-user --user 0 ${packageName}`);
                await adb.util.readAll(disableCmd);

                // 3. 실제 앱 삭제 실행
                try {
                    await client.uninstall(serial, packageName);
                    return { success: true, message: "앱이 완전히 삭제되었습니다." };
                } catch (e) {
                    await client.shell(serial, `pm clear ${packageName}`);
                    throw new Error("일반 삭제 실패, 데이터를 초기화하고 중지시켰습니다.");
                }
            } catch (err) {
                console.error('최종 실패:', err);
                return { success: false, error: err.message };
            }
        },

        // 앱 무력화 (권한 박탈 + 강제 종료)
        async neutralizeApp(packageName) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 끊김');
                const serial = devices[0].id;

                // 권한 조회
                const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
                const dumpStr = (await adb.util.readAll(dumpOutput)).toString();

                const grantedPerms = [];
                const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
                let match;
                while ((match = regex.exec(dumpStr)) !== null) {
                    grantedPerms.push(`android.permission.${match[1]}`);
                }

                // 권한 박탈
                let revokedCount = 0;
                for (const perm of grantedPerms) {
                    try {
                        await client.shell(serial, `pm revoke ${packageName} ${perm}`);
                        revokedCount++;
                    } catch (e) { }
                }
                // 강제 종료
                await client.shell(serial, `am force-stop ${packageName}`);
                return { success: true, count: revokedCount };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // 설치된 앱 목록 (시스템 앱 필터링 강화 버전)
        async getInstalledApps(serial) {
            // 1. 시스템 앱 목록 획득 (가장 정확한 명단)
            const sysOutput = await client.shell(serial, 'pm list packages -s');
            const sysData = await adb.util.readAll(sysOutput);
            const systemPackages = new Set(sysData.toString().trim().split('\n').map(l => l.replace('package:', '').trim()));

            // 2. 전체 앱 목록 및 상세 정보 획득
            const output = await client.shell(serial, 'pm list packages -i -f -U');
            const data = await adb.util.readAll(output);
            const lines = data.toString().trim().split('\n');

            const TRUSTED_INSTALLERS = [
                'com.android.vending', 'com.sec.android.app.samsungapps', 'com.skt.skaf.A000Z00040',
                'com.kt.olleh.storefront', 'com.lguplus.appstore', 'com.google.android.feedback'
            ];

            // 시스템 앱이라고 믿을 수 있는 이름 패턴 (AI 학습 및 필터링용)
            const TRUSTED_PREFIXES = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'com.qualcomm.', 'com.qti.', 'android'];

            return lines.map((line) => {
                if (!line) return null;
                const parts = line.split(/\s+/);
                let packageName = '', apkPath = 'N/A', installer = null, uid = null;

                // [사용자님의 원본 파싱 로직 유지]
                parts.forEach(part => {
                    if (part.includes('=')) {
                        if (part.startsWith('package:')) {
                            const cleanPart = part.replace('package:', '');
                            const splitIdx = cleanPart.lastIndexOf('=');
                            if (splitIdx !== -1) {
                                apkPath = cleanPart.substring(0, splitIdx);
                                packageName = cleanPart.substring(splitIdx + 1);
                            }
                        } else if (part.startsWith('installer=')) {
                            installer = part.replace('installer=', '');
                        }
                    } else if (part.startsWith('uid:')) {
                        uid = part.replace('uid:', '');
                    }
                });

                if (!packageName) return null;

                // --- 여기서부터 AI 전용 필드 계산 (파싱된 값 활용) ---

                let origin = '외부 설치';
                let isSideloaded = true;
                let isSystemApp = false;
                let isMasquerading = false;

                // 1. 시스템 앱 판정 (Set 목록 대조)
                if (systemPackages.has(packageName)) {
                    origin = '시스템 앱';
                    isSideloaded = false;
                    isSystemApp = true;
                }
                // 2. 공식 스토어 판정
                else if (installer && TRUSTED_INSTALLERS.includes(installer)) {
                    origin = '공식 스토어';
                    isSideloaded = false;
                    isSystemApp = false;
                }

                // 3. 위장 앱(Masquerading) 판정 로직
                // 이름은 시스템Prefix인데, 실제 시스템 앱 목록에 없고 스토어 출처도 아닐 때
                const hasTrustedName = TRUSTED_PREFIXES.some(pre => packageName.startsWith(pre));
                if (hasTrustedName && !isSystemApp && isSideloaded) {
                    isMasquerading = true;
                }

                // AI 엔진 및 CSV 추출에 필요한 모든 필드 반환
                return {
                    packageName,
                    apkPath,
                    installer,
                    isSideloaded,
                    isSystemApp,      // AI 학습용 핵심 필드
                    isMasquerading,   // AI 학습용 핵심 필드
                    uid,
                    origin
                };
            }).filter(item => item !== null);
        },

        // 백그라운드 실행 여부 확인
        async checkIsRunningBackground(serial, packageName) {
            try {
                const output = await client.shell(serial, `dumpsys activity services ${packageName}`);
                const data = (await adb.util.readAll(output)).toString();
                return !data.includes('(nothing)') && data.length > 0;
            } catch (e) { return false; }
        },

        // 권한 상세 분석
        async getAppPermissions(serial, packageName) {
            try {
                const output = await client.shell(serial, `dumpsys package ${packageName}`);
                const dumpsys = (await adb.util.readAll(output)).toString();

                const reqMatch = dumpsys.match(/requested permissions:\s*([\s\S]*?)(?:install permissions:|runtime permissions:)/);
                const requestedPerms = new Set();
                if (reqMatch && reqMatch[1]) {
                    reqMatch[1].match(/android\.permission\.[A-Z_]+/g)?.forEach(p => requestedPerms.add(p));
                }

                const grantedPerms = new Set();
                const installMatch = dumpsys.match(/install permissions:\s*([\s\S]*?)(?:runtime permissions:|\n\n)/);
                if (installMatch && installMatch[1]) {
                    installMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)?.forEach(p => grantedPerms.add(p.split(':')[0]));
                }
                const runtimeMatch = dumpsys.match(/runtime permissions:\s*([\s\S]*?)(?:Dex opt state:|$)/);
                if (runtimeMatch && runtimeMatch[1]) {
                    runtimeMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)?.forEach(p => grantedPerms.add(p.split(':')[0]));
                }

                const componentPattern = new RegExp(`${packageName.replace(/\./g, '\\.')}/[\\w\\.]+\\.[\\w\\.]+`, 'g');
                const matches = dumpsys.match(componentPattern) || [];
                const uniqueCount = [...new Set(matches)].length;

                return {
                    allPermissionsGranted: requestedPerms.size > 0 && [...requestedPerms].every(p => grantedPerms.has(p)),
                    requestedList: Array.from(requestedPerms),
                    grantedList: Array.from(grantedPerms),
                    servicesCount: Math.max(1, Math.ceil(uniqueCount / 2)),
                    receiversCount: Math.floor(uniqueCount / 2)
                };
            } catch (e) {
                return { requestedList: [], grantedList: [], servicesCount: 0, receiversCount: 0 };
            }
        },

        // 네트워크 사용량 (UID 기반)
        async getNetworkUsageMap(serial) {
            const usageMap = {};
            try {
                // 💡 방법 1: dumpsys netstats detail (기존 방식 유지)
                let data = '';
                try {
                    const output = await client.shell(serial, 'dumpsys netstats detail');
                    data = (await adb.util.readAll(output)).toString();
                } catch (e) {
                    console.warn('⚠️ dumpsys netstats detail 실패, 대체 명령어 시도.');
                }

                // 💡 방법 2: /proc/net/xt_qtaguid/stats 파일 직접 읽기 (루팅 필요하거나 접근이 막힐 수 있음)
                if (data.length === 0) {
                    try {
                        const output = await client.shell(serial, 'cat /proc/net/xt_qtaguid/stats');
                        data = (await adb.util.readAll(output)).toString();
                    } catch (e) {
                        console.warn('⚠️ /proc/net/xt_qtaguid/stats 접근 실패.');
                    }
                }

                let currentUid = null;

                data.split('\n').forEach(line => {
                    const trimmedLine = line.trim();

                    // 1. UID 식별자 (ident=...) 찾기
                    if (trimmedLine.startsWith('ident=')) {
                        const uidMatch = trimmedLine.match(/uid=(\d+)/);
                        if (uidMatch) {
                            currentUid = uidMatch[1];
                            if (!usageMap[currentUid]) {
                                usageMap[currentUid] = { rx: 0, tx: 0 };
                            }
                        } else {
                            currentUid = null;
                        }
                    }
                    // 2. NetworkStatsHistory 버킷 찾기 (rb=... tb=...)
                    else if (currentUid && trimmedLine.startsWith('st=')) {
                        const rbMatch = trimmedLine.match(/rb=(\d+)/);
                        const tbMatch = trimmedLine.match(/tb=(\d+)/);

                        if (rbMatch && tbMatch) {
                            const rxBytes = parseInt(rbMatch[1], 10) || 0;
                            const txBytes = parseInt(tbMatch[1], 10) || 0;

                            usageMap[currentUid].rx += rxBytes;
                            usageMap[currentUid].tx += txBytes;
                        }
                    }
                });

            } catch (e) {
                // ... (오류 처리 로직 유지) ...
            }
            return usageMap;
        },

        // APK 파일 검색
        async findApkFiles(serial) {

            // 💡 경로 중복 제거: /sdcard와 /storage/emulated/0는 같은 곳입니다.
            // 하나만 남기거나, 결과에서 경로 중복을 체크해야 합니다.
            const searchPaths = ['/sdcard/Download', '/data/local/tmp'];
            let allApkData = [];
            const seenPaths = new Set(); // 💡 중복 체크를 위한 세트

            for (const searchPath of searchPaths) {
                try {
                    const command = `find "${searchPath}" -type f -iname "*.apk" -exec ls -ld {} + 2>/dev/null`;
                    const output = await client.shell(serial, command);
                    const data = (await adb.util.readAll(output)).toString().trim();

                    if (!data) continue;

                    const lines = data.split('\n');
                    for (const line of lines) {
                        const parts = line.split(/\s+/);
                        if (parts.length < 7) continue;

                        const filePath = parts[parts.length - 1];

                        if (seenPaths.has(filePath)) continue;
                        seenPaths.add(filePath);

                        const timePart = parts[parts.length - 2];
                        const datePart = parts[parts.length - 3];
                        const rawSize = parts[parts.length - 4];

                        const fileName = filePath.split('/').pop();
                        const sizeNum = parseInt(rawSize);
                        const formattedSize = isNaN(sizeNum) ? "분석 중" : (sizeNum / (1024 * 1024)).toFixed(2) + " MB";

                        allApkData.push({
                            packageName: fileName,
                            apkPath: filePath,
                            fileSize: formattedSize,
                            installDate: `${datePart} ${timePart}`,
                            isApkFile: true,
                            isRunningBg: false,
                            isSideloaded: true,
                            requestedCount: 3,
                            requestedList: ['android.permission.INTERNET', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.REQUEST_INSTALL_PACKAGES']
                        });
                    }
                } catch (e) {
                    console.error(`${searchPath} 검색 실패:`, e.message);
                }
            }
            return allApkData;
        },

        // 의심 앱 필터링 로직
        filterSuspiciousApps(apps) {
            const SENSITIVE = [
                'android.permission.RECORD_AUDIO', 'android.permission.READ_CONTACTS',
                'android.permission.ACCESS_FINE_LOCATION', 'android.permission.READ_PHONE_STATE',
                'android.permission.CALL_PHONE', 'android.permission.CAMERA',
                'android.permission.READ_CALL_LOG', 'android.permission.READ_SMS',
                'android.permission.RECEIVE_SMS', 'android.permission.SEND_SMS',
                'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.BIND_DEVICE_ADMIN',
                'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
                'android.permission.ACCESS_BACKGROUND_LOCATION',
                'android.permission.FOREGROUND_SERVICE',
                'android.permission.WAKE_LOCK',
                'android.permission.SYSTEM_ALERT_WINDOW',
                'android.permission.QUERY_ALL_PACKAGES',
                'android.permission.GET_TASKS'
            ];
            const ALARM = ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM', 'com.android.alarm.permission.SET_ALARM'];
            const SAFE_PREFIX = ['com.samsung.', 'com.sec.', 'com.qualcomm.', 'com.sktelecom.', 'com.kt.', 'com.lgu.', 'uplus.', 'lgt.', 'com.facebook.', 'com.instagram.', 'com.twitter.', 'com.kakao.', 'jp.naver.'];

            return apps.filter(app => {
                if (SAFE_PREFIX.some(p => app.packageName.startsWith(p))) return false;
                if (!app.isSideloaded) return false; //외부설치
                if (!app.isRunningBg) return false; //백그라운드

                const perms = app.requestedList || [];
                const hasSensitive = perms.some(p => SENSITIVE.includes(p));
                const hasAlarm = perms.some(p => ALARM.includes(p));

                if (hasSensitive && !hasAlarm) {
                    const caught = perms.filter(p => SENSITIVE.includes(p));
                    const shortNames = caught.map(p => p.split('.').pop()).slice(0, 3);
                    app.reason = `행동 탐지: 외부 설치 + [${shortNames.join(', ')}...]`;
                    return true;
                }
                return false;
            });
        },

        // VirusTotal 검사 로직
        async runVirusTotalCheck(serial, suspiciousApps) {
            for (const app of suspiciousApps) {
                try {
                    if (!app.apkPath || app.apkPath === 'N/A') continue;
                    const tempPath = path.join(os.tmpdir(), `${app.packageName}.apk`);

                    // 다운로드
                    const transfer = await client.pull(serial, app.apkPath);
                    await new Promise((resolve, reject) => {
                        const fn = fs.createWriteStream(tempPath);
                        transfer.on('end', () => fn.end());
                        transfer.on('error', reject);
                        fn.on('finish', resolve);
                        transfer.pipe(fn);
                    });

                    // 해시 계산
                    const fileBuffer = fs.readFileSync(tempPath);
                    const hashSum = crypto.createHash('sha256');
                    hashSum.update(fileBuffer);
                    const sha256 = hashSum.digest('hex');
                    console.log(`[VT] 해시(${app.packageName}): ${sha256}`);

                    // API 조회
                    const vtResult = await Utils.checkVirusTotal(sha256);
                    app.vtResult = vtResult;

                    if (vtResult && vtResult.malicious > 0) {
                        app.reason = `[VT 확진] 악성(${vtResult.malicious}/${vtResult.total}) + ` + app.reason;
                    } else if (vtResult && vtResult.not_found) {
                        app.reason = `[개인정보 유출 위협] ` + app.reason;
                    }
                    fs.unlinkSync(tempPath);
                } catch (e) {
                    console.error(`VT 검사 오류 (${app.packageName})`)
                    app.vtResult = { error: "검사 불가" };
                }
            }
        },

        async getApkPermissionsOnly(serial, remotePath) {
            let tempPath = null;
            try {
                // 1. 임시 파일 경로 설정
                tempPath = path.join(os.tmpdir(), `extract_${Date.now()}.apk`);

                // 2. ADB Pull로 기기 내 APK를 PC 임시 폴더로 복사
                const transfer = await client.pull(serial, remotePath);
                await new Promise((resolve, reject) => {
                    const fn = fs.createWriteStream(tempPath);
                    transfer.on('end', () => fn.end());
                    transfer.on('error', reject);
                    fn.on('finish', resolve);
                    transfer.pipe(fn);
                });

                // 3. APK Manifest 읽기
                const reader = await ApkReader.open(tempPath);
                const manifest = await reader.readManifest();

                // 4. 권한 리스트 추출
                const permissions = (manifest.usesPermissions || []).map(p => p.name);

                // 5. 임시 파일 삭제
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

                return permissions;
            } catch (e) {
                console.error(`APK 권한 추출 실패 (${remotePath}):`, e);
                if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                return [];
            }
        }

        ,
        // -------------------------------------------------
        // Live dashboard data (battery/memory/temp/top/spec)
        // -------------------------------------------------
        async getDashboardData(serial) {
            // Resolve serial if not provided
            let targetSerial = serial;
            if (!targetSerial) {
                const devices = await client.listDevices();
                targetSerial = devices?.[0]?.id;
            }
            if (!targetSerial) {
                return { ok: false, error: 'NO_DEVICE' };
            }

            const readShell = async (cmd) => {
                const stream = await client.shell(targetSerial, cmd);
                const buf = await adb.util.readAll(stream);
                return buf.toString('utf8');
            };

            // Battery (dumpsys battery)
            const batteryOut = await readShell('dumpsys battery');
            const levelMatch = batteryOut.match(/level:\s*(\d+)/i);
            const tempMatch = batteryOut.match(/temperature:\s*(\d+)/i);
            const batteryLevel = levelMatch ? parseInt(levelMatch[1], 10) : null;
            // temperature is usually in tenths of a degree C
            const deviceTempC = tempMatch ? (parseInt(tempMatch[1], 10) / 10) : null;

            // Memory (MemTotal/MemAvailable)
            const memOut = await readShell('cat /proc/meminfo');
            const totalMatch = memOut.match(/MemTotal:\s*(\d+)\s*kB/i);
            const availMatch = memOut.match(/MemAvailable:\s*(\d+)\s*kB/i);
            let memUsagePercent = null;
            if (totalMatch && availMatch) {
                const total = parseInt(totalMatch[1], 10);
                const avail = parseInt(availMatch[1], 10);
                if (total > 0) {
                    memUsagePercent = Math.round(((total - avail) / total) * 100);
                }
            }

            // Spec (getprop)
            const getprop = async (key) => (await readShell(`getprop ${key}`)).trim();
            const model = await getprop('ro.product.model');
            const abi = await getprop('ro.product.cpu.abi');
            const androidVer = await getprop('ro.build.version.release');
            // Rooted check (best-effort)
            let rooted = 'SAFE';
            try {
                const suOut = (await readShell('which su')).trim();
                if (suOut) rooted = 'ROOTED';
            } catch (_) {
                rooted = 'UNKNOWN';
            }

            // Top processes (best-effort)
            let topText = '';
            try {
                topText = await readShell('toybox top -b -n 1 -m 6 -o %CPU');
            } catch (e) {
                try {
                    topText = await readShell('top -b -n 1 | head -n 25');
                } catch (_) {
                    topText = '';
                }
            }

            const top = [];
            // Parse common top format: PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ ARGS
            const lines = topText.split(/\r?\n/);
            for (const line of lines) {
                const m = line.trim().match(/^(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+([0-9.]+)\s+([0-9.]+)\s+\S+\s+(.+)$/);
                if (m) {
                    top.push({ pid: m[1], cpu: m[2], mem: m[3], name: m[4] });
                    if (top.length >= 5) break;
                }
            }

            return {
                ok: true,
                serial: targetSerial,
                metrics: { batteryLevel, memUsagePercent, deviceTempC },
                spec: {
                    model: model || '-',
                    abi: abi || '-',
                    android: androidVer ? `Android ${androidVer}` : 'ANDROID',
                    serial: targetSerial,
                    rooted
                },
                top
            };
        }
    };
    return service;
}

module.exports = { createAndroidService };
