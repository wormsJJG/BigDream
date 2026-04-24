import type { PrivacyThreatCard, RiskLevel, RiskReason, RiskRecommendation } from '../../shared/risk/riskRules';
import * as riskRulesModule from '../../shared/risk/riskRules.js';
import * as spywareFinalFilterModule from '../../shared/spyware/spywareFinalFilter.js';
import { createAndroidDeviceSecurityHelpers } from './androidDeviceSecurity.js';
import { createAndroidAppInventoryHelpers } from './androidAppInventory.js';
import { createAndroidScanAnalysisHelpers } from './androidScanAnalysis.js';
import { createAndroidScanPreparationHelpers } from './androidScanPreparation.js';
import type { SpywareFinalVerdict } from '../../shared/spyware/spywareFinalFilter';
import type { AndroidClassifiedAppsResult, AndroidPrivacyThreatApp } from './androidScanAnalysis';

type AdbReadableLike = {
    on(event: string, handler: (...args: unknown[]) => void): void;
    pipe(target: NodeJS.WritableStream): void;
};

type AdbShellOutput = AdbReadableLike;

type AdbClientLike = {
    listDevices(): Promise<Array<{ id: string; type?: string }>>;
    shell(serial: string, cmd: string): Promise<AdbShellOutput>;
    uninstall(serial: string, packageName: string): Promise<void>;
    pull?(serial: string, remotePath: string): Promise<AdbReadableLike>;
};
type AdbLike = {
    util: {
        readAll(stream: AdbShellOutput): Promise<Buffer>;
    };
};
type ApkReaderLike = {
    open(path: string): Promise<{
        readManifest(): Promise<{
            usesPermissions?: Array<{ name: string }>;
            package?: string;
            packageName?: string;
        }>;
    }>;
};
type FileSystemLike = {
    createWriteStream?(path: string): NodeJS.WritableStream;
    readFileSync(path: string): Buffer;
    unlinkSync(path: string): void;
    existsSync?(path: string): boolean;
};
type PathLike = {
    join(...parts: string[]): string;
};
type OsLike = {
    tmpdir(): string;
};
type CryptoLike = {
    createHash(algorithm: string): {
        update(data: Buffer): void;
        digest(encoding: 'hex'): string;
    };
};
type LogLike = {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
};
type ExecLike = (...args: unknown[]) => unknown;
type ConfigLike = {
    PATHS?: Record<string, string>;
};
type UtilsLike = {
    checkVirusTotal?(fileHash: string): Promise<VirusTotalResult>;
};

type AnalyzeStaticModelPayload = {
    packageName?: string;
    permissions?: string[];
    isSideloaded?: boolean;
    isSystemPath?: boolean;
    isMasquerading?: boolean;
    services_cnt?: number;
    receivers_cnt?: number;
};

type AnalyzeStaticModel = ((payload: AnalyzeStaticModelPayload) => Promise<{
    score: number;
    grade: string;
    reason: string;
}>) | undefined;

type VirusTotalResult = {
    malicious?: number;
    total?: number;
    not_found?: boolean;
    error?: string;
};

export type AndroidDeviceInfo = {
    model: string;
    serial: string;
    isRooted?: boolean;
    phoneNumber?: string;
    os?: string;
    [key: string]: unknown;
};

export type AndroidAppRecord = Record<string, unknown> & {
    packageName: string;
    cachedTitle?: string;
    uid?: string | number;
    installer?: string | null;
    isSideloaded?: boolean;
    isRunningBg?: boolean;
    riskLevel?: RiskLevel;
    riskReasons?: RiskReason[];
    recommendation?: RiskRecommendation[];
    aiNarration?: string;
    reason?: string;
    vtResult?: VirusTotalResult;
};

type AndroidAppPermissionData = {
    requestedList?: string[];
    grantedList?: string[];
    servicesCount?: number;
    receiversCount?: number;
    [key: string]: unknown;
};

export type AndroidDashboardData = {
    ok?: boolean;
    error?: string;
    metrics?: {
        batteryLevel?: number | null;
        memUsagePercent?: number | null;
        deviceTempC?: number | null;
    };
    spec?: {
        model?: string;
        abi?: string;
        android?: string;
        serial?: string;
        rooted?: string;
    };
    top?: Array<{
        pid: string;
        cpu: string;
        mem: string;
        name: string;
    }>;
    serial?: string;
};

type AndroidNetworkUsageMap = Record<string | number, { rx: number; tx: number }>;

export type AndroidDeleteApkResult = {
    success: boolean;
    message?: string;
    error?: string;
};

export type AndroidUninstallResult = {
    success: boolean;
    message?: string;
    error?: string;
};

export type AndroidNeutralizeResult = {
    success: boolean;
    count?: number;
    error?: string;
};

type AndroidOpenSettingsResult = {
    success: boolean;
    output?: string;
    error?: string;
};

export type AndroidSecurityItem = {
    id: string;
    title: string;
    status: string;
    level: string;
    detail?: string;
    note?: string;
};

export type AndroidDeviceSecurityStatus = {
    ok: boolean;
    items: AndroidSecurityItem[];
    error?: string;
};

export type AndroidSecurityActionResult = {
    ok?: boolean;
    success?: boolean;
    changed?: boolean;
    opened?: boolean;
    settingId?: string;
    enabled?: boolean;
    screen?: string;
    message?: string;
    error?: string;
    output?: string;
    [key: string]: unknown;
};

export type AndroidSecurityActionPayload =
    | string
    | {
        kind?: string;
        label?: string;
        target?: string;
        value?: string | boolean | number | null;
        intent?: string;
        component?: string;
        action?: string;
        settingId?: string;
        enabled?: boolean;
        screen?: string;
    };

export type AndroidConnectionStatus =
    | { status: 'disconnected' }
    | { status: 'unauthorized' }
    | { status: 'offline' }
    | { status: 'connected'; model: string }
    | { status: 'error'; error: string };

export type AndroidScanResult = {
    deviceInfo?: AndroidDeviceInfo;
    allApps?: AndroidAppRecord[];
    suspiciousApps?: AndroidAppRecord[];
    privacyThreatApps?: AndroidPrivacyThreatApp[];
    apkFiles?: ApkFileRecord[];
    runningCount?: number;
    error?: string;
};

export type ApkFileRecord = Record<string, unknown> & {
    apkPath: string;
    packageName?: string;
    requestedList?: string[];
    requestedCount?: number;
    installStatus?: string;
};

type AndroidDeviceSecurityHelpers = {
    getDeviceSecurityStatus(serial?: string): Promise<AndroidDeviceSecurityStatus>;
    setDeviceSecuritySetting(serial?: string, settingId?: string, enabled?: boolean): Promise<AndroidSecurityActionResult>;
    openAndroidSettings(serial?: string, screen?: string): Promise<AndroidSecurityActionResult>;
    performDeviceSecurityAction(serial?: string, action?: AndroidSecurityActionPayload): Promise<AndroidSecurityActionResult>;
    getEnabledAccessibilityPackages(serial: string): Promise<Set<string>>;
    getActiveDeviceAdminPackages(serial: string): Promise<Set<string>>;
};

type AndroidAppInventoryHelpers = {
    getInstalledApps(serial: string): Promise<AndroidAppRecord[]>;
    getAppInstallTime(serial: string, packageName: string): Promise<string | null>;
    checkIsRunningBackground(serial: string, packageName: string): Promise<boolean>;
    getAppPermissions(serial: string, packageName: string): Promise<AndroidAppPermissionData>;
    getNetworkUsageMap(serial: string): Promise<AndroidNetworkUsageMap>;
    findApkFiles(serial: string): Promise<ApkFileRecord[]>;
    getApkPermissionsOnly(serial: string, remotePath: string): Promise<string[]>;
};

type AndroidScanAnalysisHelpers = {
    analyzeInstalledApps(payload: {
        serial: string;
        allApps: AndroidAppRecord[];
        networkMap: AndroidNetworkUsageMap;
        enabledA11yPkgs: Set<string>;
        activeAdminPkgs: Set<string>;
    }): Promise<AndroidAppRecord[]>;
    classifyAnalyzedApps(processedApps: AndroidAppRecord[]): {
        processedApps: AndroidAppRecord[];
        suspiciousApps: AndroidAppRecord[];
        privacyThreatApps: AndroidPrivacyThreatApp[];
        runningCount: number;
    };
};

type AndroidScanPreparationHelpers = {
    prepareScanArtifacts(serial: string): Promise<{
        deviceInfo: AndroidDeviceInfo;
        allApps: AndroidAppRecord[];
        networkMap: AndroidNetworkUsageMap;
        processedApks: ApkFileRecord[];
        enabledA11yPkgs: Set<string>;
        activeAdminPkgs: Set<string>;
    }>;
};

type AndroidService = {
    checkConnection(): Promise<AndroidConnectionStatus>;
    runScan(): Promise<AndroidScanResult>;
    getDeviceInfo(serial: string): Promise<AndroidDeviceInfo>;
    getDashboardData(serial?: string): Promise<AndroidDashboardData>;
    getDeviceSecurityStatus(serial?: string): Promise<AndroidDeviceSecurityStatus>;
    performDeviceSecurityAction(serial?: string, action?: AndroidSecurityActionPayload): Promise<AndroidSecurityActionResult>;
    setDeviceSecuritySetting(serial?: string, settingId?: string, enabled?: boolean): Promise<AndroidSecurityActionResult>;
    openAndroidSettings(serial?: string, screen?: string): Promise<AndroidSecurityActionResult>;
    uninstallApp(packageName: string): Promise<AndroidUninstallResult>;
    deleteApkFile(serial: string, filePath: string): Promise<AndroidDeleteApkResult>;
    neutralizeApp(packageName: string, perms?: string[]): Promise<AndroidNeutralizeResult>;
    getGrantedPermissions(packageName: string): Promise<string[]>;
    getInstalledApps(serial: string): Promise<AndroidAppRecord[]>;
    getAppInstallTime(serial: string, packageName: string): Promise<string | null>;
    checkIsRunningBackground(serial: string, packageName: string): Promise<boolean>;
    getAppPermissions(serial: string, packageName: string): Promise<AndroidAppPermissionData>;
    getNetworkUsageMap(serial: string): Promise<AndroidNetworkUsageMap>;
    findApkFiles(serial: string): Promise<ApkFileRecord[]>;
    getApkPermissionsOnly(serial: string, remotePath: string): Promise<string[]>;
    filterSuspiciousApps(apps: AndroidAppRecord[]): AndroidAppRecord[];
    runVirusTotalCheck(serial: string, suspiciousApps: AndroidAppRecord[]): Promise<void>;
    adbShell(serial: string, cmd: string): Promise<string>;
    adbShellWithTimeout(serial: string, cmd: string, timeoutMs?: number): Promise<string>;
    openSettings(action: string): Promise<AndroidOpenSettingsResult>;
    [key: string]: unknown;
};

export type AndroidServiceOptions = {
    client: AdbClientLike;
    adb: AdbLike;
    ApkReader: ApkReaderLike;
    fs: FileSystemLike;
    path: PathLike;
    os: OsLike;
    crypto: CryptoLike;
    log: LogLike;
    exec: ExecLike;
    CONFIG: ConfigLike;
    Utils: UtilsLike;
    analyzeAppWithStaticModel?: AnalyzeStaticModel;
};

export function createAndroidService({ client, adb, ApkReader, fs, path, os, crypto, log, exec, CONFIG, Utils, analyzeAppWithStaticModel }: AndroidServiceOptions): AndroidService {
    if (!client) throw new Error('createAndroidService requires client');
    if (!adb) throw new Error('createAndroidService requires adb');

    const {
        evaluateAndroidAppRisk,
        RISK_LEVELS
    } = riskRulesModule as {
        evaluateAndroidAppRisk(app: AndroidAppRecord): {
            riskLevel: RiskLevel;
            riskReasons: RiskReason[];
            recommendation: RiskRecommendation[];
            aiNarration: string;
        };
        RISK_LEVELS: {
            SPYWARE: RiskLevel;
            PRIVACY_RISK: RiskLevel;
            SAFE: RiskLevel;
        };
    };
    const { evaluateAndroidSpywareFinalVerdict } = spywareFinalFilterModule as {
        evaluateAndroidSpywareFinalVerdict(app: AndroidAppRecord): SpywareFinalVerdict;
    };

    async function adbShell(serial: string, cmd: string): Promise<string> {
        const out = await client.shell(serial, cmd);
        return (await adb.util.readAll(out)).toString().trim();
    }

    async function adbShellWithTimeout(serial: string, cmd: string, timeoutMs = 7000): Promise<string> {
        return await Promise.race([
            adbShell(serial, cmd),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`adb timeout: ${cmd}`)), timeoutMs))
        ]);
    }

    const androidDeviceSecurity = createAndroidDeviceSecurityHelpers({
        client,
        adbShell,
        adbShellWithTimeout
    }) as AndroidDeviceSecurityHelpers;
    const androidAppInventory = (createAndroidAppInventoryHelpers({
        client: client as unknown as Parameters<typeof createAndroidAppInventoryHelpers>[0]['client'],
        adb: adb as Parameters<typeof createAndroidAppInventoryHelpers>[0]['adb'],
        ApkReader: ApkReader as Parameters<typeof createAndroidAppInventoryHelpers>[0]['ApkReader'],
        fs: fs as Parameters<typeof createAndroidAppInventoryHelpers>[0]['fs'],
        path: path as Parameters<typeof createAndroidAppInventoryHelpers>[0]['path'],
        os: os as Parameters<typeof createAndroidAppInventoryHelpers>[0]['os']
    }) as unknown) as AndroidAppInventoryHelpers;
    const androidScanAnalysis = createAndroidScanAnalysisHelpers({
        analyzeAppWithStaticModel,
        getAppPermissions: (...args) => androidAppInventory.getAppPermissions(...args),
        getAppInstallTime: (...args) => androidAppInventory.getAppInstallTime(...args),
        checkIsRunningBackground: (...args) => androidAppInventory.checkIsRunningBackground(...args),
        evaluateAndroidSpywareFinalVerdict,
        evaluateAndroidAppRisk,
        RISK_LEVELS
    }) as AndroidScanAnalysisHelpers;

    const service = {} as AndroidService;

    const androidScanPreparation = (createAndroidScanPreparationHelpers({
        getEnabledAccessibilityPackages: (serial: string) => androidDeviceSecurity.getEnabledAccessibilityPackages(serial),
        getActiveDeviceAdminPackages: (serial: string) => androidDeviceSecurity.getActiveDeviceAdminPackages(serial),
        getDeviceInfo: (serial: string) => service.getDeviceInfo(serial),
        getInstalledApps: (serial: string) => androidAppInventory.getInstalledApps(serial),
        findApkFiles: (serial: string) => androidAppInventory.findApkFiles(serial),
        getNetworkUsageMap: (serial: string) => androidAppInventory.getNetworkUsageMap(serial),
        getApkPermissionsOnly: (serial: string, remotePath: string) => androidAppInventory.getApkPermissionsOnly(serial, remotePath)
    }) as unknown) as AndroidScanPreparationHelpers;

    Object.assign(service, {
        async checkConnection(): Promise<AndroidConnectionStatus> {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) return { status: 'disconnected' };

                const device = devices[0];
                if (device.type === 'unauthorized') return { status: 'unauthorized' };
                if (device.type === 'offline') return { status: 'offline' };

                let model = 'Android Device';
                try {
                    const info = await service.getDeviceInfo(device.id);
                    model = String(info.model || model);
                } catch (_e) { /* noop */ }

                return { status: 'connected', model };
            } catch (err: unknown) {
                return { status: 'error', error: err instanceof Error ? err.message : String(err) };
            }
        },

        async deleteApkFile(serial: string, filePath: string) {
            if (!serial || !filePath) throw new Error('serial and filePath are required');
            try {
                await client.shell(serial, `rm -f "${filePath}"`);
                return { success: true, message: '파일이 기기에서 영구적으로 삭제되었습니다.' };
            } catch (err: unknown) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },

        async openSettings(action: string) {
            if (!action) throw new Error('action is required');

            const devices = await client.listDevices();
            if (!devices || devices.length === 0) throw new Error('기기 없음');
            const serial = devices[0].id;

            try {
                const outStream = await client.shell(serial, `am start -a ${action}`);
                const out = (await adb.util.readAll(outStream)).toString();
                const lowered = out.toLowerCase();
                if (lowered.includes('error') || lowered.includes('exception')) {
                    return { success: false, output: out };
                }
                return { success: true, output: out };
            } catch (err: unknown) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },

        async runScan(): Promise<AndroidScanResult> {
            console.log('--- AI 정밀 분석 시작 ---');
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 없음');
                const serial = devices[0].id;

                const {
                    deviceInfo,
                    allApps,
                    networkMap,
                    processedApks,
                    enabledA11yPkgs,
                    activeAdminPkgs
                } = await androidScanPreparation.prepareScanArtifacts(serial);

                const processedApps = await androidScanAnalysis.analyzeInstalledApps({
                    serial,
                    allApps,
                    networkMap,
                    enabledA11yPkgs,
                    activeAdminPkgs
                });

                const {
                    suspiciousApps,
                    privacyThreatApps,
                    runningCount
                }: AndroidClassifiedAppsResult = androidScanAnalysis.classifyAnalyzedApps(processedApps);

                return {
                    deviceInfo,
                    allApps: processedApps,
                    suspiciousApps,
                    privacyThreatApps,
                    apkFiles: processedApks,
                    runningCount
                };
            } catch (err: unknown) {
                console.error(err);
                return { error: err instanceof Error ? err.message : String(err) };
            }
        },

        async getDeviceInfo(serial: string): Promise<AndroidDeviceInfo> {
            const modelCmd = await client.shell(serial, 'getprop ro.product.model');
            const model = (await adb.util.readAll(modelCmd)).toString().trim();

            let isRooted = false;
            try {
                const rootCmd = await client.shell(serial, 'which su');
                if ((await adb.util.readAll(rootCmd)).toString().trim().length > 0) isRooted = true;
            } catch (_e) { /* noop */ }

            let phoneNumber = '알 수 없음';
            try {
                const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
                const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
                if (phoneOut.includes('Line 1 Number')) phoneNumber = phoneOut;
            } catch (_e) { /* noop */ }

            return { model, serial, isRooted, phoneNumber };
        },

        async adbShell(serial: string, cmd: string) {
            return adbShell(serial, cmd);
        },

        async adbShellWithTimeout(serial: string, cmd: string, timeoutMs = 7000) {
            return adbShellWithTimeout(serial, cmd, timeoutMs);
        },

        async getDeviceSecurityStatus(serial?: string) {
            return androidDeviceSecurity.getDeviceSecurityStatus(serial);
        },

        async setDeviceSecuritySetting(serial?: string, settingId?: string, enabled?: boolean) {
            return androidDeviceSecurity.setDeviceSecuritySetting(serial, settingId, enabled);
        },

        async openAndroidSettings(serial?: string, screen?: string) {
            return androidDeviceSecurity.openAndroidSettings(serial, screen);
        },

        async performDeviceSecurityAction(serial?: string, action?: AndroidSecurityActionPayload) {
            return androidDeviceSecurity.performDeviceSecurityAction(serial, action);
        },

        async getEnabledAccessibilityPackages(serial: string) {
            return androidDeviceSecurity.getEnabledAccessibilityPackages(serial);
        },

        async getActiveDeviceAdminPackages(serial: string) {
            return androidDeviceSecurity.getActiveDeviceAdminPackages(serial);
        },

        async getGrantedPermissions(packageName: string): Promise<string[]> {
            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 끊김');
            const serial = devices[0].id;

            const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
            const dumpStr = (await adb.util.readAll(dumpOutput)).toString();

            const grantedPerms: string[] = [];
            const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(dumpStr)) !== null) {
                grantedPerms.push(`android.permission.${match[1]}`);
            }
            return grantedPerms;
        },

        async uninstallApp(packageName: string) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 끊김');
                const serial = devices[0].id;

                console.log(`[Android] 삭제 시도 전 기기 관리자 권한 해제 시도: ${packageName}`);
                try {
                    await client.shell(serial, `dpm remove-active-admin ${packageName}`);
                } catch (_e) {
                    console.log('기기 관리자 권한이 없거나 이미 해제됨');
                }

                const disableCmd = await client.shell(serial, `pm disable-user --user 0 ${packageName}`);
                await adb.util.readAll(disableCmd);

                try {
                    await client.uninstall(serial, packageName);
                    return { success: true, message: '앱이 완전히 삭제되었습니다.' };
                } catch (_e) {
                    await client.shell(serial, `pm clear ${packageName}`);
                    throw new Error('일반 삭제 실패, 데이터를 초기화하고 중지시켰습니다.');
                }
            } catch (err: unknown) {
                console.error('최종 실패:', err);
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },

        async neutralizeApp(packageName: string, perms?: string[]) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0) throw new Error('기기 연결 끊김');
                const serial = devices[0].id;

                const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
                const dumpStr = (await adb.util.readAll(dumpOutput)).toString();

                const grantedPerms: string[] = [];
                const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
                let match: RegExpExecArray | null;
                while ((match = regex.exec(dumpStr)) !== null) {
                    grantedPerms.push(`android.permission.${match[1]}`);
                }

                const targetPerms = [...new Set(Array.isArray(perms) && perms.length > 0 ? perms : grantedPerms)];
                let revokedCount = 0;
                for (const perm of targetPerms) {
                    try {
                        await client.shell(serial, `pm revoke ${packageName} ${perm}`);
                        revokedCount++;
                    } catch (_e) { /* noop */ }
                }

                await client.shell(serial, `am force-stop ${packageName}`);
                return { success: true, count: revokedCount };
            } catch (err: unknown) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },

        async getInstalledApps(serial: string) {
            return androidAppInventory.getInstalledApps(serial);
        },

        async getAppInstallTime(serial: string, packageName: string) {
            return androidAppInventory.getAppInstallTime(serial, packageName);
        },

        async checkIsRunningBackground(serial: string, packageName: string) {
            return androidAppInventory.checkIsRunningBackground(serial, packageName);
        },

        async getAppPermissions(serial: string, packageName: string) {
            return androidAppInventory.getAppPermissions(serial, packageName);
        },

        async getNetworkUsageMap(serial: string) {
            return androidAppInventory.getNetworkUsageMap(serial);
        },

        async findApkFiles(serial: string) {
            return androidAppInventory.findApkFiles(serial);
        },

        filterSuspiciousApps(apps: AndroidAppRecord[]) {
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

            return apps.filter((app) => {
                if (SAFE_PREFIX.some((p) => app.packageName.startsWith(p))) return false;
                if (!app.isSideloaded) return false;
                if (!app.isRunningBg) return false;

                const perms = Array.isArray(app.requestedList) ? app.requestedList as string[] : [];
                const hasSensitive = perms.some((p) => SENSITIVE.includes(p));
                const hasAlarm = perms.some((p) => ALARM.includes(p));

                if (hasSensitive && !hasAlarm) {
                    const caught = perms.filter((p) => SENSITIVE.includes(p));
                    const shortNames = caught.map((p) => p.split('.').pop()).slice(0, 3);
                    app.reason = `행동 탐지: 외부 설치 + [${shortNames.join(', ')}...]`;
                    return true;
                }
                return false;
            });
        },

        async runVirusTotalCheck(serial: string, suspiciousApps: AndroidAppRecord[]) {
            if (!Utils || typeof Utils.checkVirusTotal !== 'function') {
                for (const app of suspiciousApps) {
                    app.vtResult = { error: 'VirusTotal 검사 비활성화' };
                }
                return;
            }

            for (const app of suspiciousApps) {
                try {
                    if (!app.apkPath || app.apkPath === 'N/A') continue;
                    const tempPath = path.join(os.tmpdir(), `${app.packageName}.apk`);
                    const transfer = await client.pull?.(serial, String(app.apkPath));
                    if (!transfer) throw new Error('APK pull is not supported by the current adb client');

                    await new Promise<void>((resolve, reject) => {
                        const fn = fs.createWriteStream?.(tempPath);
                        if (!fn) {
                            reject(new Error('createWriteStream is not available'));
                            return;
                        }
                        transfer.on('end', () => fn.end());
                        transfer.on('error', reject);
                        fn.on('finish', resolve);
                        transfer.pipe(fn);
                    });

                    const fileBuffer = fs.readFileSync(tempPath);
                    const hashSum = crypto.createHash('sha256');
                    hashSum.update(fileBuffer);
                    const sha256 = hashSum.digest('hex');
                    console.log(`[VT] 해시(${app.packageName}): ${sha256}`);

                    const vtResult = await Utils.checkVirusTotal(sha256);
                    app.vtResult = vtResult;

                    if (vtResult && vtResult.malicious > 0) {
                        app.reason = `[VT 확진] 악성(${vtResult.malicious}/${vtResult.total}) + ` + (app.reason || '');
                    } else if (vtResult && vtResult.not_found) {
                        app.reason = `[개인정보 유출 위협] ` + (app.reason || '');
                    }
                    fs.unlinkSync(tempPath);
                } catch (_e) {
                    console.error(`VT 검사 오류 (${app.packageName})`);
                    app.vtResult = { error: '검사 불가' };
                }
            }
        },

        async getApkPermissionsOnly(serial: string, remotePath: string) {
            return androidAppInventory.getApkPermissionsOnly(serial, remotePath);
        },

        async getDashboardData(serial?: string): Promise<AndroidDashboardData> {
            let targetSerial = serial;
            if (!targetSerial) {
                const devices = await client.listDevices();
                targetSerial = devices?.[0]?.id;
            }
            if (!targetSerial) {
                return { ok: false, error: 'NO_DEVICE' };
            }

            const readShell = async (cmd: string) => {
                const stream = await client.shell(targetSerial as string, cmd);
                const buf = await adb.util.readAll(stream);
                return buf.toString('utf8');
            };

            const batteryOut = await readShell('dumpsys battery');
            const levelMatch = batteryOut.match(/level:\s*(\d+)/i);
            const tempMatch = batteryOut.match(/temperature:\s*(\d+)/i);
            const batteryLevel = levelMatch ? parseInt(levelMatch[1], 10) : null;
            const deviceTempC = tempMatch ? (parseInt(tempMatch[1], 10) / 10) : null;

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

            const getprop = async (key: string) => (await readShell(`getprop ${key}`)).trim();
            const model = await getprop('ro.product.model');
            const abi = await getprop('ro.product.cpu.abi');
            const androidVer = await getprop('ro.build.version.release');
            let rooted = 'SAFE';
            try {
                const suOut = (await readShell('which su')).trim();
                if (suOut) rooted = 'ROOTED';
            } catch (_e) {
                rooted = 'UNKNOWN';
            }

            let topText = '';
            try {
                topText = await readShell('toybox top -b -n 1 -m 6 -o %CPU');
            } catch (_e) {
                try {
                    topText = await readShell('top -b -n 1 | head -n 25');
                } catch (_inner) {
                    topText = '';
                }
            }

            const top: Array<{ pid: string; cpu: string; mem: string; name: string }> = [];
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
    });

    return service;
}
