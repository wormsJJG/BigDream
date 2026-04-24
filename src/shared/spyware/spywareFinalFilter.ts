import type { RiskReason } from '../risk/riskRules';

export type SpywareFinalVerdict = {
    isSpyware: boolean;
    reasons: RiskReason[];
    narration: string;
};

type SpywareApp = Record<string, unknown> & {
    aiGrade?: string;
    aiScore?: number;
    grantedList?: string[];
    isSideloaded?: boolean;
    isMasquerading?: boolean;
    isRunningBg?: boolean;
    isAccessibilityEnabled?: boolean;
    isDeviceAdminActive?: boolean;
    servicesCount?: number;
    receiversCount?: number;
};

function normalizePermKey(permissionString: unknown) {
    if (!permissionString)
        return '';
    const parts = String(permissionString).split('.');
    return parts[parts.length - 1] || String(permissionString);
}

const HIGH_RISK_PERMISSION_KEYS = new Set([
    'READ_SMS',
    'RECEIVE_SMS',
    'SEND_SMS',
    'READ_CALL_LOG',
    'WRITE_CALL_LOG',
    'PROCESS_OUTGOING_CALLS',
    'READ_CONTACTS',
    'WRITE_CONTACTS',
    'GET_ACCOUNTS',
    'READ_PHONE_STATE',
    'RECORD_AUDIO',
    'CAMERA',
    'SYSTEM_ALERT_WINDOW',
    'REQUEST_INSTALL_PACKAGES'
]);

function isAiFlagged(app: SpywareApp) {
    if (app?.aiGrade === 'DANGER' || app?.aiGrade === 'WARNING')
        return true;
    if (typeof app?.aiScore === 'number' && app.aiScore >= 50)
        return true;
    return false;
}

function getGrantedPermissionKeys(app: SpywareApp) {
    const list = Array.isArray(app?.grantedList) ? app.grantedList : [];
    return new Set(list.map((p) => normalizePermKey(p)));
}

function countHighRiskPerms(grantedKeys: Set<string>) {
    let count = 0;
    for (const k of grantedKeys) {
        if (HIGH_RISK_PERMISSION_KEYS.has(k))
            count += 1;
    }
    return count;
}

function hasAny(grantedKeys: Set<string>, keys: Set<string>) {
    for (const k of keys) {
        if (grantedKeys.has(k))
            return true;
    }
    return false;
}

function buildReason(code: string, title: string, detail: string, severity = 'MEDIUM'): RiskReason {
    return { code, title, detail, severity };
}

export function evaluateAndroidSpywareFinalVerdict(app: SpywareApp): SpywareFinalVerdict {
    const aiFlagged = isAiFlagged(app);
    if (!aiFlagged) {
        return { isSpyware: false, reasons: [], narration: '' };
    }

    const grantedKeys = getGrantedPermissionKeys(app);
    const highRiskCount = countHighRiskPerms(grantedKeys);

    const hasSmsOrCallLog = hasAny(grantedKeys, new Set(['READ_SMS', 'RECEIVE_SMS', 'SEND_SMS', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'PROCESS_OUTGOING_CALLS']));
    const hasAudioOrCamera = hasAny(grantedKeys, new Set(['RECORD_AUDIO', 'CAMERA']));
    const hasContacts = hasAny(grantedKeys, new Set(['READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS']));
    const hasOverlayOrInstall = hasAny(grantedKeys, new Set(['SYSTEM_ALERT_WINDOW', 'REQUEST_INSTALL_PACKAGES']));

    const isSideloaded = !!app?.isSideloaded;
    const isMasquerading = !!app?.isMasquerading;
    const runningBg = !!app?.isRunningBg;
    const isAccessibilityEnabled = !!app?.isAccessibilityEnabled;
    const isDeviceAdminActive = !!app?.isDeviceAdminActive;
    const servicesCount = Number(app?.servicesCount || 0);
    const receiversCount = Number(app?.receiversCount || 0);

    const reasons: RiskReason[] = [
        buildReason(
            'AI_FLAGGED',
            'AI 분석에서 의심 패턴 탐지',
            `AI 점수: ${app?.aiScore ?? '-'} / 등급: ${app?.aiGrade ?? '-'}`,
            'MEDIUM'
        )
    ];

    if (
        isAccessibilityEnabled &&
        (hasSmsOrCallLog || hasContacts) &&
        (isSideloaded || isMasquerading || isDeviceAdminActive) &&
        (runningBg || servicesCount >= 3 || receiversCount >= 3)
    ) {
        reasons.push(
            buildReason('A11Y_ENABLED', '접근성 서비스 활성', '해당 앱의 접근성 서비스가 기기에서 활성화된 상태로 탐지되었습니다.', 'HIGH'),
            buildReason('SENSITIVE_PERMS', '민감 데이터 접근 권한', '문자/통화기록/연락처 등 민감 정보 접근 권한이 탐지되었습니다.', 'HIGH')
        );
        if (isDeviceAdminActive)
            reasons.push(buildReason('DEVICE_ADMIN', '기기 관리자 활성', '기기 관리자(디바이스 관리자) 권한이 활성화되어 있습니다.', 'HIGH'));
        if (isSideloaded || isMasquerading)
            reasons.push(buildReason('ORIGIN_RISK', '출처/위장 위험', isMasquerading ? '시스템/제조사 앱처럼 위장된 패키지입니다.' : '공식 스토어 출처가 아닌 외부 설치 앱입니다.', 'HIGH'));
        if (runningBg)
            reasons.push(buildReason('PERSISTENCE', '실행 지속성', '백그라운드에서 실행 중인 것으로 탐지되었습니다.', 'HIGH'));

        return {
            isSpyware: true,
            reasons,
            narration: '접근성 서비스가 활성화되어 있고 민감 정보 접근 권한 및 출처/지속성 신호가 함께 존재하여 스파이앱으로 분류했습니다.'
        };
    }

    if (isDeviceAdminActive && (isSideloaded || isMasquerading) && highRiskCount >= 2 && (servicesCount >= 2 || receiversCount >= 2 || runningBg)) {
        reasons.push(
            buildReason('DEVICE_ADMIN', '기기 관리자 활성', '기기 관리자(디바이스 관리자) 권한이 활성화되어 있습니다.', 'HIGH'),
            buildReason('HIGH_RISK_PERMS', '고위험 권한 조합', `고위험 권한이 ${highRiskCount}개 탐지되었습니다.`, 'HIGH'),
            buildReason('ORIGIN_RISK', '출처/위장 위험', isMasquerading ? '시스템/제조사 앱처럼 위장된 패키지입니다.' : '공식 스토어 출처가 아닌 외부 설치 앱입니다.', 'HIGH')
        );
        return {
            isSpyware: true,
            reasons,
            narration: '기기 관리자 권한이 활성화되어 있고 외부 설치/위장 및 고위험 권한 조합이 강해 스파이앱으로 분류했습니다.'
        };
    }

    if ((isSideloaded || isMasquerading) && hasSmsOrCallLog && (runningBg || servicesCount >= 3 || receiversCount >= 3)) {
        reasons.push(
            buildReason('ORIGIN_RISK', '외부 설치/위장 앱', isMasquerading ? '시스템/제조사 패키지처럼 위장된 앱으로 탐지되었습니다.' : '공식 스토어 출처가 아닌 외부 설치 앱입니다.', 'HIGH'),
            buildReason('HIGH_RISK_PERMS', '고위험 권한 조합', '문자/통화기록 관련 권한과 실행 지속성 신호가 함께 탐지되었습니다.', 'HIGH')
        );
        return {
            isSpyware: true,
            reasons,
            narration: '외부 설치/위장 + 문자/통화기록 권한 + 실행 지속성 신호가 함께 존재하여 스파이앱으로 분류했습니다.'
        };
    }

    if (isSideloaded && highRiskCount >= 3 && (hasOverlayOrInstall || hasAudioOrCamera) && (servicesCount >= 3 || receiversCount >= 3)) {
        reasons.push(
            buildReason('ORIGIN_RISK', '외부 설치 앱', '공식 스토어 출처가 아닌 외부 설치 앱입니다.', 'HIGH'),
            buildReason('HIGH_RISK_PERMS', '고위험 권한 다수', `고위험 권한이 ${highRiskCount}개 이상 탐지되었습니다.`, 'HIGH')
        );
        if (hasOverlayOrInstall)
            reasons.push(buildReason('OVERLAY_OR_INSTALL', '피싱/추가 설치 유도 가능성', '오버레이 또는 다른 앱 설치 요청 권한이 탐지되었습니다.', 'HIGH'));
        if (hasAudioOrCamera)
            reasons.push(buildReason('AUDIO_CAMERA', '도청/촬영 가능 권한', '마이크/카메라 권한이 탐지되었습니다.', 'HIGH'));
        return {
            isSpyware: true,
            reasons,
            narration: '외부 설치 + 고위험 권한 다수 + 추가 설치/오버레이/도청·촬영 권한 조합이 강해 스파이앱으로 분류했습니다.'
        };
    }

    if (isMasquerading && hasContacts && hasAudioOrCamera && runningBg) {
        reasons.push(
            buildReason('MASQUERADE', '위장 앱', '시스템/제조사 앱처럼 보이도록 패키지명이 구성된 위장 앱으로 탐지되었습니다.', 'HIGH'),
            buildReason('CONTACTS_ACCOUNTS', '계정/연락처 접근', '연락처/계정 접근 권한이 탐지되었습니다.', 'HIGH'),
            buildReason('AUDIO_CAMERA', '도청/촬영 가능 권한', '마이크/카메라 권한이 탐지되었습니다.', 'HIGH'),
            buildReason('PERSISTENCE', '실행 지속성', '백그라운드에서 실행 중인 것으로 탐지되었습니다.', 'HIGH')
        );
        return {
            isSpyware: true,
            reasons,
            narration: '위장 앱 + 계정/연락처 접근 + 도청·촬영 권한 + 백그라운드 실행이 함께 존재하여 스파이앱으로 분류했습니다.'
        };
    }

    if (highRiskCount > 0) {
        reasons.push(buildReason('HIGH_RISK_PERMS', '고위험 권한 보유', `고위험 권한 ${highRiskCount}개가 탐지되었습니다.`, 'MEDIUM'));
    }
    if (isSideloaded || isMasquerading) {
        reasons.push(buildReason('ORIGIN_RISK', '출처 위험', isMasquerading ? '패키지명이 시스템/제조사 앱처럼 위장되었습니다.' : '공식 스토어 출처가 아닌 외부 설치 앱입니다.', 'MEDIUM'));
    }

    return {
        isSpyware: false,
        reasons,
        narration: '일부 의심 신호가 있으나 스파이앱으로 확정할 만큼의 강한 조합이 부족하여 개인정보 유출 위협으로 분류합니다.'
    };
}
