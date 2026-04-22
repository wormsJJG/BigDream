type ApkLike = {
    apkPath: string;
    [key: string]: unknown;
};

type DeviceInfoLike = {
    os?: string;
    [key: string]: unknown;
};

type PreparationDeps = {
    getEnabledAccessibilityPackages(serial: string): Promise<Set<string>>;
    getActiveDeviceAdminPackages(serial: string): Promise<Set<string>>;
    getDeviceInfo(serial: string): Promise<DeviceInfoLike>;
    getInstalledApps(serial: string): Promise<unknown[]>;
    findApkFiles(serial: string): Promise<ApkLike[]>;
    getNetworkUsageMap(serial: string): Promise<Record<string, unknown>>;
    getApkPermissionsOnly(serial: string, apkPath: string): Promise<string[]>;
};

export function createAndroidScanPreparationHelpers({
    getEnabledAccessibilityPackages,
    getActiveDeviceAdminPackages,
    getDeviceInfo,
    getInstalledApps,
    findApkFiles,
    getNetworkUsageMap,
    getApkPermissionsOnly
}: PreparationDeps) {
    async function buildProcessedApks(serial: string, apkFiles: ApkLike[]) {
        return await Promise.all(apkFiles.map(async (apk) => {
            const perms = await getApkPermissionsOnly(serial, apk.apkPath);
            return {
                ...apk,
                requestedList: perms,
                requestedCount: perms.length
            };
        }));
    }

    async function prepareScanArtifacts(serial: string) {
        const [enabledA11yPkgs, activeAdminPkgs] = await Promise.all([
            getEnabledAccessibilityPackages(serial),
            getActiveDeviceAdminPackages(serial)
        ]);

        const deviceInfo = await getDeviceInfo(serial);
        deviceInfo.os = 'ANDROID';

        const [allApps, apkFiles, networkMap] = await Promise.all([
            getInstalledApps(serial),
            findApkFiles(serial),
            getNetworkUsageMap(serial)
        ]);

        const processedApks = await buildProcessedApks(serial, apkFiles);

        return {
            deviceInfo,
            allApps,
            networkMap,
            processedApks,
            enabledA11yPkgs,
            activeAdminPkgs
        };
    }

    return {
        buildProcessedApks,
        prepareScanArtifacts
    };
}

