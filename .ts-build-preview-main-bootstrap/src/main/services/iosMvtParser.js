"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIosMvtParser = createIosMvtParser;
const riskRules_js_1 = require("../../shared/constants/riskRules.js");
function createIosMvtParser({ fs, path, Utils }) {
    function decodeUnicode(str) {
        if (!str)
            return '';
        try {
            return JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
        }
        catch (_e) {
            return str;
        }
    }
    function parseMvtResults(outputDir, fallbackDeviceInfo) {
        const findings = [];
        let fileCount = 0;
        let finalDeviceInfo = fallbackDeviceInfo || {
            model: 'iPhone (Unknown)', serial: '-', phoneNumber: '-', os: 'iOS', isRooted: false
        };
        const infoFilePath = path.join(outputDir, 'backup_info.json');
        if (fs.existsSync(infoFilePath)) {
            try {
                const content = fs.readFileSync(infoFilePath, 'utf-8');
                const infoJson = JSON.parse(content);
                console.log('📂 [iOS] backup_info.json 로드 성공');
                const modelMap = {
                    'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
                    'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13',
                    'iPhone14,6': 'iPhone SE (3rd)',
                    'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
                    'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
                    'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
                    'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
                    'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max',
                    'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus',
                    'iPhone17,5': 'iPhone 16e',
                    'iPhone18,1': 'iPhone 17 Pro',
                    'iPhone18,2': 'iPhone 17 Pro Max',
                    'iPhone18,3': 'iPhone 17',
                    'iPhone18,4': 'iPhone Air',
                };
                const pType = infoJson['Product Type'];
                const friendlyModel = modelMap[pType] || infoJson['Product Name'] || pType || 'iPhone';
                finalDeviceInfo = {
                    model: friendlyModel,
                    serial: infoJson['Serial Number'] || infoJson['IMEI'] || finalDeviceInfo.serial,
                    phoneNumber: infoJson['Phone Number'] || finalDeviceInfo.phoneNumber,
                    os: infoJson['Product Version'] ? `iOS ${infoJson['Product Version']}` : finalDeviceInfo.os,
                    isRooted: false
                };
                console.log(`✅ [iOS] 기기 정보: ${finalDeviceInfo.model} / ${finalDeviceInfo.phoneNumber}`);
            }
            catch (e) {
                console.warn(`⚠️ [iOS] 기기 정보 파싱 실패: ${e.message}`);
            }
        }
        const targetFiles = ['detected.json', 'suspicious_processes.json', 'suspicious_files.json'];
        targetFiles.forEach((fileName) => {
            const filePath = path.join(outputDir, fileName);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    if (content && content.trim()) {
                        let items = [];
                        try {
                            const parsed = JSON.parse(content);
                            items = Array.isArray(parsed) ? parsed : [parsed];
                        }
                        catch (_e) {
                            content.trim().split('\n').forEach((line) => {
                                try {
                                    if (line.trim())
                                        items.push(JSON.parse(line));
                                }
                                catch (_err) { }
                            });
                        }
                        items.forEach((item) => {
                            item.source_file = fileName;
                            findings.push(item);
                        });
                        fileCount += 1;
                    }
                }
                catch (_err) { }
            }
        });
        const installedApps = [];
        const appsFilePath = path.join(outputDir, 'applications.json');
        if (fs.existsSync(appsFilePath)) {
            try {
                const appContent = fs.readFileSync(appsFilePath, 'utf-8');
                let rawApps = [];
                try {
                    const parsedJson = JSON.parse(appContent);
                    if (Array.isArray(parsedJson)) {
                        rawApps = parsedJson;
                        console.log('✅ [iOS] applications.json: 단일 JSON 배열로 성공적으로 파싱됨.');
                    }
                    else {
                        throw new Error('Not an array');
                    }
                }
                catch (_e) {
                    console.log('🔄 [iOS] applications.json: 단일 배열 파싱 실패. JSON Lines로 재시도.');
                    const lines = appContent.trim().split('\n').filter((line) => line.trim().length > 0);
                    lines.forEach((line) => {
                        try {
                            rawApps.push(JSON.parse(line));
                        }
                        catch (_err) { }
                    });
                }
                const pickFirst = (obj, keys) => {
                    for (const key of keys) {
                        const value = obj?.[key];
                        if (value === null || value === undefined)
                            continue;
                        const text = String(value).trim();
                        if (text)
                            return text;
                    }
                    return '';
                };
                rawApps.forEach((appData) => {
                    const bundleId = pickFirst(appData, [
                        'softwareVersionBundleId',
                        'bundleIdentifier',
                        'bundleId',
                        'CFBundleIdentifier',
                        'identifier',
                        'id',
                        'name'
                    ]);
                    const itemName = pickFirst(appData, [
                        'itemName',
                        'title',
                        'displayName',
                        'localizedName',
                        'bundleDisplayName',
                        'appName',
                        'name'
                    ]);
                    if (bundleId) {
                        const decodedName = decodeUnicode(itemName);
                        installedApps.push({
                            packageName: bundleId,
                            cachedTitle: decodedName || Utils.formatAppName(bundleId),
                            installer: String(appData.sourceApp || 'AppStore')
                        });
                    }
                });
                console.log(`✅ [iOS] 설치된 앱 목록 ${installedApps.length}개 획득 완료.`);
            }
            catch (e) {
                console.error(`❌ [iOS] applications.json 파일 읽기/처리 최종 실패: ${e.message}`);
            }
        }
        else {
            console.warn('⚠️ [iOS] 앱 목록 파일(applications.json)을 찾을 수 없습니다.');
        }
        console.log(`[IosService] 파싱 완료. 위협: ${findings.length}건`);
        const classifyFindingArea = (item) => {
            const text = [
                item?.source_file,
                item?.module,
                item?.check_name,
                item?.description,
                item?.path,
                item?.file_path
            ].filter(Boolean).join(' ').toLowerCase();
            if (/(safari|webkit|browser|history|url|domain|web)/.test(text))
                return 'web';
            if (/(sms|imessage|message|chat|call|whatsapp|telegram|signal)/.test(text))
                return 'messages';
            if (/(profile|certificate|manifest|app|bundle|mobileinstallation|container)/.test(text))
                return 'apps';
            if (/(artifact|ioc|cache|localstorage|shutdown|plist|sqlite)/.test(text))
                return 'artifacts';
            return 'system';
        };
        const toWarningText = (item) => {
            return String(item?.description
                || item?.name
                || item?.check_name
                || item?.module
                || item?.path
                || item?.file_path
                || '의심 항목').trim();
        };
        const warningBuckets = {
            web: [],
            messages: [],
            system: [],
            apps: [],
            artifacts: []
        };
        findings.forEach((item) => {
            const area = classifyFindingArea(item);
            const warningText = toWarningText(item);
            if (warningText)
                warningBuckets[area].push(warningText);
        });
        const areaStatus = (warnings) => (warnings.length ? 'warning' : 'safe');
        const mvtResults = {
            web: { status: areaStatus(warningBuckets.web), warnings: warningBuckets.web, files: ['Safari History', 'Chrome Bookmarks'] },
            messages: { status: areaStatus(warningBuckets.messages), warnings: warningBuckets.messages, files: ['SMS/iMessage DB', 'Call History'] },
            system: { status: areaStatus(warningBuckets.system), warnings: warningBuckets.system, files: ['Configuration Files', 'Log Files'] },
            apps: { status: areaStatus(warningBuckets.apps), warnings: warningBuckets.apps, files: ['Manifest.db', 'App Sandboxes'] },
            artifacts: { status: areaStatus(warningBuckets.artifacts), warnings: warningBuckets.artifacts, files: ['Detected IOCs', 'Caches', 'LocalStorage'] },
        };
        const privacyThreatApps = (installedApps || [])
            .map((app) => (0, riskRules_js_1.evaluateAppRisk)('ios', app).card)
            .filter(Boolean);
        return {
            deviceInfo: finalDeviceInfo,
            suspiciousItems: findings,
            allApps: installedApps,
            privacyThreatApps,
            fileCount,
            mvtResults
        };
    }
    return {
        decodeUnicode,
        parseMvtResults
    };
}
