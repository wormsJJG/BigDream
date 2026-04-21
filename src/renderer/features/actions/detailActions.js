export function bindDetailActions({ State, Utils, CustomUI }) {
    const uninstallBtn = document.getElementById('uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', async () => {
            const { package: packageName, appName, apkPath } = uninstallBtn.dataset;

            if (uninstallBtn.textContent.includes('APK')) {
                if (!apkPath) {
                    await CustomUI.alert('파일 경로를 찾을 수 없습니다.');
                    return;
                }

                if (!await CustomUI.confirm(`[위험] 기기 내부의 APK 파일을 영구 삭제하시겠습니까?\n\n경로: ${apkPath}`)) return;

                uninstallBtn.disabled = true;
                uninstallBtn.textContent = '파일 삭제 중...';

                try {
                    const serial = State.currentSerial || (State.lastScanData ? State.lastScanData.deviceInfo.serial : null);
                    const result = await window.electronAPI.deleteApkFile({ serial, filePath: apkPath });

                    if (result.success) {
                        await CustomUI.alert('✅ APK 파일이 기기에서 삭제되었습니다.');
                        document.getElementById('back-to-dashboard-btn').click();
                    } else {
                        throw new Error(result.error);
                    }
                } catch (err) {
                    await CustomUI.alert(`파일 삭제 실패: ${err.message}`);
                } finally {
                    uninstallBtn.disabled = false;
                    uninstallBtn.textContent = '🗑️ APK 파일 삭제';
                }
            } else {
                if (!packageName) return;

                if (!await CustomUI.confirm(`[경고] 정말로 '${appName}' 앱을 삭제하시겠습니까?\n\n패키지명: ${packageName}`)) return;

                uninstallBtn.disabled = true;
                uninstallBtn.textContent = '삭제 요청 중...';

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
                    uninstallBtn.textContent = '🗑️ 앱 강제 삭제';
                }
            }
        });
    }

    const ensurePermissionModal = () => {
        const modal = document.getElementById('perm-modal-overlay');
        if (!modal) return null;
        modal.classList.remove('hidden');
        return modal;
    };

    const hidePermissionModal = () => {
        const modal = document.getElementById('perm-modal-overlay');
        if (!modal) return;
        modal.classList.add('hidden');
    };

    const neutralizeBtn = document.getElementById('neutralize-btn');
    if (neutralizeBtn) {
        neutralizeBtn.addEventListener('click', async () => {
            const { package: packageName, appName } = neutralizeBtn.dataset;
            if (!packageName) return;

            neutralizeBtn.disabled = true;
            neutralizeBtn.textContent = '권한 불러오는 중...';

            try {
                const rawPerms = await window.electronAPI.getGrantedPermissions(packageName);
                const perms = Array.from(new Set(
                    (rawPerms ?? [])
                        .map(p => String(p).trim())
                        .filter(p => p.startsWith('android.permission.'))
                ));

                if (!perms.length) {
                    throw new Error('선택 가능한 권한이 없습니다.');
                }

                const modal = ensurePermissionModal();
                const container = document.getElementById('perm-chip-container');
                const selectAllBtn = document.getElementById('perm-select-all-btn');
                const searchInput = document.getElementById('perm-search-input');
                const confirmBtn = document.getElementById('perm-confirm-btn');
                const cancelBtn = document.getElementById('perm-cancel-btn');
                const subtitle = document.getElementById('perm-modal-subtitle');

                if (!modal || !container || !selectAllBtn || !searchInput || !confirmBtn || !cancelBtn) {
                    throw new Error('권한 선택 모달 요소를 찾을 수 없습니다.');
                }

                if (subtitle) subtitle.textContent = `'${appName}' 권한 ${perms.length}개`;

                container.innerHTML = '';

                const updateSelectAll = () => {
                    const chips = [...container.querySelectorAll('.bd-perm-chip')];
                    const allOn = chips.length > 0 && chips.every(chip => chip.dataset.selected === '1');
                    selectAllBtn.classList.toggle('is-active', allOn);
                    selectAllBtn.textContent = allOn ? '전체 해제' : '전체 선택';
                };

                Utils.renderPermissionCategories(perms, container, updateSelectAll);
                updateSelectAll();

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

                        catEl.style.display = anyVisible ? '' : 'none';
                    });
                };

                selectAllBtn.onclick = (e) => {
                    e.preventDefault();
                    const chips = [...container.querySelectorAll('.bd-perm-chip')];
                    const allOn = chips.length > 0 && chips.every(chip => chip.dataset.selected === '1');
                    const next = !allOn;

                    chips.forEach(chip => {
                        chip.dataset.selected = next ? '1' : '0';
                        chip.classList.toggle('is-selected', next);
                    });

                    updateSelectAll();
                };

                const closeModal = (e) => {
                    e?.preventDefault?.();
                    e?.stopPropagation?.();
                    hidePermissionModal();
                    neutralizeBtn.disabled = false;
                    neutralizeBtn.textContent = '🛡️ 무력화 (권한 박탈)';
                };

                cancelBtn.onclick = closeModal;
                modal.onclick = (e) => {
                    if (e.target === modal) closeModal(e);
                };

                confirmBtn.onclick = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const selectedPerms = Array.from(container.querySelectorAll('.bd-perm-chip'))
                        .filter(chip => chip.dataset.selected === '1')
                        .map(chip => chip.dataset.perm)
                        .filter(Boolean);

                    if (!selectedPerms.length) {
                        await CustomUI.alert('선택된 권한이 없습니다.');
                        return;
                    }

                    hidePermissionModal();

                    const ok = await CustomUI.confirm(
                        `[주의] '${appName}' 앱의 선택한 권한 ${selectedPerms.length}개를 회수하고 강제 종료하시겠습니까?`
                    );

                    if (!ok) {
                        ensurePermissionModal();
                        neutralizeBtn.disabled = false;
                        neutralizeBtn.textContent = '🛡️ 무력화 (권한 박탈)';
                        return;
                    }

                    neutralizeBtn.disabled = true;
                    neutralizeBtn.textContent = '무력화 중...';

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
                        neutralizeBtn.disabled = false;
                        neutralizeBtn.textContent = '🛡️ 무력화 (권한 박탈)';
                    }
                };

                neutralizeBtn.disabled = false;
                neutralizeBtn.textContent = '🛡️ 무력화 (권한 박탈)';
            } catch (err) {
                neutralizeBtn.disabled = false;
                neutralizeBtn.textContent = '🛡️ 무력화 (권한 박탈)';
                await CustomUI.alert(`무력화 실패: ${err.message || err}`);
            }
        });
    }

    const saveResultsBtn = document.getElementById('save-results-btn');
    if (saveResultsBtn) {
        saveResultsBtn.addEventListener('click', async () => {
            if (!State.lastScanData) {
                await CustomUI.alert('저장할 데이터가 없습니다.');
                return;
            }

            saveResultsBtn.disabled = true;
            saveResultsBtn.textContent = '저장 중...';

            try {
                const pureData = JSON.parse(JSON.stringify(State.lastScanData));
                const result = await window.electronAPI.saveScanResult(pureData);

                if (result.success) {
                    await CustomUI.alert(result.message);
                } else {
                    await CustomUI.alert(`저장 실패: ${result.error || result.message}`);
                }
            } catch (error) {
                console.error('Serialization Error:', error);
                await CustomUI.alert('로컬 저장 오류: 데이터 형식이 올바르지 않습니다.');
            } finally {
                saveResultsBtn.disabled = false;
                saveResultsBtn.textContent = '💾 로컬 저장';
            }
        });
    }
}
