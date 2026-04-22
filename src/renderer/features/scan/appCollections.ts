type RenderApkListArgs = {
  apkFiles: any[];
  container: HTMLElement | null;
  clear(target: Element): void;
  showAppDetail(app: any, displayName: string): void;
};

type PrivacyThreatApp = {
  packageName?: string;
  [key: string]: any;
};

export function renderApkList({ apkFiles, container, clear, showAppDetail }: RenderApkListArgs): void {
  if (!container) return;
  clear(container);

  if (!apkFiles || apkFiles.length === 0) {
    container.innerHTML = '<p class="scs-d2055e02">발견된 APK 설치 파일이 없습니다.</p>';
    return;
  }

  apkFiles.forEach(apk => {
    const div = document.createElement('div');
    div.className = 'app-item apk-file-item';

    div.innerHTML = `
                <div class="app-icon-wrapper">
                    <img src="./assets/systemAppLogo.png" class="scs-c35a5c87">
                </div>
                <div class="app-display-name">${apk.packageName}</div>
                <div class="app-package-sub">${apk.installStatus || '미설치 파일'}</div>
                <div class="scs-72caaa65">요구권한 ${apk.requestedCount}개</div>
            `;

    div.addEventListener('click', () => {
      showAppDetail(apk, apk.packageName);
    });

    container.appendChild(div);
  });
}

export function buildIosPrivacyThreatApps(allApps: any[], incomingPrivacyApps: PrivacyThreatApp[]): PrivacyThreatApp[] {
  if (Array.isArray(incomingPrivacyApps) && incomingPrivacyApps.length > 0) {
    return incomingPrivacyApps;
  }

  const policyBundleIds = new Set([
    'com.life360.safetymapd',
    'com.geozilla.family',
    'org.findmykids.app',
    'com.glympse.glympse',
    'com.wondershare.famisafe',
    'com.snapchat.Snapchat',
    'com.burbn.instagram'
  ]);

  const normalize = (pkg: unknown) => String(pkg || '').trim();

  const candidates = (Array.isArray(allApps) ? allApps : []).filter(app => {
    const pkg = normalize(app.packageName);
    return policyBundleIds.has(pkg);
  });

  return candidates.map(app => {
    const pkg = normalize(app.packageName);
    const isInstagram = pkg === 'com.burbn.instagram';

    return {
      ...app,
      riskLevel: 'PRIVACY_RISK',
      aiNarration: isInstagram
        ? '인스타그램은 위치 공유 기능이 존재하여 사용 방식에 따라 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.'
        : '위치 공유/가족 보호 등 위치 기반 기능 특성상 위치 정보가 외부로 공유될 수 있어 개인정보 유출 위협으로 안내합니다.',
      riskReasons: [
        {
          code: isInstagram ? 'INSTAGRAM_LOCATION_FEATURE' : 'LOCATION_SHARING_APP',
          title: isInstagram ? '위치 공유 기능(인스타그램)' : '위치 공유 기능 중심 앱',
          detail: '앱 기능 특성상 위치 기반 정보가 외부로 공유될 수 있습니다. 공유 설정/권한을 점검하는 것을 권장합니다.',
          severity: 'LOW'
        }
      ],
      recommendation: [
        { action: 'REVIEW_SHARING', label: '공유 설정 점검' },
        { action: 'DISABLE_LOCATION', label: '위치 접근 최소화' },
        { action: 'LIMIT_BACKGROUND', label: '백그라운드 제한' }
      ],
      reason: '[개인정보 유출 위협] 위치 기반 정보 공유 가능성이 있습니다.'
    };
  });
}
