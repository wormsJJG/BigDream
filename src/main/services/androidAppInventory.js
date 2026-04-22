export function createAndroidAppInventoryHelpers({ client, adb, ApkReader, fs, path, os }) {
    async function getInstalledApps(serial) {
        const sysOutput = await client.shell(serial, 'pm list packages -s');
        const sysData = await adb.util.readAll(sysOutput);
        const systemPackages = new Set(sysData.toString().trim().split('\n').map((line) => line.replace('package:', '').trim()));
        const output = await client.shell(serial, 'pm list packages -i -f -U');
        const data = await adb.util.readAll(output);
        const lines = data.toString().trim().split('\n');
        const TRUSTED_INSTALLERS = [
            'com.android.vending', 'com.sec.android.app.samsungapps', 'com.skt.skaf.A000Z00040',
            'com.kt.olleh.storefront', 'com.lguplus.appstore', 'com.google.android.feedback'
        ];
        const TRUSTED_PREFIXES = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'com.qualcomm.', 'com.qti.', 'android'];
        return lines.map((line) => {
            if (!line)
                return null;
            const parts = line.split(/\s+/);
            let packageName = '';
            let apkPath = 'N/A';
            let installer = null;
            let uid = null;
            parts.forEach((part) => {
                if (part.includes('=')) {
                    if (part.startsWith('package:')) {
                        const cleanPart = part.replace('package:', '');
                        const splitIndex = cleanPart.lastIndexOf('=');
                        if (splitIndex !== -1) {
                            apkPath = cleanPart.substring(0, splitIndex);
                            packageName = cleanPart.substring(splitIndex + 1);
                        }
                    }
                    else if (part.startsWith('installer=')) {
                        installer = part.replace('installer=', '');
                    }
                }
                else if (part.startsWith('uid:')) {
                    uid = part.replace('uid:', '');
                }
            });
            if (!packageName)
                return null;
            let origin = '외부 설치';
            let isSideloaded = true;
            let isSystemApp = false;
            let isMasquerading = false;
            if (systemPackages.has(packageName)) {
                origin = '시스템 앱';
                isSideloaded = false;
                isSystemApp = true;
            }
            else if (installer && TRUSTED_INSTALLERS.includes(installer)) {
                origin = '공식 스토어';
                isSideloaded = false;
                isSystemApp = false;
            }
            const hasTrustedName = TRUSTED_PREFIXES.some((prefix) => packageName.startsWith(prefix));
            if (hasTrustedName && !isSystemApp && isSideloaded) {
                isMasquerading = true;
            }
            return {
                packageName,
                apkPath,
                installer,
                isSideloaded,
                isSystemApp,
                isMasquerading,
                uid,
                origin,
                installDate: '-'
            };
        }).filter((item) => item !== null);
    }
    async function getAppInstallTime(serial, packageName) {
        try {
            const output = await client.shell(serial, `dumpsys package ${packageName}`);
            const dumpsys = (await adb.util.readAll(output)).toString();
            let match = dumpsys.match(/firstInstallTime=([^\r\n]+)/);
            if (match && match[1])
                return String(match[1]).trim();
            match = dumpsys.match(/firstInstallTime:\s*([^\r\n]+)/i);
            if (match && match[1])
                return String(match[1]).trim();
            return '-';
        }
        catch (_e) {
            return '-';
        }
    }
    async function checkIsRunningBackground(serial, packageName) {
        try {
            const output = await client.shell(serial, `dumpsys activity services ${packageName}`);
            const data = (await adb.util.readAll(output)).toString();
            return !data.includes('(nothing)') && data.length > 0;
        }
        catch (_e) {
            return false;
        }
    }
    async function getAppPermissions(serial, packageName) {
        try {
            const output = await client.shell(serial, `dumpsys package ${packageName}`);
            const dumpsys = (await adb.util.readAll(output)).toString();
            const reqMatch = dumpsys.match(/requested permissions:\s*([\s\S]*?)(?:install permissions:|runtime permissions:)/);
            const requestedPerms = new Set();
            if (reqMatch && reqMatch[1]) {
                reqMatch[1].match(/android\.permission\.[A-Z_]+/g)?.forEach((permission) => requestedPerms.add(permission));
            }
            const grantedPerms = new Set();
            const installMatch = dumpsys.match(/install permissions:\s*([\s\S]*?)(?:runtime permissions:|\n\n)/);
            if (installMatch && installMatch[1]) {
                installMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)?.forEach((permission) => grantedPerms.add(permission.split(':')[0]));
            }
            const runtimeMatch = dumpsys.match(/runtime permissions:\s*([\s\S]*?)(?:Dex opt state:|$)/);
            if (runtimeMatch && runtimeMatch[1]) {
                runtimeMatch[1].match(/android\.permission\.[A-Z_]+: granted=true/g)?.forEach((permission) => grantedPerms.add(permission.split(':')[0]));
            }
            const componentPattern = new RegExp(`${packageName.replace(/\./g, '\\.')}/[\\w\\.]+\\.[\\w\\.]+`, 'g');
            const matches = dumpsys.match(componentPattern) || [];
            const uniqueCount = [...new Set(matches)].length;
            return {
                allPermissionsGranted: requestedPerms.size > 0 && [...requestedPerms].every((permission) => grantedPerms.has(permission)),
                requestedList: Array.from(requestedPerms),
                grantedList: Array.from(grantedPerms),
                servicesCount: Math.max(1, Math.ceil(uniqueCount / 2)),
                receiversCount: Math.floor(uniqueCount / 2)
            };
        }
        catch (_e) {
            return { requestedList: [], grantedList: [], servicesCount: 0, receiversCount: 0 };
        }
    }
    async function getNetworkUsageMap(serial) {
        const usageMap = {};
        try {
            let data = '';
            try {
                const output = await client.shell(serial, 'dumpsys netstats detail');
                data = (await adb.util.readAll(output)).toString();
            }
            catch (_e) {
                console.warn('⚠️ dumpsys netstats detail 실패, 대체 명령어 시도.');
            }
            if (data.length === 0) {
                try {
                    const output = await client.shell(serial, 'cat /proc/net/xt_qtaguid/stats');
                    data = (await adb.util.readAll(output)).toString();
                }
                catch (_e) {
                    console.warn('⚠️ /proc/net/xt_qtaguid/stats 접근 실패.');
                }
            }
            let currentUid = null;
            data.split('\n').forEach((line) => {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('ident=')) {
                    const uidMatch = trimmedLine.match(/uid=(\d+)/);
                    if (uidMatch) {
                        currentUid = uidMatch[1];
                        if (!usageMap[currentUid])
                            usageMap[currentUid] = { rx: 0, tx: 0 };
                    }
                    else {
                        currentUid = null;
                    }
                }
                else if (currentUid && trimmedLine.startsWith('st=')) {
                    const rbMatch = trimmedLine.match(/rb=(\d+)/);
                    const tbMatch = trimmedLine.match(/tb=(\d+)/);
                    if (rbMatch && tbMatch) {
                        usageMap[currentUid].rx += parseInt(rbMatch[1], 10) || 0;
                        usageMap[currentUid].tx += parseInt(tbMatch[1], 10) || 0;
                    }
                }
            });
        }
        catch (_e) { }
        return usageMap;
    }
    async function getApkPermissionsOnly(serial, remotePath) {
        let tempPath = null;
        try {
            tempPath = path.join(os.tmpdir(), `extract_${Date.now()}.apk`);
            const transfer = await client.pull(serial, remotePath);
            await new Promise((resolve, reject) => {
                const fileWriter = fs.createWriteStream(tempPath);
                transfer.on('end', () => {
                    if (typeof fileWriter.end === 'function') {
                        fileWriter.end();
                    }
                });
                transfer.on('error', reject);
                fileWriter.on('finish', resolve);
                transfer.pipe(fileWriter);
            });
            const reader = await ApkReader.open(tempPath);
            const manifest = await reader.readManifest();
            const permissions = (manifest.usesPermissions || []).map((permission) => permission.name);
            try {
                permissions.__packageName = manifest.package || manifest.packageName || null;
            }
            catch (_e) { }
            if (fs.existsSync(tempPath))
                fs.unlinkSync(tempPath);
            return permissions;
        }
        catch (error) {
            console.error(`APK 권한 추출 실패 (${remotePath}):`, error);
            if (tempPath && fs.existsSync(tempPath))
                fs.unlinkSync(tempPath);
            return [];
        }
    }
    async function findApkFiles(serial) {
        const searchPaths = ['/sdcard/Download', '/data/local/tmp'];
        const installedApps = await getInstalledApps(serial);
        const installedSet = new Set(installedApps.map((app) => app.packageName));
        const allApkData = [];
        const seenPaths = new Set();
        for (const searchPath of searchPaths) {
            try {
                const command = `find "${searchPath}" -type f -iname "*.apk" -exec ls -ld {} + 2>/dev/null`;
                const output = await client.shell(serial, command);
                const data = (await adb.util.readAll(output)).toString().trim();
                if (!data)
                    continue;
                const lines = data.split('\n');
                for (const line of lines) {
                    const parts = line.split(/\s+/);
                    if (parts.length < 7)
                        continue;
                    const filePath = parts[parts.length - 1];
                    if (seenPaths.has(filePath))
                        continue;
                    seenPaths.add(filePath);
                    const timePart = parts[parts.length - 2];
                    const datePart = parts[parts.length - 3];
                    const rawSize = parts[parts.length - 4];
                    const fileName = filePath.split('/').pop();
                    let apkManifestPackage = null;
                    try {
                        const perms = await getApkPermissionsOnly(serial, filePath);
                        apkManifestPackage = perms && perms.__packageName
                            ? perms.__packageName || null
                            : null;
                    }
                    catch (_e) { }
                    const sizeNum = parseInt(rawSize, 10);
                    const formattedSize = isNaN(sizeNum) ? '분석 중' : (sizeNum / (1024 * 1024)).toFixed(2) + ' MB';
                    allApkData.push({
                        packageName: fileName,
                        apkPath: filePath,
                        fileSize: formattedSize,
                        installDate: `${datePart} ${timePart}`,
                        isApkFile: true,
                        installStatus: (apkManifestPackage && installedSet.has(apkManifestPackage)) ? '현재 설치된 파일' : '현재 미설치된 파일',
                        isRunningBg: false,
                        isSideloaded: true,
                        requestedCount: 3,
                        requestedList: ['android.permission.INTERNET', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.REQUEST_INSTALL_PACKAGES']
                    });
                }
            }
            catch (error) {
                console.error(`${searchPath} 검색 실패:`, error.message);
            }
        }
        return allApkData;
    }
    return {
        getInstalledApps,
        getAppInstallTime,
        checkIsRunningBackground,
        getAppPermissions,
        getNetworkUsageMap,
        findApkFiles,
        getApkPermissionsOnly
    };
}
