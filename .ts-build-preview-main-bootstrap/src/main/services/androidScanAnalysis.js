"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAndroidScanAnalysisHelpers = createAndroidScanAnalysisHelpers;
function createAndroidScanAnalysisHelpers({ analyzeAppWithStaticModel, getAppPermissions, getAppInstallTime, checkIsRunningBackground, evaluateAndroidSpywareFinalVerdict, evaluateAndroidAppRisk, RISK_LEVELS }) {
    async function analyzeInstalledApps({ serial, allApps, networkMap, enabledA11yPkgs, activeAdminPkgs }) {
        const processedApps = [];
        const analyze = analyzeAppWithStaticModel;
        for (let i = 0; i < allApps.length; i += 20) {
            const chunk = allApps.slice(i, i + 20);
            const results = await Promise.all(chunk.map(async (app) => {
                try {
                    const [isRunningBg, permData, installDate] = await Promise.all([
                        checkIsRunningBackground(serial, app.packageName),
                        getAppPermissions(serial, app.packageName),
                        getAppInstallTime(serial, app.packageName)
                    ]);
                    const permissions = [...new Set([
                            ...(permData.requestedList || []),
                            ...(permData.grantedList || [])
                        ])];
                    const netStats = networkMap[app.uid ?? ''] || { rx: 0, tx: 0 };
                    const trustedPrefixes = ['com.android.', 'com.samsung.', 'com.google.', 'com.sec.', 'android'];
                    const isMasquerading = trustedPrefixes.some((prefix) => app.packageName.startsWith(prefix)) && !app.isSystemApp;
                    const aiPayload = {
                        packageName: app.packageName,
                        permissions,
                        isSideloaded: app.isSideloaded,
                        isSystemPath: String(app.apkPath || '').startsWith('/system')
                            || String(app.apkPath || '').startsWith('/vendor')
                            || String(app.apkPath || '').startsWith('/product'),
                        isMasquerading,
                        services_cnt: Number(permData.servicesCount || 0),
                        receivers_cnt: Number(permData.receiversCount || 0)
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
                        console.log('-------------------------------------------\n');
                    }
                    return {
                        ...app,
                        isRunningBg,
                        isAccessibilityEnabled: enabledA11yPkgs.has(app.packageName),
                        isDeviceAdminActive: activeAdminPkgs.has(app.packageName),
                        ...permData,
                        dataUsage: netStats,
                        aiScore: aiResult.score,
                        aiGrade: aiResult.grade,
                        installDate,
                        reason: aiResult.reason,
                        servicesCount: permData.servicesCount,
                        receiversCount: permData.receiversCount
                    };
                }
                catch (error) {
                    console.error(`Error analyzing ${app.packageName}:`, error);
                    return { ...app, error: true };
                }
            }));
            processedApps.push(...results);
        }
        return processedApps;
    }
    function classifyAnalyzedApps(processedApps) {
        processedApps.forEach((app) => {
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
            const evaluated = evaluateAndroidAppRisk(app);
            app.riskLevel = evaluated.riskLevel;
            app.riskReasons = evaluated.riskReasons;
            app.recommendation = evaluated.recommendation;
            app.aiNarration = evaluated.aiNarration;
            if (app.riskLevel === RISK_LEVELS.PRIVACY_RISK) {
                app.reason = `[개인정보 유출 위협] ${evaluated.aiNarration}`;
            }
            else if (!app.reason) {
                app.reason = '';
            }
        });
        const spywareApps = processedApps.filter((app) => app.riskLevel === RISK_LEVELS.SPYWARE);
        const privacyThreatApps = processedApps.filter((app) => app.riskLevel === RISK_LEVELS.PRIVACY_RISK);
        const runningCount = processedApps.filter((app) => Boolean(app.isRunningBg)).length;
        return {
            processedApps,
            suspiciousApps: spywareApps,
            privacyThreatApps,
            runningCount
        };
    }
    return {
        analyzeInstalledApps,
        classifyAnalyzedApps
    };
}
