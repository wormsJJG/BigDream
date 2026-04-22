/**
 * Auto-extracted from legacy bootstrap.js for maintainable structure.
 * Responsibility: Android domain operations only (no IPC wiring).
 */
function createAndroidService({ client, adb, ApkReader, fs, path, os, crypto, log, exec, CONFIG, Utils, analyzeAppWithStaticModel }) {
    // NOTE: bootstrap.js passes a single options object.
    if (!client) throw new Error('createAndroidService requires client');
    if (!adb) throw new Error('createAndroidService requires adb');
    const { evaluateAndroidAppRisk, RISK_LEVELS } = require('../../shared/constants/riskRules');
    const { evaluateAndroidSpywareFinalVerdict } = require('../../shared/constants/spywareFinalFilter');
    const { createAndroidDeviceSecurityHelpers } = require('./androidDeviceSecurity');
    const { createAndroidAppInventoryHelpers } = require('./androidAppInventory');
    const { createAndroidScanAnalysisHelpers } = require('./androidScanAnalysis');
    const { createAndroidScanPreparationHelpers } = require('./androidScanPreparation');

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
        adb,
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
    const androidScanPreparation = createAndroidScanPreparationHelpers({
        getEnabledAccessibilityPackages: (...args) => androidDeviceSecurity.getEnabledAccessibilityPackages(...args),
        getActiveDeviceAdminPackages: (...args) => androidDeviceSecurity.getActiveDeviceAdminPackages(...args),
        getDeviceInfo: (...args) => service.getDeviceInfo(...args),
        getInstalledApps: (...args) => androidAppInventory.getInstalledApps(...args),
        findApkFiles: (...args) => androidAppInventory.findApkFiles(...args),
        getNetworkUsageMap: (...args) => androidAppInventory.getNetworkUsageMap(...args),
        getApkPermissionsOnly: (...args) => androidAppInventory.getApkPermissionsOnly(...args)
    });


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
         * Open an Android system Settings screen on the connected device.
         *
         * NOTE:
         * - This does NOT change any setting automatically. It only navigates the user to the relevant screen.
         * - Some OEM/OS builds may block certain Settings intents; in that case we return success=false.
         */
        async openSettings(action) {
            if (!action) throw new Error('action is required');

            const devices = await client.listDevices();
            if (!devices || devices.length === 0) throw new Error('기기 없음');
            const serial = devices[0].id;

            try {
                // Use ActivityManager to open a Settings screen.
                const outStream = await client.shell(serial, `am start -a ${action}`);
                const out = (await adb.util.readAll(outStream)).toString();

                // Common failure patterns: "Error: Activity not started" / "SecurityException" etc.
                const lowered = out.toLowerCase();
                if (lowered.includes('error') || lowered.includes('exception')) {
                    return { success: false, output: out };
                }

                return { success: true, output: out };
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
                } = androidScanAnalysis.classifyAnalyzedApps(processedApps);

                return {
                    deviceInfo,
                    allApps: processedApps,
                    suspiciousApps,
                    privacyThreatApps,
                    apkFiles: processedApks,
                    runningCount
                };
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
            return adbShell(serial, cmd);
        },

        // ---------------------------------------------------------
        // ✅ [Helper] adbShell with timeout (prevents UI hang)
        async adbShellWithTimeout(serial, cmd, timeoutMs = 7000) {
            return adbShellWithTimeout(serial, cmd, timeoutMs);
        },

        // ---------------------------------------------------------
        // ✅ [Android] Device Security Status
        // Returns: { ok: boolean, items: Array<{id,title,status,level,detail?,note?}>, error? }
        async getDeviceSecurityStatus(serial) {
            return androidDeviceSecurity.getDeviceSecurityStatus(serial);
        },

        // ---------------------------------------------------------
        // ✅ Apply device security action (best-effort)
        // ---------------------------------------------------------
        async setDeviceSecuritySetting(serial, settingId, enabled) {
            return androidDeviceSecurity.setDeviceSecuritySetting(serial, settingId, enabled);
        },

        // ---------------------------------------------------------
        // ✅ Open Android Settings screen via ADB (best-effort)
        // ---------------------------------------------------------
        async openAndroidSettings(serial, screen) {
            return androidDeviceSecurity.openAndroidSettings(serial, screen);
        },

        // ---------------------------------------------------------
        // ✅ Compatibility action API used by renderer patches
        // action: { kind: 'toggle'|'openSettings', target?, value?, intent? }
        // ---------------------------------------------------------
       async performDeviceSecurityAction(serial, action) {
            return androidDeviceSecurity.performDeviceSecurityAction(serial, action);
        },

        // ---------------------------------------------------------
        // ✅ [Helper] 접근성(Accessibility) 활성 서비스 패키지 목록
        // dumpsys accessibility 출력에서 Enabled services / Enabled Accessibility Services 항목을 파싱합니다.
        async getEnabledAccessibilityPackages(serial) {
            return androidDeviceSecurity.getEnabledAccessibilityPackages(serial);
        },

        // ---------------------------------------------------------
        // ✅ [Helper] 기기 관리자(Device Admin) 활성 패키지 목록
        // dumpsys device_policy 출력에서 Active admin / Active Admins 항목의 ComponentInfo를 파싱합니다.
        async getActiveDeviceAdminPackages(serial) {
            return androidDeviceSecurity.getActiveDeviceAdminPackages(serial);
        },

        async getGrantedPermissions(packageName) {

            const devices = await client.listDevices();
            if (devices.length === 0) throw new Error('기기 연결 끊김');
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
        async neutralizeApp(packageName, perms) {
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
              const targetPerms = [...new Set(Array.isArray(perms) && perms.length > 0 ? perms : grantedPerms)];
              

              let revokedCount = 0;
              for (const perm of targetPerms) {
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
            return androidAppInventory.getInstalledApps(serial);
        },


        // 앱 설치 일시 조회 (firstInstallTime)
        async getAppInstallTime(serial, packageName) {
            return androidAppInventory.getAppInstallTime(serial, packageName);
        },

        // 백그라운드 실행 여부 확인
        async checkIsRunningBackground(serial, packageName) {
            return androidAppInventory.checkIsRunningBackground(serial, packageName);
        },

        // 권한 상세 분석
        async getAppPermissions(serial, packageName) {
            return androidAppInventory.getAppPermissions(serial, packageName);
        },

        // 네트워크 사용량 (UID 기반)
        async getNetworkUsageMap(serial) {
            return androidAppInventory.getNetworkUsageMap(serial);
        },

        // APK 파일 검색
        async findApkFiles(serial) {
            return androidAppInventory.findApkFiles(serial);
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
            if (!Utils || typeof Utils.checkVirusTotal !== 'function') {
                for (const app of suspiciousApps) {
                    app.vtResult = { error: "VirusTotal 검사 비활성화" };
                }
                return;
            }
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
            return androidAppInventory.getApkPermissionsOnly(serial, remotePath);
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
