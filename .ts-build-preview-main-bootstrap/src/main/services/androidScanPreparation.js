"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAndroidScanPreparationHelpers = createAndroidScanPreparationHelpers;
function createAndroidScanPreparationHelpers({ getEnabledAccessibilityPackages, getActiveDeviceAdminPackages, getDeviceInfo, getInstalledApps, findApkFiles, getNetworkUsageMap, getApkPermissionsOnly }) {
    async function buildProcessedApks(serial, apkFiles) {
        return await Promise.all(apkFiles.map(async (apk) => {
            const perms = await getApkPermissionsOnly(serial, apk.apkPath);
            return {
                ...apk,
                requestedList: perms,
                requestedCount: perms.length
            };
        }));
    }
    async function prepareScanArtifacts(serial) {
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
