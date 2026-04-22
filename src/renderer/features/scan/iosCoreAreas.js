const IOS_CORE_AREA_MAP = [
    {
        key: 'web',
        sectionId: 'res-ios-web',
        containerId: 'ios-web-container',
        title: '🌐 브라우저 및 웹 활동',
        files: ['History.db', 'Favicons.db', 'WebKit', 'LocalStorage'],
        normal: [
            '방문 기록/도메인 분포가 사용 패턴과 일치',
            '웹뷰/캐시 파일이 정상 범위 내에서 생성/갱신',
            '알 수 없는 리디렉션/피싱 도메인 단서 없음'
        ],
        hacked: [
            '의심 도메인(피싱/추적/명령제어) 접속 흔적',
            '짧은 시간 내 반복 접속/자동화된 패턴',
            '웹뷰 저장소(LocalStorage/IndexedDB)에서 비정상 토큰/스크립트 흔적'
        ],
        aiSafe: '웹 활동 기록에서 악성/의심 도메인 단서가 확인되지 않았고, 데이터 갱신 패턴이 정상 사용 행태와 일치합니다.',
        aiWarn: '웹 활동 영역에서 의심 도메인/패턴이 발견되어, 피싱·추적·원격제어와 연관된 가능성을 배제할 수 없습니다.'
    },
    {
        key: 'messages',
        sectionId: 'res-ios-messages',
        containerId: 'ios-messages-container',
        title: '💬 메시지 및 통신 기록',
        files: ['sms.db', 'ChatStorage.sqlite', 'CallHistoryDB', 'Carrier'],
        normal: [
            '메시지/통화 기록 구조가 정상(필드 누락/손상 없음)',
            '발신/수신 패턴이 사용자 사용 습관과 일치',
            '의심 링크/단축URL/스미싱 IOC 단서 없음'
        ],
        hacked: [
            '스미싱/피싱 URL 또는 악성 단축링크 흔적',
            '짧은 시간 내 다수 번호로 반복 발신/수신',
            '메시지 DB에서 비정상 레코드/손상/이상 타임스탬프'
        ],
        aiSafe: '통신 기록에서 스미싱/피싱 IOC 단서가 확인되지 않았고, DB 구조도 정상 범위로 판단됩니다.',
        aiWarn: '통신 기록에서 의심 링크/패턴이 확인되어, 스미싱·계정 탈취 시나리오 점검이 필요합니다.'
    },
    {
        key: 'system',
        sectionId: 'res-ios-system',
        containerId: 'ios-system-container',
        title: '⚙️ 시스템 로그 및 프로세스',
        files: ['DataUsage.sqlite', 'Crash Reports', 'System Logs', 'Analytics'],
        normal: [
            '크래시/로그가 일반적인 앱/시스템 이벤트 중심',
            '비정상 프로세스/반복 크래시 패턴 없음',
            '데이터 사용량 급증/이상 통신 단서 없음'
        ],
        hacked: [
            '특정 앱/프로세스의 반복 크래시(은폐/후킹 가능성)',
            '비정상 로그 패턴(권한 상승/설정 변경 시도)',
            '데이터 사용량 DB에서 특정 호스트로의 과도한 트래픽 흔적'
        ],
        aiSafe: '시스템 로그/크래시 패턴이 정상 범위로 확인되어 침해 흔적이 낮은 것으로 판단됩니다.',
        aiWarn: '시스템 로그/크래시 영역에서 이상 징후가 확인되어 정밀 진단이 권장됩니다.'
    },
    {
        key: 'apps',
        sectionId: 'res-ios-appsprofiles',
        containerId: 'ios-appsprofiles-container',
        title: '🗂️ 설치된 앱 및 프로파일',
        files: ['Manifest.db', 'Installed Apps', 'Profiles', 'Certificates'],
        normal: [
            '설치 앱 목록이 사용자 인지 범위와 일치',
            '구성 프로파일/인증서 설치 흔적이 제한적(또는 없음)',
            '관리(MDM) 흔적이 확인되지 않음'
        ],
        hacked: [
            '사용자 인지 없는 앱/프로파일 설치 흔적',
            '신뢰된 인증서(루트 CA) 설치로 트래픽 감청 가능성',
            'MDM/프로파일 기반 정책 강제(프록시/VPN) 단서'
        ],
        aiSafe: '앱/프로파일 영역에서 정책 강제 또는 감청 구성 단서가 확인되지 않았습니다.',
        aiWarn: '앱/프로파일 영역에서 프로파일/인증서 관련 단서가 확인되어 개인정보 유출 위험이 증가할 수 있습니다.'
    },
    {
        key: 'artifacts',
        sectionId: 'res-ios-artifacts',
        containerId: 'ios-artifacts-container',
        title: '📁 기타 시스템 파일',
        files: ['shutdown.log', 'LocalStorage', 'Caches', 'Artifacts'],
        normal: [
            '아티팩트 파일 구조/갱신이 정상 범위',
            '특정 IOC/의심 문자열/도메인 단서 없음',
            '비정상적인 잔존 파일(은폐 흔적) 없음'
        ],
        hacked: [
            '의심 문자열/도메인/IOC 단서 발견',
            '비정상적으로 유지되는 캐시/임시파일(은폐 가능성)',
            '분석 도구가 알려진 악성 패턴과 매칭'
        ],
        aiSafe: '기타 시스템 아티팩트에서 알려진 악성 IOC 매칭이 확인되지 않았습니다.',
        aiWarn: '기타 시스템 아티팩트에서 IOC 단서가 확인되어 정밀 분석이 필요합니다.'
    }
];
export function createIosCoreAreasRenderer() {
    const renderArea = (area, result) => {
        const container = document.getElementById(area.containerId);
        if (!container)
            return;
        const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
        const warningCount = warnings.length;
        const isWarning = warningCount > 0;
        const statusBadge = isWarning
            ? `<span class="scs-19b6cd4a">경고</span>`
            : `<span class="scs-186eff43">안전</span>`;
        const evidenceHtml = isWarning
            ? `<div class="scs-a9e72425">
                            <div class="scs-a95df9ac">🔎 탐지된 단서</div>
                            <ul class="scs-54163068">
                                ${warnings.slice(0, 12).map(w => `<li>${w}</li>`).join('')}
                            </ul>
                            ${warningCount > 12 ? `<div class="scs-0f2749a6">외 ${warningCount - 12}건 단서가 더 있습니다.</div>` : ''}
                        </div>`
            : `<div class="scs-29934e59">
                            ✅ 발견된 이상 징후가 없습니다.
                        </div>`;
        const aiText = isWarning ? area.aiWarn : area.aiSafe;
        const filesToShow = (Array.isArray(result?.files) && result.files.length)
            ? result.files
            : (Array.isArray(area?.files) ? area.files : []);
        const filesHtml = filesToShow.length
            ? filesToShow.map(f => `<span class="ios-major-file">${String(f)}</span>`).join(`<span class="ios-major-file-sep">, </span>`)
            : `<span class="ios-major-file-empty">표시할 파일 목록이 없습니다.</span>`;
        container.innerHTML = `
                    <div class="scs-c6adeaee">
                        <div>
                            <div class="ios-major-files"><span class="ios-major-label">주요 검사 파일</span><div class="ios-major-files-text">${filesHtml}</div></div>
                        </div>
                        <div class="scs-f6e3d7fe">
                            ${statusBadge}
                            <div class="scs-ad985d83">단서 ${warningCount}건</div>
                        </div>
                    </div>

                    <div class="scs-ff4196fe">
                        <div class="scs-640ff1f9">
                            <div class="scs-e80f7011">정상 기기 특징</div>
                            <ul class="scs-8f2fd949">
                                ${area.normal.map(x => `<li>${x}</li>`).join('')}
                            </ul>
                        </div>
                        <div class="scs-4371676c">
                            <div class="scs-ad255a56">해킹 기기 특징</div>
                            <ul class="scs-2309330d">
                                ${area.hacked.map(x => `<li>${x}</li>`).join('')}
                            </ul>
                        </div>
                    </div>

                    <div class="scs-ccd73b55">
                        <div class="scs-0291ed2a">
                            <div class="scs-033e0808">🤖</div>
                            <div class="scs-da5cd676">
                                <div class="scs-797d93e9">AI 해석</div>
                                <div class="scs-97257567">${aiText}</div>
                            </div>
                        </div>
                    </div>

                    ${evidenceHtml}
                `;
    };
    return {
        render(mvtResults) {
            IOS_CORE_AREA_MAP.forEach(area => {
                const result = mvtResults?.[area.key] || { status: 'safe', warnings: [] };
                renderArea(area, result);
            });
        }
    };
}
