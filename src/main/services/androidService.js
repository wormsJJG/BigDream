const riskRulesModule = require('../../shared/risk/riskRules.js');
const spywareFinalFilterModule = require('../../shared/spyware/spywareFinalFilter.js');
const { createAndroidDeviceSecurityHelpers } = require('./androidDeviceSecurity.js');
const { createAndroidAppInventoryHelpers } = require('./androidAppInventory.js');
const { createAndroidScanAnalysisHelpers } = require('./androidScanAnalysis.js');
const { createAndroidScanPreparationHelpers } = require('./androidScanPreparation.js');

function createAndroidService({ client, adb, ApkReader, fs, path, os, crypto, log, exec, CONFIG, Utils, analyzeAppWithStaticModel }) {
    if (!client)
        throw new Error('createAndroidService requires client');
    if (!adb)
        throw new Error('createAndroidService requires adb');
    const { evaluateAndroidAppRisk, RISK_LEVELS } = riskRulesModule.default || riskRulesModule;
    const { evaluateAndroidSpywareFinalVerdict } = spywareFinalFilterModule.default || spywareFinalFilterModule;
    async function adbShell(serial, cmd) {
        const out = await client.shell(serial, cmd);
        return (await adb.util.readAll(out)).toString().trim();
    }
    async function adbShellWithTimeout(serial, cmd, timeoutMs = 7000) {
        return await Promise.race([
            adbShell(serial, cmd),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`adb timeout: ${cmd}`)), timeoutMs))
        ]);
    }
    const androidDeviceSecurity = createAndroidDeviceSecurityHelpers({
        client,
        adbShell,
        adbShellWithTimeout
    });
    const androidAppInventory = createAndroidAppInventoryHelpers({
        client,
        adb,
        ApkReader,
        fs,
        path,
        os
    });
    const androidScanAnalysis = createAndroidScanAnalysisHelpers({
        analyzeAppWithStaticModel,
        getAppPermissions: (...args) => androidAppInventory.getAppPermissions(...args),
        getAppInstallTime: (...args) => androidAppInventory.getAppInstallTime(...args),
        checkIsRunningBackground: (...args) => androidAppInventory.checkIsRunningBackground(...args),
        evaluateAndroidSpywareFinalVerdict,
        evaluateAndroidAppRisk,
        RISK_LEVELS
    });
    const service = {};
    const androidScanPreparation = createAndroidScanPreparationHelpers({
        getEnabledAccessibilityPackages: (...args) => androidDeviceSecurity.getEnabledAccessibilityPackages(...args),
        getActiveDeviceAdminPackages: (...args) => androidDeviceSecurity.getActiveDeviceAdminPackages(...args),
        getDeviceInfo: (...args) => service.getDeviceInfo(...args),
        getInstalledApps: (...args) => androidAppInventory.getInstalledApps(...args),
        findApkFiles: (...args) => androidAppInventory.findApkFiles(...args),
        getNetworkUsageMap: (...args) => androidAppInventory.getNetworkUsageMap(...args),
        getApkPermissionsOnly: (...args) => androidAppInventory.getApkPermissionsOnly(...args)
    });
    Object.assign(service, {
        async checkConnection() {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0)
                    return { status: 'disconnected' };
                const device = devices[0];
                if (device.type === 'unauthorized')
                    return { status: 'unauthorized' };
                if (device.type === 'offline')
                    return { status: 'offline' };
                let model = 'Android Device';
                try {
                    const info = await service.getDeviceInfo(device.id);
                    model = String(info.model || model);
                }
                catch (_e) { }
                return { status: 'connected', model };
            }
            catch (err) {
                return { status: 'error', error: err.message };
            }
        },
        async deleteApkFile(serial, filePath) {
            if (!serial || !filePath)
                throw new Error('serial and filePath are required');
            try {
                await client.shell(serial, `rm -f "${filePath}"`);
                return { success: true, message: '파일이 기기에서 영구적으로 삭제되었습니다.' };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        },
        async openSettings(action) {
            if (!action)
                throw new Error('action is required');
            const devices = await client.listDevices();
            if (!devices || devices.length === 0)
                throw new Error('기기 없음');
            const serial = devices[0].id;
            try {
                const outStream = await client.shell(serial, `am start -a ${action}`);
                const out = (await adb.util.readAll(outStream)).toString();
                const lowered = out.toLowerCase();
                if (lowered.includes('error') || lowered.includes('exception')) {
                    return { success: false, output: out };
                }
                return { success: true, output: out };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        },
        async runScan() {
            console.log('--- AI 정밀 분석 시작 ---');
            try {
                const devices = await client.listDevices();
                if (devices.length === 0)
                    throw new Error('기기 없음');
                const serial = devices[0].id;
                const { deviceInfo, allApps, networkMap, processedApks, enabledA11yPkgs, activeAdminPkgs } = await androidScanPreparation.prepareScanArtifacts(serial);
                const processedApps = await androidScanAnalysis.analyzeInstalledApps({
                    serial,
                    allApps,
                    networkMap,
                    enabledA11yPkgs,
                    activeAdminPkgs
                });
                const { suspiciousApps, privacyThreatApps, runningCount } = androidScanAnalysis.classifyAnalyzedApps(processedApps);
                return {
                    deviceInfo,
                    allApps: processedApps,
                    suspiciousApps,
                    privacyThreatApps,
                    apkFiles: processedApks,
                    runningCount
                };
            }
            catch (err) {
                console.error(err);
                return { error: err.message };
            }
        },
        async getDeviceInfo(serial) {
            const modelCmd = await client.shell(serial, 'getprop ro.product.model');
            const model = (await adb.util.readAll(modelCmd)).toString().trim();
            let isRooted = false;
            try {
                const rootCmd = await client.shell(serial, 'which su');
                if ((await adb.util.readAll(rootCmd)).toString().trim().length > 0)
                    isRooted = true;
            }
            catch (_e) { }
            let phoneNumber = '알 수 없음';
            try {
                const phoneCmd = await client.shell(serial, 'service call iphonesubinfo 15 s16 "com.android.shell"');
                const phoneOut = (await adb.util.readAll(phoneCmd)).toString().trim();
                if (phoneOut.includes('Line 1 Number'))
                    phoneNumber = phoneOut;
            }
            catch (_e) { }
            return { model, serial, isRooted, phoneNumber };
        },
        async adbShell(serial, cmd) {
            return adbShell(serial, cmd);
        },
        async adbShellWithTimeout(serial, cmd, timeoutMs = 7000) {
            return adbShellWithTimeout(serial, cmd, timeoutMs);
        },
        async getDeviceSecurityStatus(serial) {
            return androidDeviceSecurity.getDeviceSecurityStatus(serial);
        },
        async setDeviceSecuritySetting(serial, settingId, enabled) {
            return androidDeviceSecurity.setDeviceSecuritySetting(serial, settingId, enabled);
        },
        async openAndroidSettings(serial, screen) {
            return androidDeviceSecurity.openAndroidSettings(serial, screen);
        },
        async performDeviceSecurityAction(serial, action) {
            return androidDeviceSecurity.performDeviceSecurityAction(serial, action);
        },
        async getEnabledAccessibilityPackages(serial) {
            return androidDeviceSecurity.getEnabledAccessibilityPackages(serial);
        },
        async getActiveDeviceAdminPackages(serial) {
            return androidDeviceSecurity.getActiveDeviceAdminPackages(serial);
        },
        async getGrantedPermissions(packageName) {
            const devices = await client.listDevices();
            if (devices.length === 0)
                throw new Error('기기 연결 끊김');
            const serial = devices[0].id;
            const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
            const dumpStr = (await adb.util.readAll(dumpOutput)).toString();
            const grantedPerms = [];
            const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
            let match;
            while ((match = regex.exec(dumpStr)) !== null) {
                grantedPerms.push(`android.permission.${match[1]}`);
            }
            return grantedPerms;
        },
        async uninstallApp(packageName) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0)
                    throw new Error('기기 연결 끊김');
                const serial = devices[0].id;
                console.log(`[Android] 삭제 시도 전 기기 관리자 권한 해제 시도: ${packageName}`);
                try {
                    await client.shell(serial, `dpm remove-active-admin ${packageName}`);
                }
                catch (_e) {
                    console.log('기기 관리자 권한이 없거나 이미 해제됨');
                }
                const disableCmd = await client.shell(serial, `pm disable-user --user 0 ${packageName}`);
                await adb.util.readAll(disableCmd);
                try {
                    await client.uninstall(serial, packageName);
                    return { success: true, message: '앱이 완전히 삭제되었습니다.' };
                }
                catch (_e) {
                    await client.shell(serial, `pm clear ${packageName}`);
                    throw new Error('일반 삭제 실패, 데이터를 초기화하고 중지시켰습니다.');
                }
            }
            catch (err) {
                console.error('최종 실패:', err);
                return { success: false, error: err.message };
            }
        },
        async neutralizeApp(packageName, perms) {
            try {
                const devices = await client.listDevices();
                if (devices.length === 0)
                    throw new Error('기기 연결 끊김');
                const serial = devices[0].id;
                const dumpOutput = await client.shell(serial, `dumpsys package ${packageName}`);
                const dumpStr = (await adb.util.readAll(dumpOutput)).toString();
                const grantedPerms = [];
                const regex = /android\.permission\.([A-Z0-9_]+): granted=true/g;
                let match;
                while ((match = regex.exec(dumpStr)) !== null) {
                    grantedPerms.push(`android.permission.${match[1]}`);
                }
                const targetPerms = [...new Set(Array.isArray(perms) && perms.length > 0 ? perms : grantedPerms)];
                let revokedCount = 0;
                for (const perm of targetPerms) {
                    try {
                        await client.shell(serial, `pm revoke ${packageName} ${perm}`);
                        revokedCount++;
                    }
                    catch (_e) { }
                }
                await client.shell(serial, `am force-stop ${packageName}`);
                return { success: true, count: revokedCount };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        },
        async getInstalledApps(serial) {
            return androidAppInventory.getInstalledApps(serial);
        },
        async getAppInstallTime(serial, packageName) {
            return androidAppInventory.getAppInstallTime(serial, packageName);
        },
        async checkIsRunningBackground(serial, packageName) {
            return androidAppInventory.checkIsRunningBackground(serial, packageName);
        },
        async getAppPermissions(serial, packageName) {
            return androidAppInventory.getAppPermissions(serial, packageName);
        },
        async getNetworkUsageMap(serial) {
            return androidAppInventory.getNetworkUsageMap(serial);
        },
        async findApkFiles(serial) {
            return androidAppInventory.findApkFiles(serial);
        },
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
            return apps.filter((app) => {
                if (SAFE_PREFIX.some((p) => app.packageName.startsWith(p)))
                    return false;
                if (!app.isSideloaded)
                    return false;
                if (!app.isRunningBg)
                    return false;
                const perms = Array.isArray(app.requestedList) ? app.requestedList : [];
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
        async runVirusTotalCheck(serial, suspiciousApps) {
            if (!Utils || typeof Utils.checkVirusTotal !== 'function') {
                for (const app of suspiciousApps) {
                    app.vtResult = { error: 'VirusTotal 검사 비활성화' };
                }
                return;
            }
            for (const app of suspiciousApps) {
                try {
                    if (!app.apkPath || app.apkPath === 'N/A')
                        continue;
                    const tempPath = path.join(os.tmpdir(), `${app.packageName}.apk`);
                    const transfer = await client.pull(serial, app.apkPath);
                    await new Promise((resolve, reject) => {
                        const fn = fs.createWriteStream?.(tempPath);
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
                    }
                    else if (vtResult && vtResult.not_found) {
                        app.reason = `[개인정보 유출 위협] ` + (app.reason || '');
                    }
                    fs.unlinkSync(tempPath);
                }
                catch (_e) {
                    console.error(`VT 검사 오류 (${app.packageName})`);
                    app.vtResult = { error: '검사 불가' };
                }
            }
        },
        async getApkPermissionsOnly(serial, remotePath) {
            return androidAppInventory.getApkPermissionsOnly(serial, remotePath);
        },
        async getDashboardData(serial) {
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
            const getprop = async (key) => (await readShell(`getprop ${key}`)).trim();
            const model = await getprop('ro.product.model');
            const abi = await getprop('ro.product.cpu.abi');
            const androidVer = await getprop('ro.build.version.release');
            let rooted = 'SAFE';
            try {
                const suOut = (await readShell('which su')).trim();
                if (suOut)
                    rooted = 'ROOTED';
            }
            catch (_e) {
                rooted = 'UNKNOWN';
            }
            let topText = '';
            try {
                topText = await readShell('toybox top -b -n 1 -m 6 -o %CPU');
            }
            catch (_e) {
                try {
                    topText = await readShell('top -b -n 1 | head -n 25');
                }
                catch (_inner) {
                    topText = '';
                }
            }
            const top = [];
            const lines = topText.split(/\r?\n/);
            for (const line of lines) {
                const m = line.trim().match(/^(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+([0-9.]+)\s+([0-9.]+)\s+\S+\s+(.+)$/);
                if (m) {
                    top.push({ pid: m[1], cpu: m[2], mem: m[3], name: m[4] });
                    if (top.length >= 5)
                        break;
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

module.exports = { createAndroidService };
