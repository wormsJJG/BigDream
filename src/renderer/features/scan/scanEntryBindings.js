export function bindScanStartButton({
  ctx,
  State,
  ViewManager,
  CustomUI,
  authService,
  doc,
  updateDoc,
  increment,
  loggedInView,
  ScanController,
  setDashboardScrollLock,
  resetAndroidDashboardUI
}) {
  const realStartScanBtn = document.getElementById('real-start-scan-btn');
  if (!realStartScanBtn) return;

  realStartScanBtn.addEventListener('click', async () => {
    realStartScanBtn.disabled = true;
    realStartScanBtn.textContent = '검사 진행 중...';

    const hasQuota = await ScanController.checkQuota();
    if (!hasQuota) {
      ctx.services?.deviceManager?.stopPolling?.();
      ViewManager.showScreen(loggedInView, 'device-connection-screen');
      realStartScanBtn.disabled = false;
      realStartScanBtn.textContent = '검사 시작하기';
      return;
    }

    try {
      const user = authService.getCurrentUser?.();
      if (user) {
        await updateDoc(doc(null, 'users', user.uid), { quota: increment(-1) });
        State.quota -= 1;
        if (ctx.helpers && typeof ctx.helpers.updateAgencyDisplay === 'function') {
          ctx.helpers.updateAgencyDisplay();
        }
      }
    } catch (quotaError) {
      console.error('❌ Quota 차감 중 오류 발생:', quotaError);
      CustomUI.alert('검사 횟수 차감에 실패했습니다. (서버 오류)');
      realStartScanBtn.disabled = false;
      realStartScanBtn.textContent = '검사 시작하기';
      return;
    }

    try {
      const nameEl = document.getElementById('client-name');
      const phoneEl = document.getElementById('client-phone');
      const rawName = nameEl ? String(nameEl.value || '').trim() : '';
      const rawPhone = phoneEl ? String(phoneEl.value || '').trim() : '';
      const isAnonName = (!rawName) || rawName.includes('익명');
      const isAnonPhone = (!rawPhone) || rawPhone.includes('000-0000-0000') || rawPhone.includes('익명');
      State.clientInfo = {
        name: isAnonName ? null : rawName,
        phone: isAnonPhone ? null : rawPhone
      };
    } catch (_e) {}

    State.scanRuntime.inProgress = true;
    State.scanRuntime.phase = 'starting';

    const isLogged = await ScanController.startLogTransaction(State.currentDeviceMode);
    if (!isLogged) {
      CustomUI.alert('서버 통신 오류로 검사를 시작할 수 없습니다. 네트워크를 연결해주세요.');
      realStartScanBtn.disabled = false;
      realStartScanBtn.textContent = '검사 시작하기';
      return;
    }

    ctx.services?.deviceManager?.stopPolling?.();
    State.lastScanData = null;
    State.lastScanData = null;
    State.isLoadedScan = false;

    const navScanInfo = document.getElementById('nav-scan-info');
    if (navScanInfo) {
      navScanInfo.classList.add('hidden');
      navScanInfo.style.display = 'none';
    }

    if (State.currentDeviceMode === 'android') {
      const dashNav = document.getElementById('nav-android-dashboard');
      if (dashNav) {
        dashNav.classList.remove('hidden');
        dashNav.style.display = '';
      }

      ViewManager.activateMenu('nav-android-dashboard');
      setDashboardScrollLock(true);
      resetAndroidDashboardUI();
      ViewManager.showScreen(loggedInView, 'scan-dashboard-screen');
      await ScanController.startAndroidScan();
      return;
    }

    setDashboardScrollLock(false);
    ViewManager.showScreen(loggedInView, 'scan-progress-screen');
    await ScanController.startIosScan();
  });
}

export function bindOpenScanFileButton({
  ctx,
  State,
  ViewManager,
  CustomUI,
  loggedInView,
  ResultsRenderer,
  normalizeLoadedScanData,
  normalizeDeviceMode,
  setDashboardScrollLock
}) {
  const openScanFileBtn = document.getElementById('select-file-btn');
  if (!openScanFileBtn) return;

  openScanFileBtn.addEventListener('click', async () => {
    openScanFileBtn.disabled = true;
    openScanFileBtn.textContent = '파일 여는 중...';

    try {
      const result = await window.electronAPI.openScanFile();
      if (result.success) {
        const data = result.data;
        const osMode = result.osMode;

        normalizeLoadedScanData(data, osMode);
        State.currentDeviceMode = osMode;
        State.isLoadedScan = true;
        State.lastScanData = data;
        State.lastScanFileMeta = result.fileMeta || null;

        try {
          ctx.helpers.renderScanInfo?.(data, State.lastScanFileMeta);
        } catch (e) {
          console.warn('[BD-Scanner] scan-info render failed:', e);
        }

        try { ViewManager.activateMenu('nav-result'); } catch (_e) {}
        setDashboardScrollLock(false);
        ViewManager.showScreen(loggedInView, 'scan-results-screen');

        const applyInitialResultTabHighlight = () => {
          const mode = normalizeDeviceMode(State.currentDeviceMode || osMode);
          const isIos = mode === 'ios';
          const activeMenuId = isIos ? 'ios-sub-menu' : 'result-sub-menu';
          const inactiveMenuId = isIos ? 'result-sub-menu' : 'ios-sub-menu';
          const activeMenu = document.getElementById(activeMenuId);
          const inactiveMenu = document.getElementById(inactiveMenuId);

          if (inactiveMenu) {
            inactiveMenu.classList.add('hidden');
            inactiveMenu.style.display = 'none';
          }
          if (activeMenu) {
            activeMenu.classList.remove('hidden');
            activeMenu.style.display = 'block';
          }

          const firstTab = document.querySelector(`#${activeMenuId} .res-tab[data-target="res-summary"]`);
          if (firstTab) {
            document.querySelectorAll(`#${activeMenuId} .res-tab`).forEach((tab) => tab.classList.remove('active'));
            firstTab.classList.add('active');
          }
        };

        requestAnimationFrame(() => {
          try { ResultsRenderer.render(data); } catch (e) {
            console.error('[BD-Scanner] ResultsRenderer.render failed:', e);
          }

          const sections = document.querySelectorAll('.result-content-section');
          if (sections.length > 0) {
            sections.forEach((section) => {
              if (section.id === 'res-summary') {
                section.style.display = 'block';
                section.classList.add('active');
              } else {
                section.style.display = 'none';
                section.classList.remove('active');
              }
            });
          }

          applyInitialResultTabHighlight();
        });

        const navCreate = document.getElementById('nav-create');
        const navOpen = document.getElementById('nav-open');
        const navResult = document.getElementById('nav-result');
        const navAndroidDash = document.getElementById('nav-android-dashboard');
        const navScanInfo = document.getElementById('nav-scan-info');

        if (navCreate) navCreate.classList.add('hidden');
        if (navOpen) navOpen.classList.add('hidden');
        if (navResult) navResult.classList.remove('hidden');
        if (navAndroidDash) {
          navAndroidDash.classList.add('hidden');
          navAndroidDash.style.display = 'none';
        }
        if (navScanInfo) {
          const labelSpan = navScanInfo.querySelector('span');
          if (labelSpan) labelSpan.textContent = '📝 검사 정보';
          navScanInfo.classList.remove('hidden');
          navScanInfo.style.display = 'block';
        }

        await CustomUI.alert(`✅ 검사 결과 로드 완료!\n모델: ${data.deviceInfo?.model || '-'}`);
        setTimeout(() => {
          try { applyInitialResultTabHighlight(); } catch (_) {}
        }, 0);
      } else if (result.message !== '열기 취소') {
        await CustomUI.alert(`❌ 파일 열기 실패: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Critical Error:', error);
      await CustomUI.alert(`시스템 오류: ${error.message}`);
    } finally {
      openScanFileBtn.disabled = false;
      openScanFileBtn.textContent = '📁 로컬 파일 열기';
    }
  });
}
