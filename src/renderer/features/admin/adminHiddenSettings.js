export function bindAdminHiddenSettings({
    State,
    CustomUI,
    authService,
    firestore
}) {
    const { doc, updateDoc, serverTimestamp } = firestore;

    const adminTriggers = document.querySelectorAll('.app-title');
    const adminModal = document.getElementById('admin-modal');
    const adminContent = document.querySelector('.modal-content');
    const adminModalTitle = document.getElementById('admin-modal-title');
    const adminModalDesc = document.getElementById('admin-modal-desc');
    const adminAndroidFields = document.getElementById('admin-android-fields');
    const adminInput = document.getElementById('admin-input');
    const adminIosFields = document.getElementById('admin-ios-fields');
    const adminIosMode = document.getElementById('admin-ios-mode');
    const adminSaveBtn = document.getElementById('admin-save-btn');
    const adminCancelBtn = document.getElementById('admin-cancel-btn');

    const isPrivilegedRole = () => State.userRole === 'admin' || State.userRole === 'distributor';

    const configureAdminModal = () => {
        if (adminModalTitle) adminModalTitle.textContent = '⚡ 진행 설정';
        if (adminModalDesc) {
            adminModalDesc.innerHTML = 'Android와 iOS 진행 방식을 한 번에 설정할 수 있습니다.<br/><span class="bd-modal-hint">iOS 랜덤 20~30분 모드는 빠른 기기에서만 정밀 분석 단계에 적용됩니다.</span>';
        }
        if (adminAndroidFields) adminAndroidFields.classList.remove('hidden');
        if (adminIosFields) adminIosFields.classList.remove('hidden');
        if (adminInput) adminInput.value = State.androidTargetMinutes || 0;
        if (adminIosMode) adminIosMode.value = State.iosProgressMode || 'real';
    };

    const closeAdminModal = () => {
        if (adminModal) adminModal.classList.add('hidden');
    };

    const handleAdminSave = async (ev) => {
        const saveBtn = (ev && ev.currentTarget) ? ev.currentTarget : document.getElementById('admin-save-btn');
        const androidMinutes = parseInt(adminInput?.value, 10);
        const iosMode = (adminIosMode && adminIosMode.value === 'random_20_30') ? 'random_20_30' : 'real';

        if (isNaN(androidMinutes) || androidMinutes < 0) {
            await CustomUI.alert('Android 시간은 0 이상의 숫자로 입력해주세요.');
            return;
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = '저장 중...';
        }

        try {
            const user = authService.getCurrentUser?.() || authService.currentUser;
            if (!user) throw new Error('로그인이 필요합니다.');

            await updateDoc(doc(null, 'users', user.uid), {
                updatedAt: serverTimestamp(),
                ios_progress_mode: iosMode,
                androidTargetMinutes: androidMinutes,
                android_scan_duration: androidMinutes
            });

            State.androidTargetMinutes = androidMinutes;
            State.iosProgressMode = iosMode;

            await CustomUI.alert('✅ 검사 시간 설정이 저장되었습니다.');
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

    if (!(adminTriggers.length > 0 && adminModal)) {
        console.warn('❌ 히든 메뉴 요소 찾기 실패');
        return;
    }

    console.log('✅ 히든 메뉴 시스템 활성화됨 (시간 설정 전용)');

    adminTriggers.forEach((trigger) => {
        trigger.style.userSelect = 'none';
        trigger.style.cursor = 'default';

        trigger.addEventListener('dblclick', async () => {
            const loggedInView = document.getElementById('logged-in-view');
            if (!loggedInView || !loggedInView.classList.contains('active')) return;

            const progressScreen = document.getElementById('scan-progress-screen');
            const resultScreen = document.getElementById('scan-results-screen');

            if (progressScreen && progressScreen.classList.contains('active')) {
                await CustomUI.alert('🚫 검사 중에는 설정을 변경할 수 없습니다.');
                return;
            }
            if (resultScreen && resultScreen.classList.contains('active')) {
                await CustomUI.alert('🚫 결과 화면에서는 설정을 변경할 수 없습니다.');
                return;
            }

            if (isPrivilegedRole()) {
                configureAdminModal();
                adminModal.classList.remove('hidden');
                console.log(`[${State.userRole}] 검사 시간 설정창 오픈`);
            } else {
                console.log('일반 업체 계정: 설정 변경 권한이 없습니다.');
            }
        });
    });

    if (adminSaveBtn?.parentNode) {
        const newSaveBtn = adminSaveBtn.cloneNode(true);
        adminSaveBtn.parentNode.replaceChild(newSaveBtn, adminSaveBtn);
        newSaveBtn.addEventListener('click', handleAdminSave);
    }

    if (adminCancelBtn?.parentNode) {
        const newCancelBtn = adminCancelBtn.cloneNode(true);
        adminCancelBtn.parentNode.replaceChild(newCancelBtn, adminCancelBtn);
        newCancelBtn.addEventListener('click', closeAdminModal);
    }

    if (adminContent) {
        adminContent.addEventListener('click', (e) => e.stopPropagation());
    }
    adminModal.addEventListener('click', (e) => {
        if (e.target === adminModal) closeAdminModal();
    });
}
