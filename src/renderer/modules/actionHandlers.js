// Auto-split module: actionHandlers

import { initAdminController } from '../features/admin/adminController.js';
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

            sortedApps.forEach(app => {

                const div = document.createElement('div');

                if (app.reason) {
                    // 1순위: 위협 앱 (빨간색)
                    div.className = 'compact-item compact-threat';
                } else if (app.isSideloaded) {
                    // 2순위: 사이드로딩 앱 (회색)
                    div.className = 'compact-item compact-sideload';
                } else {
                    // 3순위: 일반 앱 (흰색)
                    div.className = 'compact-item';
                }

                // 앱 이름 표시 (위협이면 앞에 [위협] 표시)
                const prefix = app.reason ? '[위협] ' : (app.isSideloaded ? '[외부] ' : '');
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
    // =====================
    // Admin feature (extracted)
    initAdminController(ctx);

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