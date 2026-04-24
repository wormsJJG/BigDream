import * as firestoreProxy from '../../shared/services/firestoreProxy.js';
import { createAuthService } from '../../shared/services/authService.js';
import { createFirestoreService } from '../../shared/services/firestoreService.js';
import { createViewManager } from './viewManager.js';
import { initAuthSettings } from '../features/auth/initAuthSettings.js';
import { initClientDevice } from '../features/device/initClientDevice.js';
import { initScanController } from '../features/scan/initScanController.js';
import { initAppDetail } from '../features/app-detail/initAppDetail.js';
import { initActionHandlers } from '../features/actions/initActionHandlers.js';
import { loadTemplates } from './templateLoader.js';

import type {
  AuthService,
  CustomUiLike,
  FirestoreService,
  PromptChoice,
  RendererContext,
  RendererState
} from '../../types/renderer-context';

console.log('--- renderer.js: 파일 로드됨 ---');

document.addEventListener('DOMContentLoaded', async () => {
  await loadTemplates();
  console.log('--- renderer.js: DOM 로드 완료 ---');

  async function getSaveInfo(): Promise<void> {
    const saveInfo = await window.electronAPI.getLoginInfo() as {
      id?: string;
      pw?: string;
      remember?: boolean;
    } | null;

    const usernameEl = document.getElementById('username') as HTMLInputElement | null;
    const passwordEl = document.getElementById('password') as HTMLInputElement | null;
    const rememberEl = document.getElementById('remember-me') as HTMLInputElement | null;
    if (!usernameEl || !passwordEl || !rememberEl) return;

    if (saveInfo && saveInfo.remember) {
      usernameEl.value = saveInfo.id;
      passwordEl.value = saveInfo.pw;
      rememberEl.checked = saveInfo.remember;
    } else {
      usernameEl.value = '';
      passwordEl.value = '';
      rememberEl.checked = false;
    }
  }

  await getSaveInfo();

  const authService: AuthService = createAuthService();
  const firestoreService: FirestoreService = createFirestoreService(firestoreProxy as any);

  const ID_DOMAIN = '@bd.com';

  const createLoggedOutNavSetup = (
    deps: { ViewManager: ReturnType<typeof createViewManager>; loggedOutView: HTMLElement | null }
  ) => () => {
    const navLogin = document.getElementById('nav-login');
    const navSupport = document.getElementById('nav-support');

    if (navLogin) {
      navLogin.addEventListener('click', () => {
        document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
        navLogin.classList.add('active');

        const loginScreen = document.getElementById('login-screen') as HTMLElement | null;
        const supportScreen = document.getElementById('support-screen') as HTMLElement | null;
        if (loginScreen) loginScreen.style.display = 'block';
        if (supportScreen) supportScreen.style.display = 'none';

        deps.ViewManager.showScreen(deps.loggedOutView, 'login-screen');
      });
    }

    if (navSupport) {
      navSupport.addEventListener('click', () => {
        document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
        navSupport.classList.add('active');

        const loginScreen = document.getElementById('login-screen') as HTMLElement | null;
        const supportScreen = document.getElementById('support-screen') as HTMLElement | null;
        if (loginScreen) loginScreen.style.display = 'none';
        if (supportScreen) supportScreen.style.display = 'block';

        deps.ViewManager.showScreen(deps.loggedOutView, 'support-screen');
      });
    }
  };

  const State: RendererState = {
    isLoggedIn: false,
    connectionCheckInterval: null,
    currentDeviceMode: null,
    currentUdid: null,
    lastScanData: null,
    isLoadedScan: false,
    androidTargetMinutes: 0,
    iosProgressMode: 'real',
    agencyName: 'BD SCANNER',
    quota: -1,
    scrollPostion: 0,
    scanRuntime: {
      inProgress: false,
      phase: 'idle',
      androidListCleanup: []
    }
  };

  const ViewManager = createViewManager(State);

  const loggedInView = document.getElementById('logged-in-view');
  const loggedOutView = document.getElementById('logged-out-view');

  ViewManager.showView('logged-out-view');

  const loginScreen = document.getElementById('login-screen') as HTMLElement | null;
  if (loginScreen) loginScreen.style.display = 'block';

  document.querySelectorAll('#logged-out-view .nav-item').forEach(li => li.classList.remove('active'));
  const navLogin = document.getElementById('nav-login');
  if (navLogin) navLogin.classList.add('active');

  const CustomUI: CustomUiLike = {
    alert(message) {
      return new Promise((resolve) => {
        const modal = document.getElementById('custom-alert-modal');
        const msgEl = document.getElementById('custom-alert-msg');
        const btn = document.getElementById('custom-alert-ok-btn') as HTMLButtonElement | null;

        if (!modal || !msgEl || !btn) {
          resolve();
          return;
        }

        msgEl.textContent = message;
        modal.classList.remove('hidden');

        const close = () => {
          modal.classList.add('hidden');
          btn.removeEventListener('click', close);
          resolve();
        };

        btn.addEventListener('click', close);
        btn.focus();
      });
    },

    confirm(message) {
      return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('custom-confirm-msg');
        const okBtn = document.getElementById('custom-confirm-ok-btn') as HTMLButtonElement | null;
        const cancelBtn = document.getElementById('custom-confirm-cancel-btn') as HTMLButtonElement | null;

        if (!modal || !msgEl || !okBtn || !cancelBtn) {
          resolve(false);
          return;
        }

        msgEl.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
          modal.classList.add('hidden');
          okBtn.removeEventListener('click', handleOk);
          cancelBtn.removeEventListener('click', handleCancel);
        };

        const handleOk = () => {
          cleanup();
          resolve(true);
        };

        const handleCancel = () => {
          cleanup();
          resolve(false);
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        cancelBtn.focus();
      });
    },

    prompt(message, defaultValue = '') {
      return new Promise((resolve) => {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal bd-prompt-modal bd-modal-z10000';

        const modalBox = document.createElement('div');
        modalBox.className = 'modal-content bd-prompt-content';

        const title = document.createElement('h3');
        title.className = 'bd-prompt-title bd-preline';
        title.textContent = String(message ?? '');

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'custom-prompt-input';
        input.className = 'bd-prompt-input';
        input.value = String(defaultValue ?? '');

        const btnRow = document.createElement('div');
        btnRow.className = 'bd-prompt-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'prompt-cancel-btn';
        cancelBtn.className = 'secondary-button bd-prompt-btn';
        cancelBtn.textContent = '취소';

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.id = 'prompt-ok-btn';
        okBtn.className = 'primary-button bd-prompt-btn';
        okBtn.textContent = '확인';

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);

        modalBox.appendChild(title);
        modalBox.appendChild(input);
        modalBox.appendChild(btnRow);
        modalOverlay.appendChild(modalBox);
        document.body.appendChild(modalOverlay);

        input.focus();
        input.select();

        const cleanup = () => {
          okBtn.removeEventListener('click', handleOk);
          cancelBtn.removeEventListener('click', handleCancel);
          input.removeEventListener('keydown', handleKeydown);
          modalOverlay.remove();
        };

        const handleOk = () => {
          const val = input.value;
          cleanup();
          resolve(val);
        };

        const handleCancel = () => {
          cleanup();
          resolve(null);
        };

        const handleKeydown = (e: KeyboardEvent) => {
          if (e.key === 'Enter') handleOk();
          if (e.key === 'Escape') handleCancel();
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        input.addEventListener('keydown', handleKeydown);
      });
    },

    choose(message, choices = []) {
      return new Promise((resolve) => {
        const safeChoices = Array.isArray(choices)
          ? choices.filter(choice => choice && choice.value && choice.label)
          : [];

        if (safeChoices.length === 0) {
          resolve(null);
          return;
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal bd-prompt-modal bd-modal-z10000';

        const modalBox = document.createElement('div');
        modalBox.className = 'modal-content bd-prompt-content bd-choice-modal-content';

        const header = document.createElement('div');
        header.className = 'bd-choice-header';

        const eyebrow = document.createElement('div');
        eyebrow.className = 'bd-choice-eyebrow';
        eyebrow.textContent = 'RESULT EXPORT';

        const title = document.createElement('h3');
        title.className = 'bd-prompt-title bd-choice-title bd-preline';
        title.textContent = String(message ?? '');

        const subtitle = document.createElement('p');
        subtitle.className = 'bd-choice-subtitle';
        subtitle.textContent = '원하는 출력 형식을 선택하면 검사 결과서를 해당 방식으로 바로 생성합니다.';

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'bd-choice-actions';

        const buttons = safeChoices.map((choice, index) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `bd-choice-btn${index === 0 ? ' is-primary' : ''}`;
          btn.dataset.value = String(choice.value);

          const label = document.createElement('span');
          label.className = 'bd-choice-btn-label';
          label.textContent = String(choice.label);
          btn.appendChild(label);

          if (choice.description) {
            const description = document.createElement('span');
            description.className = 'bd-choice-btn-desc';
            description.textContent = String(choice.description);
            btn.appendChild(description);
          }

          buttonGroup.appendChild(btn);
          return btn;
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'secondary-button bd-prompt-btn bd-choice-cancel-btn';
        cancelBtn.textContent = '취소';

        header.appendChild(eyebrow);
        header.appendChild(title);
        header.appendChild(subtitle);
        modalBox.appendChild(header);
        modalBox.appendChild(buttonGroup);
        modalBox.appendChild(cancelBtn);
        modalOverlay.appendChild(modalBox);
        document.body.appendChild(modalOverlay);

        const cleanup = () => {
          buttons.forEach((btn) => btn.removeEventListener('click', handleChoice));
          cancelBtn.removeEventListener('click', handleCancel);
          modalOverlay.removeEventListener('keydown', handleKeydown);
          modalOverlay.remove();
        };

        const handleChoice = (event: Event) => {
          const currentTarget = event.currentTarget as HTMLButtonElement | null;
          const value = currentTarget?.dataset?.value ?? null;
          cleanup();
          resolve(value);
        };

        const handleCancel = () => {
          cleanup();
          resolve(null);
        };

        const handleKeydown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') handleCancel();
        };

        buttons.forEach((btn) => btn.addEventListener('click', handleChoice));
        cancelBtn.addEventListener('click', handleCancel);
        modalOverlay.addEventListener('keydown', handleKeydown);
        buttons[0]?.focus();
      });
    }
  };

  const ctx: RendererContext = {
    State,
    ViewManager,
    CustomUI,
    constants: { ID_DOMAIN },
    dom: { loggedInView, loggedOutView },
    helpers: {
      setupLoggedOutNav: createLoggedOutNavSetup({ ViewManager, loggedOutView })
    },
    services: {
      auth: authService,
      firestore: firestoreService
    }
  };

  initAuthSettings(ctx);
  initClientDevice(ctx);
  initAppDetail(ctx);
  initScanController(ctx);
  initActionHandlers(ctx);
});
