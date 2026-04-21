export function bindReportPrinting({ State, CustomUI }) {
    const buildPdfFileName = (scanData = {}) => {
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const rawModel = String(scanData?.deviceInfo?.model || State.currentDeviceMode || 'Report');
        const safeModel = rawModel.replace(/[<>:"/\\|?*\x00-\x1F\s]+/g, '_').replace(/^_+|_+$/g, '') || 'Report';
        return `BD_${dateStr}_${safeModel}.pdf`;
    };

    const ensurePrintTemplateLoaded = async () => {
        if (document.getElementById('print-date')) return true;

        try {
            const host = document.getElementById('print-root');
            if (host && window?.bdScanner?.app?.readTextFile) {
                const html = await window.bdScanner.app.readTextFile('src/renderer/components/print/view.html');
                host.innerHTML = html;
            }
        } catch (e) {
            console.warn('print template load failed:', e);
        }

        return Boolean(document.getElementById('print-date'));
    };

    const restorePrintLayout = (appendixHeader, printArea) => {
        if (appendixHeader) {
            appendixHeader.textContent = appendixHeader.textContent.replace(/^[56]\./, '6.');
        }
        const fileSection = document.getElementById('print-file-system-section');
        if (fileSection) fileSection.style.display = 'block';
        if (printArea) printArea.style.display = 'none';
    };

    const formatAppName = (packageName) => {
        if (!packageName) return 'Unknown';
        const parts = packageName.split('.');
        let name = parts[parts.length - 1];
        if ((name === 'android' || name === 'app') && parts.length > 1) {
            name = parts[parts.length - 2];
        }
        return name.charAt(0).toUpperCase() + name.slice(1);
    };

    const printResultsBtn = document.getElementById('print-results-btn');
    if (!printResultsBtn) return;

    printResultsBtn.addEventListener('click', async () => {
        if (!State.lastScanData) {
            await CustomUI.alert('인쇄할 검사 결과가 없습니다.');
            return;
        }

        const isTemplateReady = await ensurePrintTemplateLoaded();
        if (!isTemplateReady) {
            await CustomUI.alert('인쇄 템플릿을 불러오지 못했습니다. (print-date 없음)');
            return;
        }

        const data = State.lastScanData || {};
        const isIos = State.currentDeviceMode === 'ios';
        const suspiciousApps = Array.isArray(data.suspiciousApps) ? data.suspiciousApps : [];
        const allApps = Array.isArray(data.allApps) ? data.allApps : [];
        const apkFiles = Array.isArray(data.apkFiles) ? data.apkFiles : [];
        const privacyThreatApps = Array.isArray(data.privacyThreatApps) ? data.privacyThreatApps : [];

        const clientName = document.getElementById('client-name').value || '익명';
        const clientDob = document.getElementById('client-dob').value || '0000-00-00';
        const clientPhone = document.getElementById('client-phone').value || '000-0000-0000';

        const isAnonName = clientName === '익명 사용자';
        const isAnonDob = clientDob === '0001-01-01';
        const isAnonPhone = clientPhone === '000-0000-0000';

        const now = new Date();
        const dateStr = now.toLocaleString('ko-KR');
        document.getElementById('print-date').textContent = dateStr;
        document.getElementById('print-doc-id').textContent = `BD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
        document.getElementById('print-agency-name').textContent = State.agencyName;

        const pickExaminer = (...candidates) => {
            for (const v of candidates) {
                if (v === null || v === undefined) continue;
                const s = String(v).trim();
                if (!s) continue;
                if (s.includes('익명')) continue;
                if (s === '000-0000-0000' || s === '0000-00-00' || s === '0001-01-01') continue;
                return s;
            }
            return '-';
        };

        const resolvedExaminerName = pickExaminer(
            data.meta?.targetName,
            data.meta?.targetUserName,
            data.meta?.subjectName,
            data.meta?.personName,
            data.meta?.clientName,
            data.targetInfo?.name,
            data.target?.name,
            data.subject?.name,
            data.clientInfo?.name,
            data.client?.name,
            data.clientName,
            isAnonName ? null : clientName
        );
        const resolvedExaminerPhone = pickExaminer(
            data.meta?.targetPhone,
            data.meta?.targetMobile,
            data.meta?.subjectPhone,
            data.meta?.subjectMobile,
            data.meta?.personPhone,
            data.meta?.clientPhone,
            data.targetInfo?.phone,
            data.targetInfo?.mobile,
            data.target?.phone,
            data.target?.mobile,
            data.subject?.phone,
            data.subject?.mobile,
            data.clientInfo?.phone,
            data.client?.phone,
            data.clientPhone,
            isAnonPhone ? null : clientPhone
        );

        const examinerTable = document.getElementById('print-examiner-info');
        if (examinerTable) {
            examinerTable.innerHTML = `
                    <tr>
                        <th>검사자 이름</th>
                        <td>${resolvedExaminerName}</td>
                        <th>전화번호</th>
                        <td>${resolvedExaminerPhone}</td>
                    </tr>
                `;
        }

        document.getElementById('print-model').textContent = data.deviceInfo?.model || '-';
        document.getElementById('print-serial').textContent = data.deviceInfo?.serial || '-';
        document.getElementById('print-root-status').textContent = isIos ? '판단불가 (MVT)' : (data.deviceInfo?.isRooted ? '발견됨 (위험)' : '안전함');

        const threatCount = suspiciousApps.length;
        const summaryBox = document.getElementById('print-summary-box');

        if (threatCount > 0) {
            summaryBox.className = 'summary-box status-danger';
            summaryBox.innerHTML = `⚠️ 위험 (DANGER): 총 ${threatCount}개의 스파이앱이 탐지되었습니다.`;
        } else {
            summaryBox.className = 'summary-box status-safe';
            summaryBox.innerHTML = '✅ 안전 (SAFE): 스파이앱이 탐지 되지 않았습니다.';
        }

        document.getElementById('print-total-count').textContent = allApps.length;
        document.getElementById('print-threat-count').textContent = threatCount;
        document.getElementById('print-file-count').textContent = isIos ? 0 : apkFiles.length;

        const threatContainer = document.getElementById('print-threat-container');
        if (threatCount > 0) {
            let html = '<table class="detail-table"><thead><tr><th>탐지된 앱</th><th>패키지명</th><th>탐지 사유</th></tr></thead><tbody>';
            suspiciousApps.forEach(app => {
                let vtInfo = '';
                if (app.hash && app.hash !== 'N/A') {
                    vtInfo = '<br><span style="color:#0275d8; font-size:9px;">[MVT Artifact]</span>';
                } else if (app.vtResult && app.vtResult.malicious > 0) {
                    vtInfo = `<br><span style="color:red; font-size:9px;">[VT 탐지: ${app.vtResult.malicious}/${app.vtResult.total}]</span>`;
                }
                html += `<tr>
                        <td class="text-danger" style="font-weight:bold;">${formatAppName(app.packageName || app.bundleId || app.id || '')}</td>
                        <td>${app.packageName || app.bundleId || '-'}</td>
                        <td>${app.reason || '불명확'}${vtInfo}</td>
                    </tr>`;
            });
            html += '</tbody></table>';
            threatContainer.innerHTML = html;
        } else {
            threatContainer.innerHTML = '<div style="padding:10px; border:1px solid #ccc; text-align:center; color:#5CB85C;">탐지된 스파이앱 없음</div>';
        }

        const fileSection = document.getElementById('print-file-system-section');
        const fileBody = document.getElementById('print-file-body');

        if (isIos) {
            if (fileSection) {
                fileSection.style.display = 'block';

                const heading = fileSection.querySelector('h3.section-heading');
                const desc = fileSection.querySelector('p.section-desc');
                if (heading) heading.textContent = '5. iOS 5대 핵심 영역 분석 (MVT Core Areas)';
                if (desc) desc.textContent = 'MVT 기반 포렌식 분석으로 확인한 5대 핵심 영역 요약입니다. 각 영역에서 확인된 IOC/경고 단서를 종합해 스파이웨어 흔적 여부를 판단합니다.';

                const thead = fileSection.querySelector('table.detail-table thead');
                if (thead) {
                    thead.innerHTML = `
                            <tr>
                                <th width="18%">영역</th>
                                <th width="12%">상태</th>
                                <th>주요 단서(요약)</th>
                            </tr>
                        `;
                }

                if (fileBody) {
                    const mvt = data?.mvtResults || {};
                    const areaMap = [
                        { key: 'web', title: '🌐 웹 활동' },
                        { key: 'messages', title: '💬 메시지/통신' },
                        { key: 'system', title: '⚙️ 시스템/프로세스' },
                        { key: 'apps', title: '🗂️ 앱/프로파일' },
                        { key: 'artifacts', title: '📁 기타 아티팩트' },
                    ];

                    fileBody.innerHTML = areaMap.map((area) => {
                        const res = mvt?.[area.key] || {};
                        const warnings = Array.isArray(res.warnings) ? res.warnings : [];
                        const count = warnings.length;
                        const status = count > 0 ? '경고' : '안전';
                        const evidence = count > 0
                            ? warnings.slice(0, 3).map(w => String(w)).join('<br>')
                            : '특이사항 없음';

                        return `
                                <tr>
                                    <td><b>${area.title}</b></td>
                                    <td style="font-weight:800; color:${count > 0 ? '#d9534f' : '#5CB85C'};">${status}</td>
                                    <td style="font-size:11px; color:#444;">${evidence}${count > 3 ? '<br><span style="color:#999;">외 ' + (count - 3) + '건</span>' : ''}</td>
                                </tr>
                            `;
                    }).join('');
                }
            }
        } else {
            if (fileSection) fileSection.style.display = 'block';

            if (data.apkFiles && data.apkFiles.length > 0) {
                fileBody.innerHTML = data.apkFiles.map((f, i) => {
                    const filePath = (typeof f === 'object') ? (f.apkPath || f.path || f.packageName || '경로 정보 없음') : f;

                    return `
                <tr>
                    <td style="text-align:center;">${i + 1}</td>
                    <td style="word-break:break-all; font-family:monospace; font-size:11px;">
                        ${filePath}
                    </td>
                </tr>`;
                }).join('');
            }
        }

        const printArea = document.getElementById('printable-report');
        if (printArea) printArea.style.display = 'block';
        const appendixHeader = document.querySelector('#printable-report .print-page:last-child h3.section-heading');

        const appGrid = document.getElementById('print-all-apps-grid');
        appGrid.innerHTML = '';

        const sortedApps = [...allApps].sort((a, b) => String(a.packageName || a.bundleId || '').localeCompare(String(b.packageName || b.bundleId || '')));

        const privacyRiskMap = new Map();
        (privacyThreatApps || []).forEach((card) => {
            const key = String(card?.packageName || card?.bundleId || card?.id || card?.identifier || '').toLowerCase();
            if (key) privacyRiskMap.set(key, card);
        });

        sortedApps.forEach(app => {
            const div = document.createElement('div');
            const appId = String(app.packageName || app.bundleId || app.id || app.identifier || '').toLowerCase();
            const mappedPrivacy = (State.currentDeviceMode === 'ios') ? privacyRiskMap.get(appId) : null;
            const effectiveRiskLevel = String(app.riskLevel || mappedPrivacy?.riskLevel || '').toUpperCase();

            if (effectiveRiskLevel === 'SPYWARE') {
                div.className = 'compact-item compact-threat';
            } else if (effectiveRiskLevel === 'PRIVACY_RISK') {
                div.className = 'compact-item compact-warning';
            } else if (app.isSideloaded) {
                div.className = 'compact-item compact-sideload';
            } else {
                div.className = 'compact-item';
            }

            let prefix = '';
            if (effectiveRiskLevel === 'SPYWARE') {
                prefix = '[위협] ';
            } else if (effectiveRiskLevel === 'PRIVACY_RISK') {
                prefix = '[주의] ';
            } else if (app.isSideloaded) {
                prefix = '[외부] ';
            }

            div.textContent = `${prefix}${formatAppName(app.packageName || app.bundleId || app.id || '')} (${app.packageName})`;
            appGrid.appendChild(div);
        });

        const runPrintDialog = async () => {
            setTimeout(async () => {
                window.print();
                restorePrintLayout(appendixHeader, printArea);

                if (State.currentDeviceMode === 'android') {
                    console.log('인쇄 완료 후 휴대폰 자동 전송 시작...');
                    const result = await window.electronAPI.autoPushReportToAndroid();

                    if (result.success) {
                        CustomUI.alert('✅ 휴대폰 전송 완료!\n\n리포트가 휴대폰의 [Download] 폴더에\n자동으로 저장되었습니다.');
                    } else {
                        console.error('휴대폰 자동 전송 실패:', result.error);
                    }
                }
            }, 500);
        };

        if (State.currentDeviceMode === 'ios') {
            const selectedAction = await CustomUI.choose(
                'iOS 검사 결과서 출력',
                [
                    {
                        value: 'pdf',
                        label: 'PDF로 저장',
                        description: '문서 파일로 저장해 이메일, 메신저, 외부 전달에 바로 사용할 수 있습니다.'
                    },
                    {
                        value: 'report',
                        label: '화면용 결과서 출력',
                        description: '현재 검사 결과서 화면을 인쇄 형식으로 정리해 바로 출력하거나 저장할 수 있습니다.'
                    },
                ]
            );

            if (!selectedAction) {
                restorePrintLayout(appendixHeader, printArea);
                return;
            }

            if (selectedAction === 'pdf') {
                const result = await window.electronAPI.exportIosReportPdf({
                    fileName: buildPdfFileName(data),
                });

                restorePrintLayout(appendixHeader, printArea);

                if (result?.success) {
                    await CustomUI.alert(`PDF가 저장되었습니다.\n${result.filePath}`);
                } else if (!result?.canceled) {
                    await CustomUI.alert(`PDF 저장 실패: ${result?.error || result?.message || '알 수 없는 오류'}`);
                }
                return;
            }

            if (selectedAction === 'report') {
                await runPrintDialog();
                return;
            }
        }

        await runPrintDialog();
    });
}
