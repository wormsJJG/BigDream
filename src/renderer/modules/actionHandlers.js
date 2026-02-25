// Auto-split module: actionHandlers

import { Utils } from '../core/utils.js';
export function initActionHandlers(ctx) {
    const { State, ViewManager, CustomUI, dom, services, constants } = ctx;
    const { loggedInView, loggedOutView } = dom;
    const { ID_DOMAIN } = constants;

    // Firebase deps (pass-through from renderer bootstrap)
    const authService = services.auth;
    const { doc, getDoc, updateDoc, collection, getDocs, setDoc, query, orderBy, where, runTransaction, addDoc, serverTimestamp, deleteDoc, increment, limit } = services.firestore;

    // --- Timestamp/Date normalization (IPC returns plain objects, not Firestore Timestamp prototypes) ---
    const toDateSafe = (value) => {
        if (!value) return null;

        // Date instance
        if (value instanceof Date) return value;

        // Milliseconds number
        if (typeof value === 'number') {
            const d = new Date(value);
            return isNaN(d.getTime()) ? null : d;
        }

        // ISO string
        if (typeof value === 'string') {
            const d = new Date(value);
            return isNaN(d.getTime()) ? null : d;
        }

        if (typeof value === 'object') {
            // Firestore Timestamp (prototype preserved)
            if (typeof value.toDate === 'function') {
                try {
                    const d = value.toDate();
                    if (d instanceof Date) return d;
                    const dd = new Date(d);
                    return isNaN(dd.getTime()) ? null : dd;
                } catch (_) { /* ignore */ }
            }

            // Firestore Timestamp serialized over IPC (seconds/nanoseconds)
            const sec = (typeof value.seconds === 'number')
                ? value.seconds
                : (typeof value._seconds === 'number' ? value._seconds : null);

            const nsec = (typeof value.nanoseconds === 'number')
                ? value.nanoseconds
                : (typeof value._nanoseconds === 'number' ? value._nanoseconds : 0);

            if (sec !== null) {
                const ms = sec * 1000 + Math.floor((nsec || 0) / 1e6);
                const d = new Date(ms);
                return isNaN(d.getTime()) ? null : d;
            }

            // Some serializers may use milliseconds
            if (typeof value.milliseconds === 'number') {
                const d = new Date(value.milliseconds);
                return isNaN(d.getTime()) ? null : d;
            }
        }

        return null;
    };

    const formatDateKR = (value) => {
        const d = toDateSafe(value);
        return d ? d.toLocaleDateString('ko-KR') : '-';
    };

    const formatDateTimeKR = (value) => {
        const d = toDateSafe(value);
        return d ? d.toLocaleString('ko-KR') : '-';
    };


    // [9] 액션 핸들러 (삭제/무력화/인쇄)
    // =========================================================

    // 1. 앱 삭제
    const uninstallBtn = document.getElementById('uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', async () => {
            // dataset에서 필요한 정보를 먼저 추출
            const { package: packageName, appName, apkPath } = uninstallBtn.dataset;

            // [Case A] 버튼 텍스트에 "APK"가 포함된 경우 (미설치 파일 삭제)
            if (uninstallBtn.textContent.includes("APK")) {
                if (!apkPath) {
                    await CustomUI.alert("파일 경로를 찾을 수 없습니다.");
                    return;
                }

                if (!await CustomUI.confirm(`[위험] 기기 내부의 APK 파일을 영구 삭제하시겠습니까?\n\n경로: ${apkPath}`)) return;

                uninstallBtn.disabled = true;
                uninstallBtn.textContent = "파일 삭제 중...";

                try {
                    // serial은 State 관리값 또는 마지막 검사 데이터에서 추출
                    const serial = State.currentSerial || (window.lastScanData ? window.lastScanData.deviceInfo.serial : null);
                    const result = await window.electronAPI.deleteApkFile({ serial, filePath: apkPath });

                    if (result.success) {
                        await CustomUI.alert("✅ APK 파일이 기기에서 삭제되었습니다.");
                        document.getElementById('back-to-dashboard-btn').click();
                    } else {
                        throw new Error(result.error);
                    }
                } catch (err) {
                    await CustomUI.alert(`파일 삭제 실패: ${err.message}`);
                } finally {
                    uninstallBtn.disabled = false;
                    uninstallBtn.textContent = "🗑️ APK 파일 삭제";
                }

            }
            // [Case B] 일반 앱 삭제인 경우
            else {
                if (!packageName) return;

                if (!await CustomUI.confirm(`[경고] 정말로 '${appName}' 앱을 삭제하시겠습니까?\n\n패키지명: ${packageName}`)) return;

                uninstallBtn.disabled = true;
                uninstallBtn.textContent = "삭제 요청 중...";

                try {
                    const result = await window.electronAPI.uninstallApp(packageName);
                    if (result.success) {
                        await CustomUI.alert(result.message);
                        document.getElementById('back-to-dashboard-btn').click();
                    } else {
                        throw new Error(result.error);
                    }
                } catch (err) {
                    await CustomUI.alert(`삭제 실패: ${err.message}\n\n[기기 관리자 해제 필요] 설정 > 보안 > 기기 관리자 앱에서 '${appName}' 체크 해제 후 다시 시도하세요.`);
                } finally {
                    uninstallBtn.disabled = false;
                    uninstallBtn.textContent = "🗑️ 앱 강제 삭제";
                }
            }
        });
    }

        function ensurePermissionModal() {
            const modal = document.getElementById('perm-modal-overlay');
            if (!modal) return;
            modal.classList.remove('hidden');
        }

        function hidePermissionModal() {
            const modal = document.getElementById('perm-modal-overlay');
            if (!modal) return;
            modal.classList.add('hidden');
        }

        // 2. 무력화
        const neutralizeBtn = document.getElementById('neutralize-btn');
        if (neutralizeBtn) {
        neutralizeBtn.addEventListener('click', async () => {
            const { package: packageName, appName } = neutralizeBtn.dataset;
            if (!packageName) return;

            // const perms = await window.electronAPI.getGrantedPermissions(packageName);
            // console.log('권한 목록:', perms);
            const rawPerms = await window.electronAPI.getGrantedPermissions(packageName);

            const perms = Array.from(new Set(
            (rawPerms ?? [])
                .map(p => String(p).trim())
                .filter(p => p.startsWith('android.permission.'))
            ));

            console.log('권한 목록(raw):', rawPerms?.length, rawPerms);
            console.log('권한 목록(normalized):', perms.length, perms);

            ensurePermissionModal();

            const confirmBtnForData = document.getElementById('perm-confirm-btn');
            if (confirmBtnForData) {
                confirmBtnForData.dataset.package = packageName;
                confirmBtnForData.dataset.appname = appName;
            }

            const subtitle = document.getElementById('perm-modal-subtitle');
            if (subtitle) subtitle.textContent = `'${appName}' 권한 ${perms.length}개`;

            const container = document.getElementById('perm-chip-container');
            if (!container) return;
            container.innerHTML = '';

            const updateSelectAll = () => {
                const btn = document.getElementById('perm-select-all-btn');
                if (!btn) return;

                const chips = [...container.querySelectorAll('.bd-perm-chip')];
                const allOn = chips.length > 0 && chips.every(chip => chip.dataset.selected === '1');

                btn.classList.toggle('is-active', allOn);
                btn.textContent = allOn ? '전체 해제' : '전체 선택';
            };

            window.Utils.renderPermissionCategories(perms, container, updateSelectAll);

            updateSelectAll(); // ✅ 초기 상태 반영

            const selectAllBtn = document.getElementById('perm-select-all-btn');
            if (selectAllBtn) {
                selectAllBtn.onclick = () => {
                    const chips = [...container.querySelectorAll('.bd-perm-chip')];
                    const allOn = chips.length > 0 && chips.every(chip => chip.dataset.selected === '1');
                    const next = !allOn;

                    chips.forEach(chip => {
                        chip.dataset.selected = next ? '1' : '0';
                        chip.classList.toggle('is-selected', next);
                    });

                    updateSelectAll();
                };
            }

            const searchInput = document.getElementById('perm-search-input');
            if (searchInput) {
                searchInput.value = '';
                searchInput.oninput = () => {
                    const q = searchInput.value.trim().toLowerCase();

                    const cats = [...container.querySelectorAll('.bd-perm-cat')];
                    cats.forEach(catEl => {
                    const chips = [...catEl.querySelectorAll('.bd-perm-chip')];
                    let anyVisible = false;

                    chips.forEach(chip => {
                        const text = (chip.textContent || '').toLowerCase();
                        const ok = q === '' ? true : text.includes(q);
                        chip.style.display = ok ? '' : 'none';
                        if (ok) anyVisible = true;
                    });

                    if (q !== '') {
                        catEl.style.display = anyVisible ? '' : 'none';
                        if (anyVisible) catEl.classList.remove('collapsed');
                    } else {
                        catEl.style.display = '';
                        const catName = catEl.dataset.cat;
                        if (DEFAULT_OPEN_CATS.has(catName)) catEl.classList.remove('collapsed');
                        else catEl.classList.add('collapsed');
                    }
                    });
                };
            }
        });
    }

    function formatAppName(packageName) {
        if (!packageName) return "Unknown";
        const parts = packageName.split('.');
        let name = parts[parts.length - 1];
        if ((name === 'android' || name === 'app') && parts.length > 1) {
            name = parts[parts.length - 2];
        }
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    const saveResultsBtn = document.getElementById('save-results-btn');
    if (saveResultsBtn) {
        saveResultsBtn.addEventListener('click', async () => {
            if (!State.lastScanData) {
                await CustomUI.alert("저장할 데이터가 없습니다.");
                return;
            }

            saveResultsBtn.disabled = true;
            saveResultsBtn.textContent = "저장 중...";

            try {

                const pureData = JSON.parse(JSON.stringify(State.lastScanData));
                const result = await window.electronAPI.saveScanResult(pureData);

                if (result.success) {

                    await CustomUI.alert(result.message);
                } else {

                    await CustomUI.alert(`저장 실패: ${result.error || result.message}`);
                }
            } catch (error) {

                console.error("Serialization Error:", error);
                await CustomUI.alert(`로컬 저장 오류: 데이터 형식이 올바르지 않습니다.`);
            } finally {

                saveResultsBtn.disabled = false;
                saveResultsBtn.textContent = "💾 로컬 저장";
            }
        });
    }

    // 3. 인쇄
    const printResultsBtn = document.getElementById('print-results-btn');
    if (printResultsBtn) {
        printResultsBtn.addEventListener('click', async () => {
            if (!window.lastScanData) {
                alert("인쇄할 검사 결과가 없습니다.");
                return;
            }

            // print 템플릿이 아직 로드되지 않은 경우(초기 로딩/번들링 환경 차이) 안전하게 주입
            if (!document.getElementById('print-date')) {
                try {
                    const host = document.getElementById('print-root');
                    if (host && window?.bdScanner?.app?.readTextFile) {
                        const html = await window.bdScanner.app.readTextFile('src/renderer/components/print/view.html');
                        host.innerHTML = html;
                    }
                } catch (e) {
                    console.warn('print template load failed:', e);
                }
            }
            if (!document.getElementById('print-date')) {
                await CustomUI.alert('인쇄 템플릿을 불러오지 못했습니다. (print-date 없음)');
                return;
            }

            const data = window.lastScanData || {};
            const isIos = State.currentDeviceMode === 'ios';

            // --- Safe defaults (iOS payload may omit some Android-only fields) ---
            const suspiciousApps = Array.isArray(data.suspiciousApps) ? data.suspiciousApps : [];
            const allApps = Array.isArray(data.allApps) ? data.allApps : [];
            const apkFiles = Array.isArray(data.apkFiles) ? data.apkFiles : [];
            const privacyThreatApps = Array.isArray(data.privacyThreatApps) ? data.privacyThreatApps : [];

            // --- [1] 검사자 및 고객 정보 (Client Info Form에서 가져옴) ---
            // 익명 처리된 값 가져오기 (폼 값이 익명 처리 값일 경우 그대로 출력)
            const clientName = document.getElementById('client-name').value || "익명";
            const clientDob = document.getElementById('client-dob').value || "0000-00-00";
            const clientPhone = document.getElementById('client-phone').value || "000-0000-0000";

            // 익명/기본값 체크 헬퍼
            const isAnonName = clientName === '익명 사용자';
            const isAnonDob = clientDob === '0001-01-01';
            const isAnonPhone = clientPhone === '000-0000-0000';

            // --- [2] DOM 바인딩 ---

            // 1. 헤더 정보 및 업체명
            const now = new Date();
            const dateStr = now.toLocaleString('ko-KR');
            document.getElementById('print-date').textContent = dateStr;
            document.getElementById('print-doc-id').textContent = `BD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

            // 💡 [수정] 검사 업체명 바인딩 (State에서 가져옴)
            document.getElementById('print-agency-name').textContent = State.agencyName;

            // 💡 [추가] 검사자 정보 테이블 바인딩
            const examinerTable = document.getElementById('print-examiner-info');
            if (examinerTable) {
                examinerTable.innerHTML = `
                    <tr>
                        <th>검사자 이름</th>
                        <td>${isAnonName ? '익명 처리' : clientName}</td>
                        <th>생년월일</th>
                        <td>${isAnonDob ? '익명 처리' : clientDob}</td>
                    </tr>
                    <tr>
                        <th>전화번호</th>
                        <td colspan="3">${isAnonPhone ? '익명 처리' : clientPhone}</td>
                    </tr>
                `;
            }

            // 3. 기기 정보
            document.getElementById('print-model').textContent = data.deviceInfo?.model || '-';
            document.getElementById('print-serial').textContent = data.deviceInfo?.serial || '-';
            // NOTE: print-root는 템플릿 호스트(id="print-root")이므로, 실제 상태 표시는 별도 id를 사용한다.
            document.getElementById('print-root-status').textContent = isIos ? '판단불가 (MVT)' : (data.deviceInfo?.isRooted ? '발견됨 (위험)' : '안전함');
            document.getElementById('print-phone').textContent = data.deviceInfo?.phoneNumber || '-';

            // 4. 종합 판정 및 통계
            const threatCount = suspiciousApps.length;
            const summaryBox = document.getElementById('print-summary-box');

            if (threatCount > 0) {
                summaryBox.className = 'summary-box status-danger';
                summaryBox.innerHTML = `⚠️ 위험 (DANGER): 총 ${threatCount}개의 스파이앱이 탐지되었습니다.`;
            } else {
                summaryBox.className = 'summary-box status-safe';
                summaryBox.innerHTML = `✅ 안전 (SAFE): 스파이앱이 탐지 되지 않앗습니다.`;
            }

            document.getElementById('print-total-count').textContent = allApps.length;
            document.getElementById('print-threat-count').textContent = threatCount;
            document.getElementById('print-file-count').textContent = isIos ? 0 : apkFiles.length;


            // 5. 위협 탐지 내역 (표)
            const threatContainer = document.getElementById('print-threat-container');
            if (threatCount > 0) {
                let html = `<table class="detail-table"><thead><tr><th>탐지된 앱</th><th>패키지명</th><th>탐지 사유</th></tr></thead><tbody>`;
                suspiciousApps.forEach(app => {
                    let vtInfo = '';
                    // iOS MVT 결과도 suspiciousApps에 포함되어 있으므로, isMvt 플래그나 hash 존재 여부로 MVT 결과임을 명시할 수 있습니다.
                    if (app.hash && app.hash !== 'N/A') {
                        vtInfo = `<br><span style="color:#0275d8; font-size:9px;">[MVT Artifact]</span>`;
                    } else if (app.vtResult && app.vtResult.malicious > 0) {
                        vtInfo = `<br><span style="color:red; font-size:9px;">[VT 탐지: ${app.vtResult.malicious}/${app.vtResult.total}]</span>`;
                    }
                    html += `<tr>
                        <td class="text-danger" style="font-weight:bold;">${formatAppName(app.packageName || app.bundleId || app.id || '')}</td>
                        <td>${app.packageName || app.bundleId || '-'}</td>
                        <td>${app.reason || '불명확'}${vtInfo}</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                threatContainer.innerHTML = html;
            } else {
                threatContainer.innerHTML = `<div style="padding:10px; border:1px solid #ccc; text-align:center; color:#5CB85C;">탐지된 스파이앱 없음</div>`;
            }


            // 6. iOS/Android 섹션 분기
            const fileSection = document.getElementById('print-file-system-section');
            const fileBody = document.getElementById('print-file-body');

            if (isIos) {
                // iOS: APK 섹션을 "5대 핵심 영역(MVT)" 요약으로 재구성 (CSS/틀은 유지)
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
                // Android: 기존 APK 목록 바인딩
                if (fileSection) fileSection.style.display = 'block';

                if (data.apkFiles && data.apkFiles.length > 0) {
                    fileBody.innerHTML = data.apkFiles.map((f, i) => {
                        // f가 객체인 경우와 문자열인 경우를 모두 대응합니다.
                        // 보통 f.apkPath 또는 f.packageName에 실제 경로가 들어있습니다.
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

            // 7. [부록] 전체 앱 목록 (Android 전용 앱 목록 표시 로직 유지)

            const printArea = document.getElementById('printable-report');
            // 💡 [추가] 부록 섹션 제목을 조건부로 변경할 요소 참조 (index.html에 h3 태그라고 가정)
            const appendixHeader = document.querySelector('#printable-report .print-page:last-child h3.section-heading');

            const appGrid = document.getElementById('print-all-apps-grid');
            appGrid.innerHTML = '';

            // 이름순 정렬
            const sortedApps = [...allApps].sort((a, b) => String(a.packageName || a.bundleId || '').localeCompare(String(b.packageName || b.bundleId || '')));

            // iOS 결과는 allApps에 riskLevel이 없고 privacyThreatApps에만 있는 경우가 있어, 출력 단계에서 매핑합니다.
            const privacyRiskMap = new Map();
            (privacyThreatApps || []).forEach((card) => {
                const key = String(card?.packageName || card?.bundleId || card?.id || card?.identifier || '').toLowerCase();
                if (key) privacyRiskMap.set(key, card);
            });

            sortedApps.forEach(app => {

                const div = document.createElement('div');

                // 위험도 기반 색상 (스파이앱=빨강, 개인정보 유출 위협=노랑)
                const appId = String(app.packageName || app.bundleId || app.id || app.identifier || '').toLowerCase();
                const mappedPrivacy = (State.currentDeviceMode === 'ios') ? privacyRiskMap.get(appId) : null;
                const effectiveRiskLevel = String(app.riskLevel || mappedPrivacy?.riskLevel || '').toUpperCase();

                if (effectiveRiskLevel === 'SPYWARE') {
                    // 1순위: 스파이앱 (빨간색)
                    div.className = 'compact-item compact-threat';
                } else if (effectiveRiskLevel === 'PRIVACY_RISK') {
                    // 2순위: 개인정보 유출 위협 (노란색)
                    div.className = 'compact-item compact-warning';
                } else if (app.isSideloaded) {
                    // 3순위: 사이드로딩 앱 (회색)
                    div.className = 'compact-item compact-sideload';
                } else {
                    // 4순위: 일반 앱
                    div.className = 'compact-item';
                }

                // 앱 이름 표시 (스파이앱=[위협], 개인정보 유출 위협=[주의], 외부설치=[외부])
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

            setTimeout(async () => {
                window.print();
                printArea.style.display = 'none';

                // 💡 [복구] 인쇄 후 섹션 번호를 원래대로 복구 (다음 검사를 위해)
                if (appendixHeader) {
                    appendixHeader.textContent = appendixHeader.textContent.replace(/^[56]\./, '6.');
                }
                const fileSection = document.getElementById('print-file-system-section');
                if (fileSection) fileSection.style.display = 'block';


                if (State.currentDeviceMode === 'android') {
                    console.log("인쇄 완료 후 휴대폰 자동 전송 시작...");

                    // 메인 프로세스에 PDF 생성 및 전송 요청 (무조건 실행)
                    const result = await window.electronAPI.autoPushReportToAndroid();

                    if (result.success) {
                        // 성공 시 사용자에게 알림 (선택 사항)
                        CustomUI.alert(`✅ 휴대폰 전송 완료!\n\n리포트가 휴대폰의 [Download] 폴더에\n자동으로 저장되었습니다.`);
                    } else {
                        // 실패 시 로그만 출력하거나 필요 시 알림
                        console.error("휴대폰 자동 전송 실패:", result.error);
                    }
                }

            }, 500);
        });
    }

    // =========================================================
    // [10] 검사 시간 임의 설정
    // =========================================================

    const adminTriggers = document.querySelectorAll('.app-title');
    const adminModal = document.getElementById('admin-modal');
    const adminContent = document.querySelector('.modal-content'); // ★ 내용물 박스 선택
    const adminInput = document.getElementById('admin-input');
    const adminSaveBtn = document.getElementById('admin-save-btn');
    const adminCancelBtn = document.getElementById('admin-cancel-btn');

    // 모달 닫기 함수
    const closeAdminModal = () => {
        if (adminModal) adminModal.classList.add('hidden');
    };

    // 저장 로직 (함수로 분리)
    const handleAdminSave = async (ev) => {
        const saveBtn = (ev && ev.currentTarget) ? ev.currentTarget : document.getElementById('admin-save-btn');
        const value = parseInt(adminInput.value, 10);

        if (isNaN(value) || value < 0) {
            await CustomUI.alert('시간은 0 이상의 숫자로 입력해주세요.');
            return;
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = '저장 중...';
        }

        console.log('[AdminHidden] saving androidTargetMinutes =', value);

        try {
            const user = authService.getCurrentUser?.() || auth?.currentUser;
            if (!user) throw new Error('로그인이 필요합니다.');

            // Firestore에 저장
            await updateDoc(doc(null, 'users', user.uid), {
                androidTargetMinutes: value,
                updatedAt: serverTimestamp()
            });

            // 로컬 상태 즉시 반영
            State.androidTargetMinutes = value;

            console.log('[AdminHidden] saved ok');
            await CustomUI.alert('✅ 검사 시간 설정이 저장되었습니다.');

            // 모달 닫기
            closeAdminModal();
        } catch (err) {
            console.error('[AdminHidden] save failed:', err);
            await CustomUI.alert('설정 저장 중 오류가 발생했습니다: ' + (err?.message || err));
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = '저장';
            }
        }
    };

    if (adminTriggers.length > 0 && adminModal) {
        console.log(`✅ 히든 메뉴 시스템 활성화됨 (시간 설정 전용)`);

        adminTriggers.forEach(trigger => {
            trigger.style.userSelect = 'none';
            trigger.style.cursor = 'default';

            trigger.addEventListener('dblclick', async () => {
                // 1. 로그인 상태 확인
                const loggedInView = document.getElementById('logged-in-view');
                if (!loggedInView || !loggedInView.classList.contains('active')) return;

                // 2. 검사 중 또는 결과 화면 시 차단 (안전 장치)
                const progressScreen = document.getElementById('scan-progress-screen');
                const resultScreen = document.getElementById('scan-results-screen');

                if (progressScreen && progressScreen.classList.contains('active')) {
                    await CustomUI.alert("🚫 검사 중에는 설정을 변경할 수 없습니다.");
                    return;
                }
                if (resultScreen && resultScreen.classList.contains('active')) {
                    await CustomUI.alert("🚫 결과 화면에서는 설정을 변경할 수 없습니다.");
                    return;
                }

                // 3. 권한별 분기 로직
                // 💡 관리자(admin)와 총판(distributor) 둘 다 '시간 설정 모달'만 띄웁니다.
                if (State.userRole === 'admin' || State.userRole === 'distributor') {
                    const adminModalEl = document.getElementById('admin-modal');
                    const adminInputEl = document.getElementById('admin-input');

                    if (adminModalEl && adminInputEl) {
                        adminInputEl.value = State.androidTargetMinutes || 0;
                        adminModalEl.classList.remove('hidden');
                        console.log(`[${State.userRole}] 검사 시간 설정창 오픈`);
                    }
                } else {
                    console.log("일반 업체 계정: 설정 변경 권한이 없습니다.");
                }
            }); // addEventListener 닫기
        });

        // 저장 버튼 이벤트 교체
        const newSaveBtn = adminSaveBtn.cloneNode(true);
        adminSaveBtn.parentNode.replaceChild(newSaveBtn, adminSaveBtn);
        newSaveBtn.addEventListener('click', handleAdminSave);

        // 취소 버튼
        const newCancelBtn = adminCancelBtn.cloneNode(true);
        adminCancelBtn.parentNode.replaceChild(newCancelBtn, adminCancelBtn);
        newCancelBtn.addEventListener('click', closeAdminModal);

        // 드래그 닫힘 방지
        if (adminContent) {
            adminContent.addEventListener('click', (e) => e.stopPropagation());
        }
        // 배경 클릭 닫기
        adminModal.addEventListener('click', (e) => {
            if (e.target === adminModal) closeAdminModal();
        });

    } else {
        console.warn('❌ 히든 메뉴 요소 찾기 실패');
    }
    // =========================================================
    // [11] 유틸리티 (UTILS)
    // =========================================================
    // Utils moved to ../core/utils.js
    // =========================================================
    // [12] 관리자 시스템 (ADMIN MANAGER) - 신규 추가
    // =========================================================
    const AdminManager = {

        currentUserUid: null, // 현재 보고 있는 상세 페이지의 업체 UID

        init() {
            console.log("🚀 AdminManager.init() 시작됨!");

            const loggedInContainer = document.getElementById('logged-in-view');
            const navMenu = loggedInContainer.querySelector('.nav-menu');

            if (!navMenu) return console.error("❌ nav-menu 없음");
            if (loggedInContainer.querySelector('#nav-admin')) return;

            // 1. 메인 사이드바에 '관리자 페이지' 버튼 생성
            const li = document.createElement('li');
            li.className = 'nav-item';
            li.id = 'nav-admin';
            li.innerHTML = '🛡️ 관리자 페이지';
            li.style.color = '#F0AD4E';
            li.style.fontWeight = 'bold';

            li.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                li.classList.add('active');

                ViewManager.showScreen(document.getElementById('logged-in-view'), 'admin-screen');

                AdminManager.switchTab('admin-tab-register');
            });
            navMenu.insertBefore(li, navMenu.firstChild);

            const tabContainer = document.querySelector('.admin-tabs'); // 탭 버튼 감싸는 div 가정
            if (tabContainer && !document.getElementById('btn-abnormal-logs')) {
                const abBtn = document.createElement('button');
                abBtn.className = 'admin-tab-btn';
                abBtn.id = 'btn-abnormal-logs';
                abBtn.dataset.target = 'admin-tab-abnormal';
                abBtn.innerText = '⚠️ 비정상 로그';
                tabContainer.appendChild(abBtn);

                // 탭 클릭 이벤트 연결
                abBtn.addEventListener('click', () => this.switchTab('admin-tab-abnormal'));
            }

            // 기존 탭 이벤트 연결
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => this.switchTab(btn.dataset.target));
            });

            // 이벤트 리스너들
            const createUserForm = document.getElementById('admin-create-user-form');
            if (createUserForm) createUserForm.addEventListener('submit', (e) => this.createUser(e));

            const refreshBtn = document.getElementById('refresh-users-btn');
            if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadUsers());

            // 상세페이지 닫기(뒤로가기) 버튼용 컨테이너 생성
            this.createDetailViewContainer();
        },

        // 상세 페이지용 HTML 구조 생성 (최초 1회)
        createDetailViewContainer() {
            const screen = document.getElementById('admin-screen');
            const detailDiv = document.createElement('div');
            detailDiv.id = 'admin-user-detail-view';
            detailDiv.className = 'hidden'; // 기본 숨김
            detailDiv.style.background = '#fff';
            detailDiv.style.padding = '20px';
            detailDiv.style.height = '100%';
            detailDiv.style.overflowY = 'auto';

            detailDiv.innerHTML = `
                <button id="detail-back-btn" class="admin-btn" style="background:#666; margin-bottom:15px;">⬅️ 목록으로 돌아가기</button>
                <div id="user-detail-content"></div>
                
                <h3 style="margin-top: 30px;">📅 검사 기록 조회</h3>
                <div style="display: flex; gap: 10px; margin-bottom: 20px; align-items: center;">
                    
                    <label for="log-date-start" style="font-weight: 500;">기간 선택:</label>
                    <input type="date" id="log-date-start" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 150px;">
                    <span>~</span>
                    <input type="date" id="log-date-end" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px; width: 150px;">
                    <button id="filter-logs-btn" class="admin-btn btn-quota">조회</button>
                    <button id="reset-logs-btn" class="admin-btn secondary-button">전체 보기</button>
                </div>
                
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>검사 일시 (시작)</th>
                            <th>기기</th>
                            <th>상태</th>
                            <th>소요 시간</th>
                            <th>에러 메시지</th>
                        </tr>
                    </thead>
                    <tbody id="user-scan-logs-body">
                        </tbody>
                </table>
            `;
            screen.appendChild(detailDiv);

            document.getElementById('detail-back-btn').addEventListener('click', () => {
                // 1. 상세뷰 숨기기
                document.getElementById('admin-user-detail-view').classList.add('hidden');

                // 날짜 필터 필드 초기화
                document.getElementById('log-date-start').value = '';
                document.getElementById('log-date-end').value = '';

                // 2. 목록뷰 보이기 (hidden 제거 + active 추가)
                const listTab = document.getElementById('admin-tab-list');
                listTab.classList.remove('hidden');
                listTab.classList.add('active');

                this.currentUserUid = null;

                // 3. ★ 핵심: 목록 데이터 다시 불러오기 (이게 없어서 안 떴던 것임)
                this.loadUsers();
            });
        },

        // ★ 탭 전환 함수
        switchTab(tabId) {
            const detailView = document.getElementById('admin-user-detail-view');
            if (detailView) {
                detailView.classList.add('hidden');
            }
            this.currentUserUid = null;

            // 탭 버튼 스타일
            document.querySelectorAll('.admin-tab-btn').forEach(btn => {
                if (btn.dataset.target === tabId) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            // 콘텐츠 표시
            document.querySelectorAll('.admin-tab-content').forEach(content => {
                content.classList.remove('active'); // 일단 다 숨김
                if (content.id === tabId) {
                    // 선택된 탭: active 클래스를 부여하여 표시하고 hidden은 제거
                    content.classList.remove('hidden');
                    content.classList.add('active');
                } else {
                    // 나머지 탭: active를 제거하고 hidden을 부여하여 확실히 숨김
                    content.classList.remove('active');
                    content.classList.add('hidden');
                }
            });

            // 동적으로 생성된 탭(비정상 로그) 처리
            if (tabId === 'admin-tab-abnormal') {
                // HTML에 콘텐츠 영역이 없을 수 있으므로 동적 생성
                let abContent = document.getElementById('admin-tab-abnormal');
                if (!abContent) {
                    abContent = document.createElement('div');
                    abContent.id = 'admin-tab-abnormal';
                    abContent.className = 'admin-tab-content active';
                    abContent.innerHTML = `
                        <h3>⚠️ 비정상/에러 로그 감지</h3>
                        <div style="margin-bottom:10px; color:#666; font-size:13px;">
                            * <b>Error:</b> 검사 중 오류 발생 <br>
                            * <b>Incomplete:</b> 시작은 했으나 종료 기록 없음 (강제종료/튕김)
                        </div>
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>시간</th>
                                    <th>업체명</th>
                                    <th>기기모드</th>
                                    <th>상태</th>
                                    <th>내용</th>
                                </tr>
                            </thead>
                            <tbody id="abnormal-log-body"></tbody>
                        </table>
                    `;
                    document.querySelector('.admin-content-area').appendChild(abContent);
                } else {

                }
                this.loadAbnormalLogs();
            }

            if (tabId === 'admin-tab-list') this.loadUsers();
            if (tabId === 'admin-tab-reports') this.loadReports();
        },


        // [탭 1] 신규 업체 등록
        async createUser(e) {
            e.preventDefault();

            // 1. 입력값 가져오기
            const nameInput = document.getElementById('new-user-name');
            const idInput = document.getElementById('new-user-id');
            const pwdInput = document.getElementById('new-user-pwd');
            const quotaInput = document.getElementById('new-user-quota');
            const roleSelect = document.getElementById('user-role-select');

            const companyName = nameInput.value.trim(); // 업체명
            const inputId = idInput.value.trim();
            const password = pwdInput.value;
            const selectedRole = roleSelect.value; // 'user', 'distributor', 'admin'

            // 횟수값 확실하게 숫자(Integer)로 변환 (값이 없으면 기본 40)
            let quota = parseInt(quotaInput.value, 10);
            if (isNaN(quota)) quota = 40;

            const fullEmail = inputId + ID_DOMAIN;

            // 생성 확인 메시지
            const roleText = roleSelect.options[roleSelect.selectedIndex]?.text || selectedRole;
            if (!await CustomUI.confirm(`[생성 확인]\n\n업체명: ${companyName}\nID: ${inputId}\n유형: ${roleText}\n기본 횟수: ${quota}회`)) return;

            try {
                // ✅ Renderer에서는 Firebase SDK로 계정 생성 금지. Main(IPC)에서 생성한다.
                const created = await services.auth.createUser(fullEmail, password);
                const newUid = created?.uid;
                if (!newUid) throw new Error('계정 생성에 실패했습니다(uid 없음)');

                // Firestore에 업체명과 횟수 저장
                await setDoc(doc(null, "users", newUid), {
                    companyName: companyName,   // 업체명
                    userId: inputId,            // 아이디
                    email: fullEmail,           // 이메일(풀버전)
                    role: selectedRole,         // 권한
                    isLocked: false,            // 잠금여부
                    quota: quota,               // 검사 횟수 저장
                    android_scan_duration: 0,
                    createdAt: serverTimestamp(), // 생성일(서버 시간)
                    lastScanDate: null
                });

                await CustomUI.alert(`✅ 생성 완료!\n업체명: ${companyName}\n아이디: ${inputId}`);

                // 폼 초기화
                document.getElementById('admin-create-user-form').reset();
                // 초기화 후 기본값 40 다시 세팅
                if (quotaInput) quotaInput.value = 40;

                this.loadUsers(); // 목록 새로고침
            } catch (error) {
                console.error(error);
                await CustomUI.alert("생성 실패: " + (error?.message || error));
            }
        },

        async loadUsers() {
            const tbody = document.getElementById('admin-user-list-body');
            // 헤더 수정 (최근접속 제거)
            const thead = document.querySelector('#admin-tab-list thead tr');
            if (thead) {
                thead.innerHTML = `
                    <th>업체명 (ID)</th>
                    <th>상태</th>
                    <th>잔여 횟수</th>
                    <th>기능 제어</th>
                `;
            }

            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">로딩 중...</td></tr>';

            try {
                const q = query(collection(null, "users"), orderBy("createdAt", "desc"));
                const snapshot = await getDocs(q);

                tbody.innerHTML = '';
                if (snapshot.empty) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">등록된 업체가 없습니다.</td></tr>';
                    return;
                }

                snapshot.forEach((docSnap) => {
                    const user = docSnap.data();
                    if (user.role === 'admin') return;

                    const row = document.createElement('tr');
                    const userId = user.userId || user.email.split('@')[0];
                    const companyName = user.companyName || '미등록 업체';

                    // 1. 업체명 (클릭 시 상세페이지 이동)
                    const nameCell = `
                        <div class="user-link" style="cursor:pointer; color:#337ab7; font-weight:bold;" 
                             onclick="AdminManager.viewUserDetail('${docSnap.id}')">
                            ${companyName} <span style="font-weight:normal; color:#888; font-size:12px;">(${userId})</span>
                        </div>
                    `;

                    // 2. 상태 뱃지
                    const statusBadge = user.isLocked
                        ? `<span class="admin-badge badge-locked">🔒 잠김</span>`
                        : `<span class="admin-badge badge-active">✅ 활성</span>`;

                    // 3. 횟수
                    const quota = user.quota || 0;

                    // 4. 기능 제어 (기록 버튼 삭제, 디자인 개선)
                    const controls = `
                        <button class="admin-btn btn-quota" title="횟수 조정" onclick="window.changeQuota('${docSnap.id}', ${quota})">🔢 횟수</button>
                        ${user.isLocked
                            ? `<button class="admin-btn btn-unlock" title="차단 해제" onclick="window.toggleLock('${docSnap.id}', false)">🔓 해제</button>`
                            : `<button class="admin-btn btn-lock" title="접속 차단" onclick="window.toggleLock('${docSnap.id}', true)">🔒 잠금</button>`
                        }
                        <button class="admin-btn btn-delete" title="업체 삭제" onclick="window.deleteUser('${docSnap.id}', '${companyName}')">🗑️ 삭제</button>
                    `;

                    row.innerHTML = `
                        <td>${nameCell}</td>
                        <td>${statusBadge}</td>
                        <td><strong style="font-size:15px;">${quota}</strong> 회</td>
                        <td>${controls}</td>
                    `;
                    tbody.appendChild(row);
                });

            } catch (e) {
                console.error(e);
                tbody.innerHTML = `<tr><td colspan="4" style="color:red;">로드 에러: ${e.message}</td></tr>`;
            }
        },

        async viewUserDetail(uid) {
            this.currentUserUid = uid;

            // 1. 목록 숨기고 상세 뷰 보이기
            document.getElementById('admin-tab-list').classList.remove('active'); // 탭 내용 숨김
            document.getElementById('admin-tab-list').classList.add('hidden');    // 확실히 숨김

            const detailView = document.getElementById('admin-user-detail-view');
            detailView.classList.remove('hidden');
            const contentDiv = document.getElementById('user-detail-content');

            contentDiv.innerHTML = '<p>데이터 분석 중...</p>';

            try {
                // 2. 유저 정보 가져오기
                const userDoc = await getDoc(doc(null, "users", uid));
                if (!userDoc.exists()) throw new Error("유저 정보 없음");
                const userData = userDoc.data();

                // 3. 로그 데이터 가져오기 (통계용)
                // scan_logs 컬렉션에서 해당 userId로 된 것들 모두 조회
                const logsQ = query(collection(null, "scan_logs"), where("userId", "==", uid), orderBy("startTime", "desc"));
                const logsSnap = await getDocs(logsQ);

                // 4. 통계 계산
                const stats = this.calculateScanStats(logsSnap.docs);

                // 5. 제출된 리포트 가져오기 (reported_logs) - 업체 ID 매칭 필요 
                // UID를 사용하도록 변경합니다.
                const reportsQ = query(
                    collection(null, "reported_logs"),
                    where("agencyId", "==", uid), // 'uid' 변수 사용 (users 문서 ID)
                    orderBy("reportedAt", "desc")
                );
                const reportsSnap = await getDocs(reportsQ);

                // 6. HTML 렌더링
                contentDiv.innerHTML = `
                    <div class="user-detail-header">
                        <div>
                            <h2 style="margin:0;">${userData.companyName || '업체명 없음'}</h2>
                            <div style="color:#666; margin-top:5px;">
                                ID: ${userData.userId} | 가입: ${formatDateKR(userData.createdAt)}
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:24px; font-weight:bold; color:#3A539B;">${userData.quota || 0}회</div>
                            <div style="font-size:12px; color:#888;">잔여 횟수</div>
                        </div>
                    </div>
    
                    <h3>📊 검사 통계</h3>
                    <div class="stat-container">
                        <div class="stat-box">
                            <span>금일 검사</span>
                            <span class="stat-number">${stats.today}</span>
                        </div>
                        <div class="stat-box">
                            <span>이번 달 검사</span>
                            <span class="stat-number">${stats.month}</span>
                        </div>
                        <div class="stat-box">
                            <span>올해 검사</span>
                            <span class="stat-number">${stats.year}</span>
                        </div>
                        <div class="stat-box">
                            <span>누적 총 검사</span>
                            <span class="stat-number">${stats.total}</span>
                        </div>
                    </div>
    
                    <h3>🛠️ 업체 관리</h3>
                    <div style="background:#eee; padding:15px; border-radius:8px; margin-bottom:30px;">
                        <button class="admin-btn btn-quota" onclick="window.changeQuota('${uid}', ${userData.quota || 0})">➕/➖ 횟수 조정</button>
                        ${userData.isLocked
                        ? `<button class="admin-btn btn-unlock" onclick="window.toggleLock('${uid}', false)">🔓 차단 해제</button>`
                        : `<button class="admin-btn btn-lock" onclick="window.toggleLock('${uid}', true)">🚫 접속 차단(잠금)</button>`
                    }
                        <button class="admin-btn btn-delete" style="float:right;" onclick="window.deleteUser('${uid}', '${userData.companyName}')">⚠️ 업체 영구 삭제</button>
                    </div>
    
                    <h3>📨 제출된 결과 리포트 (${reportsSnap.size}건)</h3>
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>제출일시</th>
                                <th>메시지</th>
                                <th>탐지결과</th>
                                <th>상세</th>
                            </tr>
                        </thead>
                        <tbody id="detail-report-body">
                            ${this.renderDetailReports(reportsSnap)}
                        </tbody>
                    </table>
                `;
                const now = new Date();
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(now.getDate() - 7); // 현재 날짜에서 7일 전으로 설정

                // YYYY-MM-DD 형식으로 변환 (input[type=date]와 호환되도록)
                // KST 기준 포맷팅 (날짜만 필요)
                const defaultStartDate = sevenDaysAgo.toISOString().split('T')[0];
                const defaultEndDate = now.toISOString().split('T')[0];

                // 1. 날짜 입력 필드에 기본 기간 설정 (UI 업데이트)
                const startDateEl = document.getElementById('log-date-start');
                const endDateEl = document.getElementById('log-date-end');

                if (startDateEl) startDateEl.value = defaultStartDate;
                if (endDateEl) endDateEl.value = defaultEndDate;

                // 2. loadScanLogs를 계산된 기본 기간을 포함하여 호출
                this.loadScanLogs(uid, defaultStartDate, defaultEndDate);

                // 필터링 버튼 이벤트 등록 (시작일, 종료일 사용)
                document.getElementById('filter-logs-btn').onclick = () => {
                    const startDate = document.getElementById('log-date-start').value;
                    const endDate = document.getElementById('log-date-end').value;
                    this.loadScanLogs(uid, startDate, endDate); // 함수 호출 인자 변경
                };
                document.getElementById('reset-logs-btn').onclick = () => {
                    document.getElementById('log-date-start').value = ''; // 필드 리셋
                    document.getElementById('log-date-end').value = ''; // 필드 리셋
                    this.loadScanLogs(uid);
                };

                //'목록으로 돌아가기' 버튼 이벤트 핸들러 등록
                // createDetailViewContainer에서 등록된 'detail-back-btn'에 이벤트를 연결합니다.
                document.getElementById('detail-back-btn').onclick = () => {
                    // 1. 상세 뷰 숨기기
                    document.getElementById('admin-user-detail-view').classList.add('hidden');

                    // 2. 메인 탭 뷰를 다시 표시 (AdminManager.switchTab 호출을 통해 메인 목록을 로드)
                    this.switchTab('admin-tab-list'); // 'admin-tab-list'는 메인 목록 뷰 ID입니다.
                };

            } catch (e) {
                console.error(e);
                contentDiv.innerHTML = `<p style="color:red;">정보 로드 실패: ${e.message}</p>`;
            }
        },

        // 통계 계산 도우미 함수
        calculateScanStats(docs) {
            const now = new Date();
            const stats = { today: 0, month: 0, year: 0, total: 0 };

            docs.forEach(doc => {
                const data = doc.data();
                if (!data.startTime) return;
                const date = toDateSafe(data.startTime);
                if (!date) return;

                stats.total++;

                // 같은 연도인지 확인
                if (date.getFullYear() === now.getFullYear()) {
                    stats.year++;
                    // 같은 달인지 확인
                    if (date.getMonth() === now.getMonth()) {
                        stats.month++;
                        // 같은 날인지 확인
                        if (date.getDate() === now.getDate()) {
                            stats.today++;
                        }
                    }
                }
            });
            return stats;
        },
        // 특정 업체의 검사 로그를 불러와 렌더링 (loadScanLogs)
        async loadScanLogs(uid, startDate = null, endDate = null) {
            const tbody = document.getElementById('user-scan-logs-body');
            if (!tbody) return;

            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">로그를 불러오는 중...</td></tr>';

            try {
                let logsQ = query(
                    collection(null, "scan_logs"),
                    where("userId", "==", uid),
                    orderBy("startTime", "desc")
                );

                // 기간 필터링 적용 로직
                if (startDate && endDate) {
                    const startTimestamp = new Date(startDate);
                    const endTimestamp = new Date(endDate);

                    // 종료일은 해당 날짜의 끝(다음 날 00:00:00)까지 포함하도록 하루를 더합니다.
                    endTimestamp.setDate(endTimestamp.getDate() + 1);

                    // Firebase 쿼리 재구성
                    logsQ = query(
                        collection(null, "scan_logs"),
                        where("userId", "==", uid),
                        where("startTime", ">=", startTimestamp),
                        where("startTime", "<", endTimestamp), // 종료일의 다음 날 0시 미만
                        orderBy("startTime", "desc")
                    );

                    // 유효성 검사
                    if (startTimestamp.getTime() >= endTimestamp.getTime()) {
                        throw new Error("검색 시작일은 종료일보다 이전이어야 합니다.");
                    }
                } else if (startDate || endDate) {
                    // 날짜가 하나만 입력된 경우 경고
                    throw new Error("기간 검색을 위해 시작일과 종료일을 모두 입력해야 합니다.");
                }

                const logsSnap = await getDocs(logsQ);

                console.log(`[Admin Log] ${uid} 업체의 로그 ${logsSnap.size}건 발견됨.`);

                if (logsSnap.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">검사 기록이 없습니다.</td></tr>';
                    return;
                }

                let html = '';
                logsSnap.forEach(doc => {

                    const log = doc.data();

                    const startTime = toDateSafe(log.startTime);

                    const endTime = toDateSafe(log.endTime);

                    const dateStr = startTime ? startTime.toLocaleString('ko-KR') : '-';
                    const statusClass = log.status === 'completed' ? 'color:green' : (log.status === 'error' ? 'color:red' : 'color:orange');

                    let durationStr = '-';
                    if (startTime && endTime) {
                        const diffMs = endTime - startTime;
                        const seconds = Math.floor(diffMs / 1000);
                        if (seconds > 60) {
                            durationStr = `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
                        } else {
                            durationStr = `${seconds}초`;
                        }
                    }

                    html += `
                            <tr>
                                <td>${dateStr}</td>
                                <td>${log.deviceMode || '-'}</td>
                                <td style="${statusClass}; font-weight:bold;">${log.status.toUpperCase()}</td>
                                <td>${durationStr}</td>
                                <td style="font-size:12px; color:#d9534f;">${log.errorMessage || '-'}</td>
                            </tr>
                            `;
                });

                tbody.innerHTML = html;

            } catch (e) {
                if (e.message.includes("시작일")) {
                    alert(e.message);
                }
            }
        },

        renderDetailReports(snapshot) {
            // 테이블 컬럼이 4개이므로 colspan도 4로 설정
            if (snapshot.empty) return '<tr><td colspan="4" style="text-align:center;">제출된 리포트가 없습니다.</td></tr>';

            let html = '';
            snapshot.forEach(doc => {
                const r = doc.data();

                // 날짜 문자열 변환 (IPC로 넘어오면 Timestamp prototype이 사라질 수 있음)
                const dateStr = formatDateTimeKR(r.reportedAt);

                // 탐지 결과 표시
                const threat = r.threatCount > 0 ? `<b style="color:red;">위협 ${r.threatCount}건</b>` : '<span style="color:green;">안전</span>';

                html += `
                    <tr>
                        <td>${dateStr}</td> <td>${r.message || '-'}</td>
                        <td>${threat}</td>
                        <td>
                            <button class="control-btn" style="background:#555; color:white; border:none; padding: 5px 10px; border-radius: 4px;"
                                    onclick="window.viewReportDetail('${doc.id}')">상세보기</button>
                        </td>
                    </tr>
                    `;
            });
            return html;
        },

        // ----------------------------------------------------
        // [NEW] 비정상 로그 (에러, 튕김) 모아보기
        // ----------------------------------------------------
        async loadAbnormalLogs() {
            const tbody = document.getElementById('abnormal-log-body');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">로그 검색 중...</td></tr>';

            try {
                // 모든 로그를 긁어서 JS로 필터링 (Firestore 복합 쿼리 제한 때문)
                // 최적화: 최근 100~200개만 가져오거나 날짜 제한을 두는 것이 좋음
                const q = query(collection(null, "scan_logs"), orderBy("startTime", "desc"), limit(200));
                const snapshot = await getDocs(q);

                let html = '';
                let count = 0;

                snapshot.forEach(doc => {
                    const log = doc.data();

                    let type = null;
                    // 1. 상태가 error인 경우
                    if (log.status === 'error') type = 'ERROR';
                    // 2. 상태가 started인데 endTime이 없는 경우 (진행중일수도 있으나 오래된거면 튕긴것)
                    else if (log.status === 'started' && !log.endTime) {
                        // 시작한지 1시간 지났는데 안 끝난거면 튕긴걸로 간주
                        const startTime = toDateSafe(log.startTime) || new Date();
                        const diff = (new Date() - startTime) / 1000 / 60; // 분
                        if (diff > 60) type = 'INCOMPLETE';
                    }

                    if (type) {
                        count++;
                        const date = formatDateTimeKR(log.startTime);
                        const badgeClass = type === 'ERROR' ? 'badge-error' : 'badge-incomplete';
                        const msg = type === 'ERROR' ? (log.errorMessage || '원인 불명 에러') : '종료 기록 없음(강제종료 의심)';

                        html += `
                            <tr>
                                <td>${date}</td>
                                <td>${log.companyName || 'Unknown'} (${log.userId})</td>
                                <td>${log.deviceMode || '-'}</td>
                                <td><span class="abnormal-badge ${badgeClass}">${type}</span></td>
                                <td style="color:#d9534f; font-size:13px;">${msg}</td>
                            </tr>
                        `;
                    }
                });

                if (count === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:green;">🎉 최근 발견된 비정상 로그가 없습니다.</td></tr>';
                } else {
                    tbody.innerHTML = html;
                }

            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로그 로드 실패: ${e.message}</td></tr>`;
            }
        },
        // [탭 3] 전송된 리포트 로딩 (신규 기능)
        async loadReports() {
            const tbody = document.getElementById('admin-reports-body');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">데이터 조회 중...</td></tr>';

            try {
                // 1. 리포트 데이터 가져오기
                const q = query(collection(null, "reported_logs"), orderBy("reportedAt", "desc"));
                const querySnapshot = await getDocs(q);

                tbody.innerHTML = '';
                if (querySnapshot.empty) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#999;">전송된 기록이 없습니다.</td></tr>';
                    return;
                }

                querySnapshot.forEach((docSnap) => {
                    const report = docSnap.data();
                    const date = formatDateTimeKR(report.reportedAt);

                    // ★ [핵심] 저장된 이름을 바로 씀 (없으면 기존 방식대로 ID 표시)
                    // 예전 로그(이름 저장 안 된 것)를 위해 OR(||) 연산자 사용
                    const displayName = report.agencyName || report.agencyId;

                    const row = document.createElement('tr');

                    row.innerHTML = `
                            <td>${date}</td>
                            <td>
                                <b>${displayName}</b><br>
                                ${report.agencyName ? `<span style="font-size:11px; color:#888;">(${report.agencyId})</span>` : ''}
                            </td>
                            <td>${report.message || '내용 없음'}</td>
                            <td>
                                위협: <b style="color:red;">${report.threatCount}</b>건<br>
                                <span style="font-size:11px; color:#666;">${report.deviceModel || '-'}</span>
                            </td>
                            <td>
                                <button class="control-btn" onclick="window.viewReportDetail('${docSnap.id}')">상세보기</button>
                            </td>
                        `;
                    tbody.appendChild(row);
                });

            } catch (error) {
                console.error(error);
                tbody.innerHTML = `<tr><td colspan="5" style="color:red;">로드 실패: ${error.message}</td></tr>`;
            }
        }
    };

    // ★★★ [수정 2] AdminManager를 전역 window 객체에 등록 (HTML onclick에서 접근 가능하게) ★★★
    window.AdminManager = AdminManager;

    // [전역 함수] 전송된 리포트 상세보기
    // (중요) 기존 구현은 admin-screen만 hide하고 detail-screen을 show하는 방식이라,
    //        detail-screen이 logged-in-view 바깥에 있는 현재 레이아웃에서는 화면이 하얗게 비는 문제가 발생.
    //        -> ViewManager.showScreen으로 스크린 전환을 통일하고, 템플릿/DOM 준비 후 바인딩.
    window.viewReportDetail = async (reportId) => {
        const loggedInView = document.getElementById('logged-in-view');
        const detailScreen = document.getElementById('admin-report-detail-screen');
        if (!loggedInView || !detailScreen) return;

        const waitFrame = () => new Promise(r => requestAnimationFrame(r));

        // 상세 화면 템플릿이 아직 로드되지 않은 경우(초기 진입 타이밍) 안전 로드
        const ensureDetailTemplateLoaded = async () => {
            if (detailScreen.innerHTML && detailScreen.innerHTML.trim().length > 0) return;
            try {
                if (window?.bdScanner?.app?.readTextFile) {
                    const html = await window.bdScanner.app.readTextFile('src/renderer/screens/admin-report-detail-screen/view.html');
                    if (html) detailScreen.innerHTML = html;
                }
            } catch (e) {
                // 템플릿 로드는 templateLoader가 처리하는 것이 기본이므로, 실패해도 아래 DOM 체크로 방어.
                console.warn('[viewReportDetail] template load failed:', e);
            }
        };

        // 화면 전환을 먼저 수행하여 레이아웃/DOM이 붙은 상태에서 바인딩
        try {
            if (ViewManager?.showScreen) {
                ViewManager.showScreen(loggedInView, 'admin-report-detail-screen');
            } else {
                // 혹시 ViewManager가 전역에 없으면 최소한 display만 보장
                detailScreen.classList.remove('hidden');
                detailScreen.classList.add('active');
                detailScreen.style.display = 'block';
            }

            // 템플릿/DOM 준비 대기
            await ensureDetailTemplateLoaded();
            await waitFrame();
            await waitFrame();

            // DB에서 데이터 가져오기
            // Firestore helper in this project is exposed via services.firestore and accepts a dummy first arg.
            const docRef = doc(null, "reported_logs", reportId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                alert("삭제된 리포트입니다.");
                return;
            }

            const data = docSnap.data();

            // --- [1] 헤더 및 기본 정보 바인딩 ---
            // 날짜 변환 (Firestore Timestamp -> Date)
            let dateStr = '-';
            if (data.reportedAt) {
                // Timestamp 객체면 toDate(), 아니면 그대로 사용
                dateStr = formatDateTimeKR(data.reportedAt);
            }

            const elDocId = document.getElementById('view-doc-id');
            const elReportTime = document.getElementById('view-report-time');
            if (elDocId) elDocId.textContent = reportId.substring(0, 8).toUpperCase();
            if (elReportTime) elReportTime.textContent = dateStr;

            // --- [2] 요약 정보 카드 (데이터 구조 직접 접근) ---
            // Agency Info
            const elAgencyName = document.getElementById('view-agency-name');
            const elAgencyId = document.getElementById('view-agency-id');
            const elAgencyEmail = document.getElementById('view-agency-email');
            if (elAgencyName) elAgencyName.textContent = data.agencyName || '-';
            if (elAgencyId) elAgencyId.textContent = data.agencyId || '-';
            if (elAgencyEmail) elAgencyEmail.textContent = data.agencyEmail || '-';

            // Client Info
            const client = data.clientInfo || {};
            const elClientName = document.getElementById('view-client-name');
            const elClientPhone = document.getElementById('view-client-phone');
            const elClientDob = document.getElementById('view-client-dob');
            if (elClientName) elClientName.textContent = client.name || '익명';
            if (elClientPhone) elClientPhone.textContent = client.phone || '-';
            if (elClientDob) elClientDob.textContent = client.dob || '-';

            // Device Info
            const device = data.deviceInfo || {};
            const elDevModel = document.getElementById('view-device-model');
            const elDevOs = document.getElementById('view-device-os');
            const elDevSerial = document.getElementById('view-device-serial');
            if (elDevModel) elDevModel.textContent = device.model || '-';
            if (elDevOs) elDevOs.textContent = (device.os || '-').toUpperCase();
            if (elDevSerial) elDevSerial.textContent = device.serial || '-';

            // Message
            const elMsg = document.getElementById('view-message-text');
            if (elMsg) elMsg.textContent = data.message || '특이사항 없음';

            // --- [3] 위협 앱 상세 리스트 생성 (핵심) ---
            const apps = data.suspiciousApps || [];
            const threatListEl = document.getElementById('view-threat-list');
            const elThreatCount = document.getElementById('view-threat-count');
            if (elThreatCount) elThreatCount.textContent = apps.length;
            if (threatListEl) threatListEl.innerHTML = ''; // 초기화

            if (!threatListEl) {
                // 템플릿이 없거나 로드 실패한 경우 화면만 전환된 상태가 될 수 있음
                console.warn('[viewReportDetail] threat list element missing - template may not be loaded');
            } else if (apps.length === 0) {
                threatListEl.innerHTML = `<div style="text-align:center; padding:30px; color:#28a745; background:white; border-radius:8px;">✅ 탐지된 위협이 없습니다. (Clean Device)</div>`;
            } else {
                apps.forEach((app, index) => {
                    // 앱 이름 포맷팅 (패키지명에서 추출)
                    let appName = "Unknown App";
                    if (app.packageName) {
                        const parts = app.packageName.split('.');
                        appName = parts.length > 1 ? parts[parts.length - 1] : app.packageName;
                        appName = appName.charAt(0).toUpperCase() + appName.slice(1);
                    }

                    // 권한 리스트 생성 (HTML)
                    let permissionHtml = '';
                    if (app.grantedList && app.grantedList.length > 0) {
                        permissionHtml = app.grantedList.map(perm => {
                            const shortPerm = perm.replace('android.permission.', '');
                            return `<span class="perm-badge granted">✔ ${shortPerm}</span>`;
                        }).join('');
                    } else {
                        permissionHtml = '<span style="font-size:11px; color:#999;">허용된 중요 권한 없음</span>';
                    }

                    // 상세 정보 카드 생성
                    const card = document.createElement('div');
                    card.className = 'threat-card';
                    card.innerHTML = `
                            <div class="threat-header">
                                <div>
                                    <span style="font-weight:bold; color:#555;">#${index + 1}</span>
                                    <span class="app-title-lg">${appName}</span>
                                    <span class="pkg-name">${app.packageName}</span>
                                    <br>
                                    <div class="threat-reason">${app.reason || '사유 불명'}</div>
                                </div>
                                <div style="text-align:right;">
                                    ${app.isSideloaded ? '<span style="background:#fff3e0; color:#e65100; font-size:11px; padding:3px 6px; border-radius:4px; font-weight:bold;">⚠️ 외부설치(Sideload)</span>' : ''}
                                    ${app.isRunningBg ? '<span style="background:#e3f2fd; color:#1565c0; font-size:11px; padding:3px 6px; border-radius:4px; font-weight:bold; margin-left:5px;">🚀 실행중</span>' : ''}
                                </div>
                            </div>
    
                            <div class="threat-details-grid">
                                <div class="detail-box">
                                    <label>📂 설치 경로 (APK Path)</label>
                                    <div class="path-box">${app.apkPath || '경로 정보 없음'}</div>
                                    <div style="margin-top:10px;">
                                        <label>📦 설치 관리자 (Installer)</label>
                                        <span style="font-size:12px;">${app.installer || '알 수 없음'}</span>
                                    </div>
                                </div>
    
                                <div class="detail-box">
                                    <label>🔑 허용된 주요 권한 (${app.grantedCount || 0}개)</label>
                                    <div class="perm-container">
                                        ${permissionHtml}
                                    </div>
                                </div>
                            </div>
                        `;
                    threatListEl.appendChild(card);
                });
            }

            // 스크롤 맨 위로
            detailScreen.scrollTop = 0;

        } catch (e) {
            console.error("상세보기 오류:", e);
            alert("정보를 불러오는 중 오류가 발생했습니다: " + e.message);
        }
    };

    // [뒤로가기 버튼 이벤트]
    // 템플릿 로드 타이밍 때문에 정적 바인딩이 실패할 수 있어 이벤트 위임으로 처리
    document.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('#admin-detail-back-btn') : null;
        if (!btn) return;

        const loggedInView = document.getElementById('logged-in-view');
        if (ViewManager?.showScreen && loggedInView) {
            ViewManager.showScreen(loggedInView, 'admin-screen');
        } else {
            const detailScreen = document.getElementById('admin-report-detail-screen');
            const adminScreen = document.getElementById('admin-screen');
            if (detailScreen) {
                detailScreen.style.display = 'none';
                detailScreen.classList.remove('active');
            }
            if (adminScreen) {
                adminScreen.style.display = 'block';
                adminScreen.classList.add('active');
                adminScreen.classList.remove('hidden');
            }
        }
    });

    window.toggleAnalysis = (header) => {
        const content = header.nextElementSibling;
        if (content.style.display === "block") {
            content.style.display = "none";
        } else {
            content.style.display = "block";
        }
    };

    // [전역 함수 노출] HTML onclick에서 호출하기 위해 window에 등록
    window.toggleLock = async (uid, shouldLock) => {
        if (!await CustomUI.confirm(shouldLock ? "🚫 이 업체의 사용을 막으시겠습니까?" : "✅ 차단을 해제하시겠습니까?")) return; try {
            await updateDoc(doc(null, "users", uid), { isLocked: shouldLock });
            if (AdminManager.currentUserUid === uid) AdminManager.viewUserDetail(uid);
            else AdminManager.loadUsers();
        } catch (e) { await CustomUI.alert("처리 실패: " + e.message); }
    };

    window.changeQuota = async (uid, currentQuota) => {
        console.log(`횟수 변경 클릭됨: ${uid}, 현재: ${currentQuota}`); // 디버깅용 로그

        // CustomUI가 아직 로드되지 않았을 경우를 대비한 안전장치
        if (typeof CustomUI === 'undefined') {
            alert("시스템 로딩 중입니다. 잠시 후 다시 시도해주세요.");
            return;
        }

        const input = await CustomUI.prompt(`[횟수 조정]\n현재 횟수: ${currentQuota}회\n\n추가(+)하거나 차감(-)할 수량을 입력하세요.\n(예: 10 또는 -5)`, "0");

        if (!input) return; // 취소 누름
        const change = parseInt(input, 10);

        if (isNaN(change)) {
            await CustomUI.alert("❌ 숫자만 입력해주세요.");
            return;
        }
        if (change === 0) return;

        try {
            // 결과값 미리 계산
            const newQuota = parseInt(currentQuota) + change;
            if (newQuota < 0) {
                await CustomUI.alert("❌ 횟수는 0보다 작을 수 없습니다.");
                return;
            }

            // DB 업데이트 (increment 사용)
            const userRef = doc(null, "users", uid);
            await updateDoc(userRef, {
                quota: increment(change)
            });

            await CustomUI.alert(`✅ 변경 완료!\n${currentQuota}회 -> ${newQuota}회`);

            // 화면 새로고침 (상세페이지 보고 있으면 상세페이지 갱신, 아니면 목록 갱신)
            if (AdminManager.currentUserUid === uid) {
                AdminManager.viewUserDetail(uid);
            } else {
                AdminManager.loadUsers();
            }

        } catch (e) {
            console.error(e);
            await CustomUI.alert("변경 실패: " + e.message);
        }
    };

    window.electronAPI.onUpdateStart((version) => {
        const modal = document.getElementById('update-modal');
        const verText = document.getElementById('update-ver-text');
        verText.textContent = `V${version}으로 업데이트를 시작합니다.`;
        modal.classList.remove('hidden');
    });

    // 업데이트 진행 중
    window.electronAPI.onUpdateProgress((data) => {
        const fill = document.getElementById('update-progress-fill');
        const percentText = document.getElementById('update-percent');
        const speedText = document.getElementById('update-speed');
        const sizeText = document.getElementById('update-size-info');

        fill.style.width = `${data.percent}%`;
        percentText.textContent = `${data.percent}%`;
        speedText.textContent = data.bytesPerSecond;
        sizeText.textContent = `${data.transferred} / ${data.total}`;
    });

    // 에러 발생 시
    window.electronAPI.onUpdateError(async (msg) => {
        await CustomUI.alert("업데이트 중 오류가 발생했습니다: " + msg);
        document.getElementById('update-modal').classList.add('hidden');
    });

    window.viewHistory = async (uid) => {
        const modal = document.getElementById('admin-result-modal');
        const content = document.getElementById('admin-result-content');
        modal.classList.remove('hidden');
        content.innerHTML = "데이터 조회 중...";

        try {
            // users -> uid -> scanResults 서브컬렉션 조회
            const historyRef = collection(null, "users", uid, "scanResults");
            const q = query(historyRef, orderBy("date", "desc"));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                content.innerHTML = "<p>📭 제출된 검사 결과가 없습니다.</p>";
                return;
            }

            let html = `<ul class="file-list" style="max-height:400px;">`;
            snapshot.forEach(doc => {
                const data = doc.data();
                const date = data.date ? formatDateTimeKR(data.date) : '날짜 없음';
                const threatCount = data.threatCount || 0;
                const style = threatCount > 0 ? 'color:red; font-weight:bold;' : 'color:green;';

                html += `
                        <li style="padding:10px; border-bottom:1px solid #eee;">
                            <div>🕒 <b>${date}</b></div>
                            <div style="${style}">결과: 스파이앱 ${threatCount}개 발견</div>
                            <div style="font-size:12px; color:#666;">모델: ${data.model} (Serial: ${data.serial})</div>
                        </li>
                    `;
            });
            html += "</ul>";
            content.innerHTML = html;

        } catch (e) {
            content.innerHTML = `<p style="color:red;">기록 조회 실패: ${e.message}</p>`;
        }
    };

    window.deleteUser = async (uid, name) => {
        const msg = `⚠️ [삭제 경고]\n\n업체명: ${name}\n\n정말로 삭제하시겠습니까?\n삭제된 업체는 더 이상 로그인할 수 없으며, 모든 데이터가 제거됩니다.`;

        // confirm 창 띄우기
        if (!await CustomUI.confirm(msg)) return;

        try {
            // 1. Firestore 문서 삭제
            // Firestore는 IPC 프록시를 사용하므로 db 인자는 null로 전달
            await deleteDoc(doc(null, "users", uid));

            // 2. 알림 및 새로고침
            await CustomUI.alert("🗑️ 업체가 삭제되었습니다.");
            // 상세페이지 보고 있었다면 목록으로 강제 이동
            document.getElementById('admin-user-detail-view').classList.add('hidden');
            document.getElementById('admin-tab-list').classList.remove('hidden');
            AdminManager.loadUsers();

        } catch (e) {
            console.error("삭제 실패:", e);
            await CustomUI.alert("삭제 실패: " + e.message);
        }
    };

    // =========================================================
    // [결과 전송] 서버로 검사 결과 데이터 전송
    // =========================================================
    const reportResultsBtn = document.getElementById('report-results-btn');
    if (reportResultsBtn) {
        reportResultsBtn.addEventListener('click', async () => {

            // 1. 데이터 유효성 검사
            if (!State.lastScanData) {
                await CustomUI.alert("전송할 검사 결과 데이터가 없습니다.");
                return;
            }

            // 2. 전송 여부 확인 (메시지 입력 받기)
            // (입력창이 없으면 그냥 confirm으로 대체 가능, 여기선 prompt 사용)
            const message = await CustomUI.prompt("서버로 결과를 전송하시겠습니까?\n관리자에게 남길 메모가 있다면 적어주세요.", "특이사항 없음");
            if (message === null) return; // 취소 누름

            reportResultsBtn.disabled = true;
            reportResultsBtn.textContent = "전송 중...";

            try {
                // 3. 데이터 수집
                // Auth는 renderer SDK/프록시 환경에 따라 currentUser가 없을 수 있으므로
                // 서비스가 제공하는 현재 사용자 정보를 우선 사용
                const user = (services?.auth?.getCurrentUser && services.auth.getCurrentUser()) || auth?.currentUser || null;
                const scanData = State.lastScanData;

                // ★★★ [추가] 업체명 가져오기 (DB에서 조회) ★★★
                let currentCompanyName = "알 수 없는 업체";
                let currentAgencyEmail = "-";

                if (user && user.uid) {
                    currentAgencyEmail = user.email;
                    try {
                        const uSnap = await getDoc(doc(null, "users", user.uid));
                        if (uSnap.exists()) {
                            currentCompanyName = uSnap.data().companyName || user.email;
                        }
                    } catch (e) {
                        console.error("업체명 조회 실패:", e);
                    }
                }

                // (1) 고객 정보 (입력폼에서 가져옴)
                // 익명일 경우 값 처리는 client-info-form 로직을 따름
                const clientName = document.getElementById('client-name').value || "익명";
                const clientDob = document.getElementById('client-dob').value || "0000-00-00";
                const clientPhone = document.getElementById('client-phone').value || "000-0000-0000";

                // 발견앱 목록
                const detectedApps = scanData.suspiciousApps

                // (2) 기기 정보
                const deviceInfo = {
                    model: scanData.deviceInfo.model,
                    serial: scanData.deviceInfo.serial,
                    os: State.currentDeviceMode // 'android' or 'ios'
                };

                // 4. Firestore 전송
                await addDoc(collection(null, "reported_logs"), {
                    agencyId: user?.uid || 'anonymous_agent', // 보낸 업체 ID
                    agencyName: currentCompanyName,
                    agencyEmail: user?.email || '-',          // 보낸 업체 이메일

                    // --- 요청하신 핵심 데이터 ---
                    clientInfo: {
                        name: clientName,
                        dob: clientDob,
                        phone: clientPhone
                    },
                    deviceInfo: deviceInfo,
                    suspiciousApps: detectedApps,

                    // --- 관리용 메타 데이터 ---
                    threatCount: detectedApps.length,
                    message: message, // 아까 입력받은 메모
                    reportedAt: serverTimestamp() // 서버 시간
                });

                await CustomUI.alert("✅ 결과가 서버로 성공적으로 전송되었습니다.");

            } catch (error) {
                console.error("전송 실패:", error);
                await CustomUI.alert("전송 실패: " + error.message);
            } finally {
                reportResultsBtn.disabled = false;
                reportResultsBtn.textContent = "📡 서버 전송";
            }
        });
    }

    // renderer.js 파일 내 (주요 함수 영역에 추가)

    /**
     * SemVer(Semantic Versioning) 규칙에 따라 두 버전 문자열을 비교합니다.
     * @param {string} a - 비교할 첫 번째 버전 (예: '1.0.10')
     * @param {string} b - 비교할 두 번째 버전 (예: '1.1.0')
     * @returns {number} 1: a가 더 큼, -1: b가 더 큼, 0: 두 버전이 같음
     */
    function compareVersions(a, b) {
        // 버전을 점(.) 기준으로 나눕니다.
        const partsA = a.split('.').map(Number);
        const partsB = b.split('.').map(Number);

        // Major, Minor, Patch 순서로 각 부분을 비교합니다.
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;

            if (numA > numB) {
                return 1; // A가 B보다 큼
            }
            if (numA < numB) {
                return -1; // B가 A보다 큼
            }
        }

        return 0; // 두 버전이 같음
    }

    if (window.__permModalDelegationBound) return;
window.__permModalDelegationBound = true;

document.addEventListener('click', async (e) => {
  const confirmBtn = e.target.closest('#perm-confirm-btn');
  const cancelBtn  = e.target.closest('#perm-cancel-btn');

  // ✅ 권한 모달 id는 이거임 (permission-modal 아님)
  const modalEl = document.getElementById('perm-modal-overlay');

  // 취소
  if (cancelBtn) {
    // 너 구조가 class hidden이면 이게 더 정석이지만, 일단 최소 수정:
    // modalEl?.classList.add('hidden');
    if (modalEl) modalEl.classList.add('hidden');
    return;
  }

        // 확인
    if (confirmBtn) {
        e.preventDefault();
        e.stopPropagation();

        const container = document.getElementById('perm-chip-container');
        const packageName = confirmBtn.dataset.package;
        const appName = confirmBtn.dataset.appname;

        if (!container || !packageName) return;

        const selectedPerms = Array.from(container.querySelectorAll('button, .bd-perm-chip'))
            .filter(btn => btn.dataset.selected === '1')
            .map(btn => btn.dataset.perm)
            .filter(Boolean);

        // ✅ 선택 없음: (너가 쓰던 방식 유지)
        if (selectedPerms.length === 0) {
            document.getElementById('perm-cancel-btn')?.click(); // 모달 닫고 alert 위로
            await CustomUI.alert('선택된 권한이 없습니다.');
            // ✅ alert 확인 후 다시 권한 모달 열고 싶으면:
            // modalEl?.classList.remove('hidden');
            return;
        }

        // ✅ confirm 띄우기 전에 모달 닫는 건 유지
        document.getElementById('perm-cancel-btn')?.click();

        const ok = await CustomUI.confirm(
            `[주의] '${appName}' 앱의 선택한 권한 ${selectedPerms.length}개를 회수하고 강제 종료하시겠습니까?`
        );

            // ✅ 취소면: 권한 모달 다시 보여주고 끝 (여기가 핵심)
        if (!ok) {
            if (modalEl) modalEl.classList.remove('hidden');
            return;
        }

            // ✅ OK면: 모달은 닫힌 상태 유지하고 neutralize 진행
        const neutralizeBtn = document.getElementById('neutralize-btn');
        if (neutralizeBtn) {
            neutralizeBtn.disabled = true;
            neutralizeBtn.textContent = "무력화 중...";
        }

        try {
            const result = await window.electronAPI.neutralizeApp(packageName, selectedPerms);
            if (result.success) {
                await CustomUI.alert(`✅ 무력화 성공!\n총 ${result.count}개의 권한을 박탈했습니다.`);
                document.getElementById('back-to-dashboard-btn')?.click();
            } else {
                throw new Error(result.error);
            }
        } catch (err) {
        await CustomUI.alert(`무력화 실패: ${err.message}`);
        } finally {
            if (neutralizeBtn) {
                neutralizeBtn.disabled = false;
                neutralizeBtn.textContent = "🛡️ 무력화 (권한 박탈)";
                }
            }
        }
    });
}