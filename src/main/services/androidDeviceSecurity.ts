type AdbClientLike = {
    listDevices(): Promise<Array<{ id: string }>>;
};

export function createAndroidDeviceSecurityHelpers({
    client,
    adbShell,
    adbShellWithTimeout
}: {
    client: AdbClientLike;
    adbShell(serial: string, cmd: string): Promise<string>;
    adbShellWithTimeout(serial: string, cmd: string, timeoutMs?: number): Promise<string>;
}) {
    async function getEnabledAccessibilityPackages(serial: string) {
        try {
            const raw = await adbShell(serial, 'dumpsys accessibility');
            if (!raw) return new Set<string>();

            const pkgs = new Set<string>();
            const lines = raw.split(/\r?\n/);
            let inEnabledBlock = false;

            for (const line of lines) {
                const trimmed = line.trim();

                if (/^Enabled (Accessibility )?services\s*:/i.test(trimmed)) {
                    inEnabledBlock = true;
                    continue;
                }

                if (inEnabledBlock && (/^[A-Z][A-Za-z\s]+:/.test(trimmed) || trimmed.startsWith('m'))) {
                    if (trimmed === '' || /^[A-Z][A-Za-z\s]+:/.test(trimmed)) {
                        inEnabledBlock = false;
                    }
                }

                if (!inEnabledBlock) continue;

                const match = trimmed.match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.$]+/);
                if (match && match[1]) pkgs.add(match[1]);
            }

            return pkgs;
        } catch (error) {
            console.warn('⚠️ 접근성 활성 서비스 목록 조회 실패:', (error as Error)?.message || error);
            return new Set<string>();
        }
    }

    async function getActiveDeviceAdminPackages(serial: string) {
        try {
            const raw = await adbShell(serial, 'dumpsys device_policy');
            if (!raw) return new Set<string>();

            const pkgs = new Set<string>();
            const re = /ComponentInfo\{([^\/\}\s]+)\//g;
            let match: RegExpExecArray | null;
            while ((match = re.exec(raw)) !== null) {
                if (match[1]) pkgs.add(match[1]);
            }

            if (pkgs.size === 0) {
                try {
                    const out = await adbShell(serial, 'dpm list active-admins');
                    const lines = String(out || '').split(/\r?\n/);
                    for (const line of lines) {
                        const componentMatch = line.trim().match(/([a-zA-Z0-9_\.]+)\/[a-zA-Z0-9_\.$]+/);
                        if (componentMatch && componentMatch[1]) pkgs.add(componentMatch[1]);
                    }
                } catch (_e) { }
            }

            return pkgs;
        } catch (error) {
            console.warn('⚠️ 기기 관리자 활성 목록 조회 실패:', (error as Error)?.message || error);
            return new Set<string>();
        }
    }

    async function getDeviceSecurityStatus(serial: string) {
        try {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 안 됨');
            const target = serial || devices[0].id;

            const getSetting = async (namespace: string, key: string) => {
                try {
                    const out = await adbShellWithTimeout(target, `settings get ${namespace} ${key}`);
                    if (!out || out === 'null' || out === 'undefined') return null;
                    return out.trim();
                } catch (_e) {
                    return null;
                }
            };

            const asBool = (value: unknown) => {
                if (value == null) return null;
                const s = String(value).trim();
                if (s === '1' || s.toLowerCase() === 'true') return true;
                if (s === '0' || s.toLowerCase() === 'false') return false;
                return null;
            };

            const devOpt = asBool(await getSetting('global', 'development_settings_enabled'));
            const usbDebug = asBool(await getSetting('global', 'adb_enabled'));
            const wifiDebug = asBool(await getSetting('global', 'adb_wifi_enabled')) ?? asBool(await getSetting('secure', 'adb_wifi_enabled'));
            const unknownSources = asBool(await getSetting('secure', 'install_non_market_apps'));
            const a11yEnabled = asBool(await getSetting('secure', 'accessibility_enabled'));
            const enabledA11yPkgs = await getEnabledAccessibilityPackages(target);
            const activeAdminPkgs = await getActiveDeviceAdminPackages(target);
            const notifListenersRaw = await getSetting('secure', 'enabled_notification_listeners');
            const notifListenerPkgs = new Set<string>();

            if (notifListenersRaw) {
                String(notifListenersRaw).split(':').forEach((entry) => {
                    const match = entry.trim().match(/^([a-zA-Z0-9_\.]+)\//);
                    if (match && match[1]) notifListenerPkgs.add(match[1]);
                });
            }

            const items: Array<Record<string, unknown>> = [];

            const buildActions = (id: string, boolVal: boolean | null) => {
                if (id === 'wifiDebug') {
                    const actions = [];
                    if (boolVal === true) {
                        actions.push({ kind: 'toggle', label: '끄기', target: 'wifiDebug', value: false });
                    }
                    actions.push({ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS' });
                    return actions;
                }
                if (id === 'devOptions' || id === 'usbDebug') return [];
                if (id === 'unknownSources') return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.MANAGE_UNKNOWN_APP_SOURCES' }];
                if (id === 'accessibility') return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.ACCESSIBILITY_SETTINGS' }];
                if (id === 'deviceAdmin') return [{ kind: 'openSettings', label: '설정 열기', intent: 'com.android.settings/.DeviceAdminSettings' }];
                if (id === 'notificationAccess') return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS' }];
                return [{ kind: 'openSettings', label: '설정 열기', intent: 'android.settings.SETTINGS' }];
            };

            const push = (
                id: string,
                title: string,
                boolVal: boolean | null,
                {
                    levelOn = 'warn',
                    levelOff = 'ok',
                    unknown = 'unknown',
                    detailOn = '',
                    detailOff = '',
                    note
                }: {
                    levelOn?: string;
                    levelOff?: string;
                    unknown?: string;
                    detailOn?: string;
                    detailOff?: string;
                    note?: string;
                } = {}
            ) => {
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
        } catch (error) {
            return { ok: false, error: (error as Error).message, items: [] };
        }
    }

    async function setDeviceSecuritySetting(serial: string, settingId: string, enabled: boolean) {
        try {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 안 됨');
            const target = serial || devices[0].id;
            const on = enabled ? '1' : '0';
            const id = String(settingId || '');

            if (id === 'devOptions') {
                try { await adbShellWithTimeout(target, `settings put global development_settings_enabled ${on}`); } catch (_e) { }
                try { await adbShellWithTimeout(target, `settings put secure development_settings_enabled ${on}`); } catch (_e) { }
                return { ok: true, changed: true, settingId: id, enabled: !!enabled };
            }
            if (id === 'usbDebug') {
                try { await adbShellWithTimeout(target, `settings put global adb_enabled ${on}`); } catch (_e) { }
                try { await adbShellWithTimeout(target, `settings put secure adb_enabled ${on}`); } catch (_e) { }
                if (!enabled) {
                    try { await adbShellWithTimeout(target, 'svc usb setFunctions mtp'); } catch (_e) { }
                    try { await adbShellWithTimeout(target, 'svc usb setFunctions none'); } catch (_e) { }
                }
                return { ok: true, changed: true, settingId: id, enabled: !!enabled };
            }
            if (id === 'wifiDebug') {
                try { await adbShellWithTimeout(target, `settings put global adb_wifi_enabled ${on}`); } catch (_e) { }
                try { await adbShellWithTimeout(target, `settings put secure adb_wifi_enabled ${on}`); } catch (_e) { }
                return { ok: true, changed: true, settingId: id, enabled: !!enabled };
            }
            if (id === 'securityAutoBlock') {
                const cmds = [
                    `settings put global package_verifier_enable ${on}`,
                    `settings put secure package_verifier_enable ${on}`,
                    `settings put global verifier_verify_adb_installs ${on}`,
                    `settings put secure verifier_verify_adb_installs ${on}`
                ];
                for (const cmd of cmds) {
                    try { await adbShellWithTimeout(target, cmd); } catch (_e) { }
                }
                return { ok: true, changed: true, settingId: id, enabled: !!enabled };
            }
            return { ok: false, error: `지원하지 않는 설정입니다: ${id}` };
        } catch (error) {
            return { ok: false, error: (error as Error)?.message || String(error) };
        }
    }

    async function openAndroidSettings(serial: string, screen: string) {
        try {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 안 됨');
            const target = serial || devices[0].id;

            const normalized = String(screen || '').toUpperCase();
            let intent = 'android.settings.SETTINGS';
            if (normalized === 'DEVELOPER_OPTIONS') intent = 'android.settings.APPLICATION_DEVELOPMENT_SETTINGS';
            else if (normalized === 'ACCESSIBILITY_SETTINGS') intent = 'android.settings.ACCESSIBILITY_SETTINGS';
            else if (normalized === 'DEVICE_ADMIN_SETTINGS') intent = 'android.settings.DEVICE_ADMIN_SETTINGS';
            else if (normalized === 'NOTIFICATION_LISTENER_SETTINGS') intent = 'android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS';
            else if (normalized === 'UNKNOWN_APP_SOURCES') intent = 'android.settings.MANAGE_UNKNOWN_APP_SOURCES';
            else if (normalized === 'SECURITY_SETTINGS') intent = 'android.settings.SECURITY_SETTINGS';

            try {
                await adbShellWithTimeout(target, `am start --user 0 -W -a ${intent} -f 0x10000000`, 12000);
            } catch (_e) {
                await adbShellWithTimeout(target, `cmd activity start-activity --user 0 -W -a ${intent}`, 12000);
            }

            return { ok: true, opened: true, screen: normalized || 'SETTINGS' };
        } catch (error) {
            return { ok: false, error: (error as Error)?.message || String(error) };
        }
    }

    async function performDeviceSecurityAction(serial: string, action: Record<string, unknown>) {
        try {
            const act = action || {};
            const kind = String(act.kind || '').toLowerCase();

            if (kind === 'opensettings') {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 안 됨');
                const target = serial || devices[0].id;

                const component = act.component ? String(act.component).trim() : '';
                if (component) {
                    try {
                        await adbShellWithTimeout(target, `am start --user 0 -W -n ${component} -f 0x10000000`);
                        return { ok: true, opened: true, component };
                    } catch (_e) {
                        try {
                            await adbShellWithTimeout(target, `cmd activity start-activity --user 0 -W -n ${component}`);
                            return { ok: true, opened: true, component };
                        } catch (_e2) { }
                    }
                }

                const intent = act.intent ? String(act.intent).trim() : '';
                if (intent) {
                    try {
                        if (intent === 'com.android.settings/.DeviceAdminSettings') {
                            await adbShellWithTimeout(target, `am start -n ${intent}`);
                        } else {
                            await adbShellWithTimeout(target, `am start --user 0 -W -a ${intent} -f 0x10000000`);
                        }
                    } catch (_e) {
                        await adbShellWithTimeout(target, `cmd activity start-activity --user 0 -W -a ${intent}`);
                    }
                    return { ok: true, opened: true, intent };
                }

                return openAndroidSettings(serial, 'SETTINGS');
            }

            if (kind === 'toggle') {
                const targetName = String(act.target || '').trim();
                const enabled = act.value === true;
                const map: Record<string, string> = {
                    wifiDebug: 'wifiDebug',
                    usbDebug: 'usbDebug',
                    devOptions: 'devOptions',
                    securityAutoBlock: 'securityAutoBlock'
                };
                const settingId = map[targetName] || targetName;
                return setDeviceSecuritySetting(serial, settingId, enabled);
            }

            return { ok: false, error: 'INVALID_ACTION' };
        } catch (error) {
            return { ok: false, error: (error as Error)?.message || String(error) };
        }
    }

    return {
        getDeviceSecurityStatus,
        setDeviceSecuritySetting,
        openAndroidSettings,
        performDeviceSecurityAction,
        getEnabledAccessibilityPackages,
        getActiveDeviceAdminPackages
    };
}
