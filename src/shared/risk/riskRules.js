/**
 * Risk classification rules (Android)
 *
 * Policy summary
 * - VT confirmed 기준: vtResult.malicious >= 1
 * - AI 검사에서 걸린 앱 중 VT 확진 => SPYWARE
 * - AI 검사에서 걸렸지만 VT 확진 X => PRIVACY_RISK
 * - Instagram + 위치 권한 ON => PRIVACY_RISK (정책 고정)
 * - 위치공유/가족추적 앱 패키지 리스트 포함 => PRIVACY_RISK
 * - "원격 감시(주변소리/카메라/화면 등)" 성격이 강한 앱 패키지 리스트 포함 => PRIVACY_RISK (근거 강조)
 */

const RISK_LEVELS = Object.freeze({
  SPYWARE: 'SPYWARE',
  PRIVACY_RISK: 'PRIVACY_RISK',
  SAFE: 'SAFE'
});

const INSTAGRAM_PACKAGE_ID = 'com.instagram.android';
const ISHARING_PACKAGE_ID = 'com.isharing.isharing';

const LOCATION_PERMISSION_KEYS = [
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION'
];

/**
 * ✅ 정책 기반: “위치공유 목적/기능이 핵심인 앱” 1차 리스트
 * - 운영 시: Firestore/원격 설정으로 확장 가능
 */
const POLICY_LOCATION_SHARING_PACKAGE_IDS = new Set([
  // Family / Safety location sharing
  'com.life360.android.safetymapd',      // Life360
  'com.geozilla.family',                // GeoZilla
  'org.findmykids.app',                 // Find My Kids (부모앱)
  'org.findmykids.child',               // Pingo (아동용 동반앱)
  'com.glympse.android.glympse',        // Glympse
  'com.wondershare.famisafe',           // FamiSafe

  // Social apps with built-in location sharing
  'com.snapchat.android',               // Snapchat (Snap Map)
  INSTAGRAM_PACKAGE_ID,                 // Instagram

  // ✅ 추가: iSharing (가족 위치 공유)
  ISHARING_PACKAGE_ID                   // iSharing: GPS Location Tracker
]);

/**
 * ✅ 정책 기반: “원격 감시(주변소리/카메라/화면/원격조작 등)” 성격이 강한 앱 리스트
 * - 악성(스파이웨어)로 단정하지는 않지만, 기능 특성상 개인정보 유출/감시 위험도가 커서
 *   개인정보 유출 위협에 포함 + UI에서 근거를 더 강하게 설명하기 위함.
 *
 * 참고: 이 리스트는 제품 운영 중 계속 업데이트될 수 있음.
 */
const POLICY_SURVEILLANCE_LIKE_PACKAGE_IDS = new Set([
  ISHARING_PACKAGE_ID,                  // iSharing: 주변 소리 녹음/모니터링 기능이 언급됨(프로모션/비교 자료 기준)
  'org.findmykids.app',                 // Find My Kids: "Live listen to sound around" (Play 설명)
  'com.sand.airdroidkidp',              // AirDroid Parental Control: remote camera/audio recording (공식 가이드/소개)
  'com.deku.watcher',                   // Watcher - Parental Control: One-Way Audio (Play 설명)
  'com.familygpslocator.childapp',      // Pandow: Listen In Mode (Play 설명)
  'com.alltracker_family.new'           // AllTracker Parental Control: audio/screen/camera streaming (Play 설명)
]);

function normalizePermKey(permissionString) {
  if (!permissionString) return '';
  const parts = String(permissionString).split('.');
  return parts[parts.length - 1] || String(permissionString);
}

function getVtMaliciousCount(app) {
  const count = app?.vtResult?.malicious;
  if (typeof count === 'number') return count;
  return 0;
}

function isVtConfirmed(app) {
  // ✅ 너가 준 기준: 1개 이상이면 확진
  return getVtMaliciousCount(app) >= 1;
}

function isAiFlagged(app) {
  if (app?.aiGrade === 'DANGER' || app?.aiGrade === 'WARNING') return true;
  if (typeof app?.aiScore === 'number' && app.aiScore >= 50) return true;
  return false;
}

function isLocationGranted(app) {
  // androidService는 보통 app.grantedList / app.requestedList를 제공합니다.
  // 단, 환경/버전에 따라 다른 키로 들어오거나 "android.permission.X: granted=true" 형태가 섞일 수 있어
  // 최대한 보수적으로 '허용(granted)' 여부를 판정합니다.
  const candidateLists = [];

  if (Array.isArray(app?.grantedList)) candidateLists.push(app.grantedList);
  if (Array.isArray(app?.grantedPermissions)) candidateLists.push(app.grantedPermissions);
  if (Array.isArray(app?.permissionsGranted)) candidateLists.push(app.permissionsGranted);

  // 일부 코드에서 permissions 객체로 감싸는 케이스 대응
  if (Array.isArray(app?.permissions?.grantedList)) candidateLists.push(app.permissions.grantedList);
  if (Array.isArray(app?.permissions?.granted)) candidateLists.push(app.permissions.granted);

  // 마지막 fallback: 문자열 배열(예: 전체 permissions) 안에 '...ACCESS_FINE_LOCATION...granted=true'가 섞여 있으면 허용으로 간주
  if (Array.isArray(app?.permissions)) candidateLists.push(app.permissions);

  const flattened = candidateLists.flat().filter(Boolean).map(String);

  // granted=true가 포함된 라인은 granted로 인정하고, 그렇지 않으면 그냥 권한 토큰만 비교
  const grantedKeys = new Set(
    flattened
      .filter((p) => {
        // "android.permission.X: granted=true" / "android.permission.X granted=true" 등
        if (/granted\s*=\s*true/i.test(p)) return true;
        // app.grantedList는 보통 이미 허용된 것만 들어오므로 그대로 인정
        // (granted=true가 없어도 후보군에 포함될 수 있으니 그대로 통과)
        return true;
      })
      .map((p) => {
        // "android.permission.X: granted=true" 같은 경우 ':' 앞까지만 자르기
        const head = p.split(':')[0].trim();
        // "android.permission.X granted=true" 같은 경우 공백 앞까지만
        const head2 = head.split(/\s+/)[0].trim();
        return normalizePermKey(head2);
      })
      .filter(Boolean)
  );

  return LOCATION_PERMISSION_KEYS.some((k) => grantedKeys.has(k));
}

function isInLocationSharingPolicyList(app) {
  if (!app?.packageName) return false;
  return POLICY_LOCATION_SHARING_PACKAGE_IDS.has(app.packageName);
}

function isInSurveillancePolicyList(app) {
  if (!app?.packageName) return false;
  return POLICY_SURVEILLANCE_LIKE_PACKAGE_IDS.has(app.packageName);
}

function buildReason({ code, title, detail, severity }) {
  return { code, title, detail, severity };
}

function buildRecommendations(level, app) {
  const actions = [];

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

    // 원격 감시 성격 앱은 추가 권장
    if (isInSurveillancePolicyList(app)) {
      actions.unshift({ action: 'REVIEW_MIC_CAMERA', label: '마이크/카메라 권한 점검' });
      actions.push({ action: 'DISABLE_OVERLAY', label: '오버레이/접근성 권한 점검' });
    }
  }

  return actions;
}

/**
 * Evaluate Android app risk based on policy.
 */
function evaluateAndroidAppRisk(app) {
  const aiFlagged = isAiFlagged(app);
  const vtConfirmed = isVtConfirmed(app);
  const locationGranted = isLocationGranted(app);

  const reasons = [];

  // Rule 1: AI flagged + VT confirmed => Spyware
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

  // Rule 2: AI flagged but not VT confirmed => Privacy risk
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

  // Rule 3: Instagram + location on => Privacy risk (hard rule)
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

  // Rule 4: 원격 감시 성격 앱 => Privacy risk (근거 강하게)
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

  // Rule 5: Location sharing policy list => Privacy risk
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



/**
 * Risk classification rules (Common wrapper)
 *
 * - platform: 'android' | 'ios'
 * - app: normalized app object
 *   - Android: { packageName, cachedTitle, permissions?, ... }
 *   - iOS: { packageName: <bundleId>, cachedTitle, ... }
 *
 * Returns:
 *  {
 *    riskLevel, riskReasons, recommendation, aiNarration,
 *    card: (privacy threat card object for UI) | null
 *  }
 */
const IOS_POLICY_LOCATION_SHARING_BUNDLE_IDS = new Set([
  // location sharing / family tracking / safety apps
  'com.life360.safetymapd',
  'com.geozilla.family',
  'org.findmykids.app',
  'com.glympse.glympse',
  'com.wondershare.famisafe',
  // major apps with location-sharing features (policy fixed)
  'com.burbn.instagram',
  'com.snapchat.Snapchat'
]);

// iOS: "surveillance-like" list (keep conservative; can expand later)
const IOS_POLICY_SURVEILLANCE_LIKE_BUNDLE_IDS = new Set([
  // (intentionally minimal; add when you confirm bundle IDs)
]);

function normalizePlatform(p) {
  const v = String(p || '').toLowerCase();
  if (v.startsWith('ios')) return 'ios';
  return 'android';
}

function getAppIdentifier(app) {
  // We use packageName field as the canonical identifier for both platforms.
  // - Android: package name (e.g., com.example.app)
  // - iOS: bundle id (e.g., com.apple.mobilesafari)
  return (app && (app.packageName || app.bundleId || app.id || app.identifier || '')).toString().trim();
}

function getAppDisplayName(app, identifier) {
  return (app && (app.cachedTitle || app.appName || app.name || app.title)) || identifier;
}

/**
 * Platform-agnostic entrypoint used by iOS scan flow.
 */
function evaluateAppRisk(platform, app) {
  const p = normalizePlatform(platform);

  if (p === 'android') {
    const evaluated = evaluateAndroidAppRisk(app);
    // For Android, the privacyThreatApps list is already prepared in androidService.
    // Return a UI card only when policy classifies as privacy risk.
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

  // iOS path: use bundleId(=packageName) based policy lists.
  const identifier = getAppIdentifier(app);
  if (!identifier) {
    return { riskLevel: RISK_LEVELS.SAFE, riskReasons: [], recommendation: [], aiNarration: '', card: null };
  }

  const displayName = getAppDisplayName(app, identifier);
  const isInstagram = identifier === 'com.burbn.instagram';

  // 1) Location sharing / family tracking policy
  if (IOS_POLICY_LOCATION_SHARING_BUNDLE_IDS.has(identifier)) {
    const riskReasons = [{
      code: isInstagram ? 'INSTAGRAM_LOCATION_FEATURE' : 'LOCATION_SHARING_APP',
      title: isInstagram ? '위치 공유 기능(인스타그램)' : '위치 공유 기능 중심 앱',
      detail: '앱 기능 특성상 위치 기반 정보가 외부로 공유될 수 있습니다. 공유 설정/권한을 점검하는 것을 권장합니다.',
      severity: 'LOW'
    }];

    const recommendation = [
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
        // renderer expects packageName field; for iOS it is the bundleId
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

  // 2) Surveillance-like policy (if list is populated)
  if (IOS_POLICY_SURVEILLANCE_LIKE_BUNDLE_IDS.has(identifier)) {
    const riskReasons = [{
      code: 'SURVEILLANCE_LIKE_APP',
      title: '원격 감시 성격 앱(정책)',
      detail: '주변 소리/카메라/화면 등 원격 감시 성격의 기능이 포함된 것으로 알려진 앱으로 정책상 개인정보 유출 위협으로 분류합니다.',
      severity: 'MEDIUM'
    }];

    const recommendation = [
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


module.exports = {
  RISK_LEVELS,
  POLICY_LOCATION_SHARING_PACKAGE_IDS,
  POLICY_SURVEILLANCE_LIKE_PACKAGE_IDS,
  IOS_POLICY_LOCATION_SHARING_BUNDLE_IDS,
  IOS_POLICY_SURVEILLANCE_LIKE_BUNDLE_IDS,
  evaluateAndroidAppRisk,
  evaluateAppRisk
};
