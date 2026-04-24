export type RiskLevel = 'SPYWARE' | 'PRIVACY_RISK' | 'SAFE' | string;

export type RiskReason = {
    code: string;
    title: string;
    detail: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | string;
};

export type RiskRecommendation = {
    action: string;
    label: string;
};

export type AndroidRiskEvaluation = {
    riskLevel: RiskLevel;
    riskReasons: RiskReason[];
    recommendation: RiskRecommendation[];
    aiNarration: string;
};

export type PrivacyThreatCard = Record<string, unknown> & {
    packageName?: string;
    cachedTitle?: string;
    policyLabel?: string;
    riskLevel: RiskLevel;
    riskReasons: RiskReason[];
    recommendation: RiskRecommendation[];
    aiNarration: string;
    reason?: string;
};

export type PlatformRiskEvaluation = AndroidRiskEvaluation & {
    card: PrivacyThreatCard | null;
};

type RiskRuleApp = Record<string, unknown> & {
    packageName?: string;
    bundleId?: string;
    id?: string;
    identifier?: string;
    cachedTitle?: string;
    appName?: string;
    name?: string;
    title?: string;
    aiGrade?: string;
    aiScore?: number;
    vtResult?: {
        malicious?: number;
    };
    grantedList?: string[];
    permissions?: unknown;
};

export const RISK_LEVELS = Object.freeze({
    SPYWARE: 'SPYWARE',
    PRIVACY_RISK: 'PRIVACY_RISK',
    SAFE: 'SAFE'
} as const);

const INSTAGRAM_PACKAGE_ID = 'com.instagram.android';
const ISHARING_PACKAGE_ID = 'com.isharing.isharing';

const LOCATION_PERMISSION_KEYS = [
    'ACCESS_FINE_LOCATION',
    'ACCESS_COARSE_LOCATION',
    'ACCESS_BACKGROUND_LOCATION'
];

export const POLICY_LOCATION_SHARING_PACKAGE_IDS = new Set([
    'com.life360.android.safetymapd',
    'com.geozilla.family',
    'org.findmykids.app',
    'org.findmykids.child',
    'com.glympse.android.glympse',
    'com.wondershare.famisafe',
    'com.snapchat.android',
    INSTAGRAM_PACKAGE_ID,
    ISHARING_PACKAGE_ID
]);

export const POLICY_SURVEILLANCE_LIKE_PACKAGE_IDS = new Set([
    ISHARING_PACKAGE_ID,
    'org.findmykids.app',
    'com.sand.airdroidkidp',
    'com.deku.watcher',
    'com.familygpslocator.childapp',
    'com.alltracker_family.new'
]);

function normalizePermKey(permissionString: unknown) {
    if (!permissionString)
        return '';
    const parts = String(permissionString).split('.');
    return parts[parts.length - 1] || String(permissionString);
}

function getVtMaliciousCount(app: RiskRuleApp) {
    const count = app?.vtResult?.malicious;
    if (typeof count === 'number')
        return count;
    return 0;
}

function isVtConfirmed(app: RiskRuleApp) {
    return getVtMaliciousCount(app) >= 1;
}

function isAiFlagged(app: RiskRuleApp) {
    if (app?.aiGrade === 'DANGER' || app?.aiGrade === 'WARNING')
        return true;
    if (typeof app?.aiScore === 'number' && app.aiScore >= 50)
        return true;
    return false;
}

function isLocationGranted(app: RiskRuleApp) {
    const candidateLists: string[][] = [];

    if (Array.isArray(app?.grantedList))
        candidateLists.push(app.grantedList.map(String));
    if (Array.isArray((app as Record<string, unknown>)?.grantedPermissions))
        candidateLists.push(((app as Record<string, unknown>).grantedPermissions as unknown[]).map(String));
    if (Array.isArray((app as Record<string, unknown>)?.permissionsGranted))
        candidateLists.push(((app as Record<string, unknown>).permissionsGranted as unknown[]).map(String));

    const permissions = app.permissions as Record<string, unknown> | undefined;
    if (Array.isArray(permissions?.grantedList))
        candidateLists.push((permissions.grantedList as unknown[]).map(String));
    if (Array.isArray(permissions?.granted))
        candidateLists.push((permissions.granted as unknown[]).map(String));

    if (Array.isArray(app?.permissions))
        candidateLists.push((app.permissions as unknown[]).map(String));

    const flattened = candidateLists.flat().filter(Boolean).map(String);

    const grantedKeys = new Set(flattened.map((p) => {
        const head = p.split(':')[0].trim();
        const head2 = head.split(/\s+/)[0].trim();
        return normalizePermKey(head2);
    }).filter(Boolean));

    return LOCATION_PERMISSION_KEYS.some((k) => grantedKeys.has(k));
}

function isInLocationSharingPolicyList(app: RiskRuleApp) {
    if (!app?.packageName)
        return false;
    return POLICY_LOCATION_SHARING_PACKAGE_IDS.has(app.packageName);
}

function isInSurveillancePolicyList(app: RiskRuleApp) {
    if (!app?.packageName)
        return false;
    return POLICY_SURVEILLANCE_LIKE_PACKAGE_IDS.has(app.packageName);
}

function buildReason({
    code,
    title,
    detail,
    severity
}: RiskReason) {
    return { code, title, detail, severity };
}

function buildRecommendations(level: RiskLevel, app: RiskRuleApp): RiskRecommendation[] {
    const actions: RiskRecommendation[] = [];

    if (level === RISK_LEVELS.SPYWARE) {
        actions.push(
            { action: 'UNINSTALL', label: '앱 삭제 권장' },
            { action: 'REVOKE_PERMISSIONS', label: '권한 회수(전체)' },
            { action: 'CHECK_ACCOUNTS', label: '계정/인증정보 점검' }
        );
        return actions;
    }

    if (level === RISK_LEVELS.PRIVACY_RISK) {
        if (isLocationGranted(app)) {
            actions.push({ action: 'DISABLE_LOCATION', label: '위치 권한 끄기' });
        }
        actions.push(
            { action: 'REVIEW_SHARING', label: '공유 설정/기록 점검' },
            { action: 'LIMIT_BACKGROUND', label: '백그라운드 실행 제한' }
        );

        if (isInSurveillancePolicyList(app)) {
            actions.unshift({ action: 'REVIEW_MIC_CAMERA', label: '마이크/카메라 권한 점검' });
            actions.push({ action: 'DISABLE_OVERLAY', label: '오버레이/접근성 권한 점검' });
        }
    }

    return actions;
}

export function evaluateAndroidAppRisk(app: RiskRuleApp): AndroidRiskEvaluation {
    const aiFlagged = isAiFlagged(app);
    const vtConfirmed = isVtConfirmed(app);
    const locationGranted = isLocationGranted(app);

    const reasons: RiskReason[] = [];

    if (aiFlagged && vtConfirmed) {
        reasons.push(
            buildReason({
                code: 'AI_FLAGGED',
                title: 'AI 분석에서 악성 패턴 탐지',
                detail: `정적/행동 패턴 기반 분석에서 의심 신호가 탐지되었습니다. (AI 점수: ${app.aiScore ?? '-'} / 등급: ${app.aiGrade ?? '-'})`,
                severity: 'HIGH'
            }),
            buildReason({
                code: 'VT_CONFIRMED',
                title: 'VirusTotal 확진',
                detail: `VirusTotal에서 악성으로 확인되었습니다. (malicious: ${getVtMaliciousCount(app)} / 기준: 1 이상)`,
                severity: 'HIGH'
            })
        );

        return {
            riskLevel: RISK_LEVELS.SPYWARE,
            riskReasons: reasons,
            recommendation: buildRecommendations(RISK_LEVELS.SPYWARE, app),
            aiNarration: 'AI 분석과 VirusTotal 확진이 모두 존재하여 스파이앱으로 분류했습니다.'
        };
    }

    if (aiFlagged && !vtConfirmed) {
        reasons.push(
            buildReason({
                code: 'AI_FLAGGED',
                title: 'AI 분석에서 개인정보 노출 가능성 탐지',
                detail: `AI 분석에서 의심 신호가 탐지되었지만, VirusTotal 확진이 없어 스파이앱으로 단정하지 않습니다. (AI 점수: ${app.aiScore ?? '-'} / 등급: ${app.aiGrade ?? '-'})`,
                severity: 'MEDIUM'
            }),
            buildReason({
                code: 'VT_NOT_CONFIRMED',
                title: 'VirusTotal 확진 없음',
                detail: 'VirusTotal 악성 판정이 1개 미만이라 스파이앱으로 확정하지 않았습니다.',
                severity: 'LOW'
            })
        );

        return {
            riskLevel: RISK_LEVELS.PRIVACY_RISK,
            riskReasons: reasons,
            recommendation: buildRecommendations(RISK_LEVELS.PRIVACY_RISK, app),
            aiNarration: 'AI가 의심 신호를 감지했지만 VT 확진이 없어 개인정보 유출 위협으로 분류했습니다.'
        };
    }

    if (app?.packageName === INSTAGRAM_PACKAGE_ID && locationGranted) {
        reasons.push(
            buildReason({
                code: 'INSTAGRAM_LOCATION_ON',
                title: '인스타그램 위치 권한 활성화',
                detail: '인스타그램은 위치 공유 기능이 존재하여, 위치 권한이 켜져 있으면 위치 정보 노출 가능성이 있습니다.',
                severity: 'MEDIUM'
            })
        );

        return {
            riskLevel: RISK_LEVELS.PRIVACY_RISK,
            riskReasons: reasons,
            recommendation: buildRecommendations(RISK_LEVELS.PRIVACY_RISK, app),
            aiNarration: '인스타그램에서 위치 권한이 활성화되어 있어 개인정보 유출 위협으로 포함했습니다.'
        };
    }

    if (isInSurveillancePolicyList(app)) {
        reasons.push(
            buildReason({
                code: 'SURVEILLANCE_LIKE_APP',
                title: '원격 감시 성격 기능 포함 가능',
                detail: '이 앱은 위치 공유뿐 아니라 주변 소리/카메라/화면 등 원격 모니터링 성격의 기능이 포함될 수 있어 개인정보 유출 위험이 커질 수 있습니다.',
                severity: 'MEDIUM'
            })
        );

        if (locationGranted) {
            reasons.push(
                buildReason({
                    code: 'LOCATION_GRANTED',
                    title: '위치 권한 활성화',
                    detail: '현재 위치 권한이 허용되어 있어 위치 정보 접근이 가능합니다.',
                    severity: 'LOW'
                })
            );
        }

        return {
            riskLevel: RISK_LEVELS.PRIVACY_RISK,
            riskReasons: reasons,
            recommendation: buildRecommendations(RISK_LEVELS.PRIVACY_RISK, app),
            aiNarration: '원격 모니터링 기능 성격이 있는 앱은 사용 방식에 따라 개인정보 노출 가능성이 커질 수 있어 ‘개인정보 유출 위협’으로 안내합니다.'
        };
    }

    if (isInLocationSharingPolicyList(app) && locationGranted) {
        reasons.push(
            buildReason({
                code: 'LOCATION_SHARING_APP',
                title: '위치공유 기능 중심 앱',
                detail: '위치 기반 정보가 외부로 공유될 수 있는 기능이 핵심인 앱으로 확인되어 개인정보 유출 위협으로 포함했습니다.',
                severity: 'LOW'
            })
        );

        if (locationGranted) {
            reasons.push(
                buildReason({
                    code: 'LOCATION_GRANTED',
                    title: '위치 권한 활성화',
                    detail: '현재 위치 권한이 허용되어 있어 위치 정보 접근이 가능합니다.',
                    severity: 'LOW'
                })
            );
        }

        return {
            riskLevel: RISK_LEVELS.PRIVACY_RISK,
            riskReasons: reasons,
            recommendation: buildRecommendations(RISK_LEVELS.PRIVACY_RISK, app),
            aiNarration: '위치 공유 앱은 사용 방식에 따라 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.'
        };
    }

    return {
        riskLevel: RISK_LEVELS.SAFE,
        riskReasons: [],
        recommendation: [],
        aiNarration: '현재 정책 기준으로는 특이 징후가 없습니다.'
    };
}

export const IOS_POLICY_LOCATION_SHARING_BUNDLE_IDS = new Set([
    'com.life360.safetymapd',
    'com.geozilla.family',
    'org.findmykids.app',
    'com.glympse.glympse',
    'com.wondershare.famisafe',
    'com.burbn.instagram',
    'com.snapchat.Snapchat'
]);

export const IOS_POLICY_SURVEILLANCE_LIKE_BUNDLE_IDS = new Set<string>([]);

function normalizePlatform(p: string) {
    const v = String(p || '').toLowerCase();
    if (v.startsWith('ios'))
        return 'ios';
    return 'android';
}

function getAppIdentifier(app: RiskRuleApp) {
    return (app && (app.packageName || app.bundleId || app.id || app.identifier || '')).toString().trim();
}

function getAppDisplayName(app: RiskRuleApp, identifier: string) {
    return (app && (app.cachedTitle || app.appName || app.name || app.title)) || identifier;
}

export function evaluateAppRisk(platform: string, app: RiskRuleApp): PlatformRiskEvaluation {
    const p = normalizePlatform(platform);

    if (p === 'android') {
        const evaluated = evaluateAndroidAppRisk(app);
        if (evaluated.riskLevel === RISK_LEVELS.PRIVACY_RISK) {
            return {
                ...evaluated,
                card: {
                    ...(app || {}),
                    riskLevel: evaluated.riskLevel,
                    riskReasons: evaluated.riskReasons,
                    recommendation: evaluated.recommendation,
                    aiNarration: evaluated.aiNarration
                }
            };
        }
        return { ...evaluated, card: null };
    }

    const identifier = getAppIdentifier(app);
    if (!identifier) {
        return { riskLevel: RISK_LEVELS.SAFE, riskReasons: [], recommendation: [], aiNarration: '', card: null };
    }

    const displayName = getAppDisplayName(app, identifier);
    const isInstagram = identifier === 'com.burbn.instagram';

    if (IOS_POLICY_LOCATION_SHARING_BUNDLE_IDS.has(identifier)) {
        const riskReasons: RiskReason[] = [{
            code: isInstagram ? 'INSTAGRAM_LOCATION_FEATURE' : 'LOCATION_SHARING_APP',
            title: isInstagram ? '위치 공유 기능(인스타그램)' : '위치 공유 기능 중심 앱',
            detail: '앱 기능 특성상 위치 기반 정보가 외부로 공유될 수 있습니다. 공유 설정/권한을 점검하는 것을 권장합니다.',
            severity: 'LOW'
        }];

        const recommendation: RiskRecommendation[] = [
            { action: 'REVIEW_SHARING', label: '공유 설정 점검' },
            { action: 'DISABLE_LOCATION', label: '위치 접근 최소화' },
            { action: 'LIMIT_BACKGROUND', label: '백그라운드 제한' }
        ];

        const aiNarration = isInstagram
            ? '인스타그램은 위치 공유 기능이 존재하여 사용 방식에 따라 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.'
            : '위치 공유/가족 보호 등 위치 기반 기능 특성상 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.';

        return {
            riskLevel: RISK_LEVELS.PRIVACY_RISK,
            riskReasons,
            recommendation,
            aiNarration,
            card: {
                ...(app || {}),
                packageName: identifier,
                cachedTitle: displayName,
                policyLabel: isInstagram ? 'Instagram 위치 기능' : '위치 공유 앱',
                riskLevel: RISK_LEVELS.PRIVACY_RISK,
                riskReasons,
                recommendation,
                aiNarration,
                reason: '[개인정보 유출 위협] 위치 기반 정보 공유 가능성이 있습니다.'
            }
        };
    }

    if (IOS_POLICY_SURVEILLANCE_LIKE_BUNDLE_IDS.has(identifier)) {
        const riskReasons: RiskReason[] = [{
            code: 'SURVEILLANCE_LIKE_APP',
            title: '원격 감시 성격 앱(정책)',
            detail: '주변 소리/카메라/화면 등 원격 감시 성격의 기능이 포함된 것으로 알려진 앱으로 정책상 개인정보 유출 위협으로 분류합니다.',
            severity: 'MEDIUM'
        }];

        const recommendation: RiskRecommendation[] = [
            { action: 'VERIFY_INSTALL', label: '설치 목적 확인' },
            { action: 'REMOVE_IF_UNUSED', label: '불필요 시 삭제' },
            { action: 'REVIEW_PERMISSIONS', label: '권한 점검' }
        ];

        const aiNarration = '원격 감시(주변 소리/카메라/화면 등) 성격이 강한 앱으로 분류되어 개인정보 유출 위협으로 안내합니다.';

        return {
            riskLevel: RISK_LEVELS.PRIVACY_RISK,
            riskReasons,
            recommendation,
            aiNarration,
            card: {
                ...(app || {}),
                packageName: identifier,
                cachedTitle: displayName,
                policyLabel: '원격 감시 성격 앱',
                riskLevel: RISK_LEVELS.PRIVACY_RISK,
                riskReasons,
                recommendation,
                aiNarration,
                reason: '[개인정보 유출 위협] 원격 감시 성격 앱일 수 있습니다.'
            }
        };
    }

    return { riskLevel: RISK_LEVELS.SAFE, riskReasons: [], recommendation: [], aiNarration: '', card: null };
}
