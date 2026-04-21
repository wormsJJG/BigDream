const MVT_SECTIONS = [
    { id: 'web', title: '🌐 1. 브라우저 및 웹 활동', files: 'History.db, Favicons.db, WebKit 데이터' },
    { id: 'messages', title: '💬 2. 메시지 및 통신 기록', files: 'sms.db, ChatStorage.sqlite' },
    { id: 'system', title: '⚙️ 3. 시스템 로그 및 프로세스 활동', files: 'DataUsage.sqlite, Crash Reports' },
    { id: 'apps', title: '🗂️ 4. 설치된 앱 및 프로파일', files: 'Manifest.db, Profiles' },
    { id: 'artifacts', title: '📁 5. 기타 시스템 파일', files: 'shutdown.log, LocalStorage' }
];

export function renderMvtAnalysis({ mvtResults, isIos }) {
    const mvtSection = document.getElementById('mvt-analysis-section');
    const mvtContainer = document.getElementById('mvt-analysis-container');

    if (!isIos) {
        if (mvtSection) mvtSection.classList.add('hidden');
        return;
    }

    if (mvtSection) mvtSection.classList.remove('hidden');
    if (!mvtContainer) return;

    let html = '';

    MVT_SECTIONS.forEach(section => {
        const result = mvtResults[section.id] || { status: 'safe', warnings: [] };
        const isWarning = result.warnings && result.warnings.length > 0;
        const statusText = isWarning ? '경고 발견' : '안전';
        const statusClass = isWarning ? 'status-warning' : 'status-safe';

        let warningList = '';
        if (isWarning) {
            warningList = result.warnings.map(warning => `
                        <li class="scs-117ea7fb">
                            <span class="scs-0a152536">[IOC Match]</span> ${warning}
                        </li>
                    `).join('');
            warningList = `<ul class="scs-df53a407">${warningList}</ul>`;
        }

        html += `
                    <div class="analysis-section" data-status="${isWarning ? 'warning' : 'safe'}" class="scs-c1a7e9ad">
                        <div class="analysis-header js-analysis-toggle" class="scs-2250f14c">
                            <span class="scs-2031001f">${section.title}</span>
                            <div class="scs-72200502">
                                 <span class="scs-ed440f63">주요 검사 파일: <code>${section.files.split(',')[0].trim()}...</code></span>
                                <span class="analysis-status ${statusClass}">${statusText} (${result.warnings ? result.warnings.length : 0}건)</span>
                            </div>
                        </div>
                        <div class="analysis-content scs-5661eca1">
                            <p class="scs-271a6ab4">
                                **[${isWarning ? '위협 경로' : '검사 완료'}]** ${isWarning
                ? `MVT는 이 영역에서 ${result.warnings.length}건의 알려진 스파이웨어 흔적(IOC)과 일치하는 항목을 발견했습니다.`
                : `MVT 분석 엔진은 이 영역의 데이터베이스(${section.files})에서 특이사항을 발견하지 못했습니다.`
            }
                            </p>
                            ${warningList}
                        </div>
                    </div>
                `;
    });

    mvtContainer.innerHTML = html;
    mvtContainer.querySelectorAll('.js-analysis-toggle').forEach((header) => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            if (!content) return;
            content.style.display = content.style.display === 'block' ? 'none' : 'block';
        });
    });

    const totalMvtWarnings = MVT_SECTIONS.reduce((sum, section) => {
        const result = mvtResults[section.id];
        return sum + (result && result.warnings ? result.warnings.length : 0);
    }, 0);

    const rootEl = document.getElementById('res-root');
    if (rootEl && totalMvtWarnings > 0) {
        rootEl.textContent = `⚠️ 경고 발견 (${totalMvtWarnings}건)`;
        rootEl.style.color = '#D9534F';
    } else if (rootEl) {
        rootEl.textContent = '✅ 안전함';
        rootEl.style.color = '#5CB85C';
    }
}
