export function createScanMenuLifecycle({ State, ViewManager, document }) {
  const menu = {
    navCreate: () => document.getElementById('nav-create'),
    navOpen: () => document.getElementById('nav-open'),
    navResult: () => document.getElementById('nav-result'),
    dashNav: () => document.getElementById('nav-android-dashboard'),
    scanInfoNav: () => document.getElementById('nav-scan-info'),
    resultSub: () => document.getElementById('result-sub-menu'),
    iosSub: () => document.getElementById('ios-sub-menu')
  };

  function setMenuState(state) {
    const createBtn = menu.navCreate();
    const openBtn = menu.navOpen();
    const navResult = menu.navResult();
    const dashNav = menu.dashNav();
    const scanInfoNav = menu.scanInfoNav();
    const subMenu = menu.resultSub();
    const iosSub = menu.iosSub();

    const hide = (element) => {
      if (!element) return;
      element.classList.add('hidden');
      element.style.display = 'none';
    };

    const show = (element) => {
      if (!element) return;
      element.classList.remove('hidden');
      element.style.display = '';
    };

    if (state === 'preScan') {
      show(createBtn);
      show(openBtn);
      hide(navResult);
      hide(subMenu);
      hide(iosSub);
      hide(dashNav);
      hide(scanInfoNav);
      return;
    }

    if (state === 'scanning') {
      hide(createBtn);
      hide(openBtn);
      hide(navResult);
      hide(subMenu);
      hide(iosSub);
      hide(scanInfoNav);

      if (State.currentDeviceMode === 'android' && !State.isLoadedScan) show(dashNav);
      else hide(dashNav);
      return;
    }

    if (state === 'results') {
      hide(createBtn);
      hide(openBtn);
      show(navResult);

      if (State.currentDeviceMode === 'ios') {
        show(iosSub);
        hide(subMenu);
        hide(dashNav);
        if (State.isLoadedScan) show(scanInfoNav);
        else hide(scanInfoNav);
        return;
      }

      show(subMenu);
      hide(iosSub);
      if (State.isLoadedScan) {
        hide(dashNav);
        show(scanInfoNav);
      } else {
        show(dashNav);
        hide(scanInfoNav);
      }
    }
  }

  function attachShowScreenHook() {
    if (ViewManager.__bd_wrapped_showScreen) return;

    ViewManager.__bd_wrapped_showScreen = true;
    const originalShowScreen = ViewManager.showScreen.bind(ViewManager);
    ViewManager.showScreen = function (root, screenId) {
      const result = originalShowScreen(root, screenId);
      try {
        if (screenId === 'device-connection-screen' || screenId === 'scan-create-screen') {
          setMenuState('preScan');
        } else if (screenId === 'scan-dashboard-screen' || screenId === 'scan-progress-screen') {
          if (State.lastScanData) setMenuState('results');
          else setMenuState('scanning');
        } else if (screenId === 'scan-results-screen') {
          setMenuState('results');
        }
      } catch (error) {
        console.warn('[BD-Scanner] menu lifecycle hook failed:', error);
      }
      return result;
    };
  }

  return {
    setMenuState,
    attachShowScreenHook
  };
}
