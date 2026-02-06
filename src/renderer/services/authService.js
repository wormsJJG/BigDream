// src/renderer/services/authService.js
// Renderer-side auth state holder. Main process performs the real Firebase Auth.

let currentUser = null;

function normalizeLoginResult(email, result) {
  // Possible shapes:
  // - { uid, email }
  // - { user: { uid, email } }
  // - uid string
  if (!result) return null;
  if (typeof result === 'string') return { uid: result, email };
  if (result.uid) return { uid: result.uid, email: result.email || email };
  if (result.user && result.user.uid) return { uid: result.user.uid, email: result.user.email || email };
  return null;
}

export function createAuthService() {
  return {
    setCurrentUser(user) {
      currentUser = user || null;
    },
    getCurrentUser() {
      return currentUser;
    },
    async login(email, password) {
      if (!window?.bdScanner?.auth?.login && !window?.electronAPI?.firebaseAuthLogin) {
        throw new Error('AUTH_IPC_NOT_AVAILABLE');
      }
      const result = window?.bdScanner?.auth?.login
        ? await window.bdScanner.auth.login(email, password)
        : await window.electronAPI.firebaseAuthLogin(email, password);

      const user = normalizeLoginResult(email, result) || { uid: undefined, email };
      currentUser = user.uid ? user : currentUser; // only set when uid exists
      return user;
    },
    async logout() {
      try {
        if (window?.bdScanner?.auth?.logout) {
          await window.bdScanner.auth.logout();
        } else if (window?.electronAPI?.firebaseAuthLogout) {
          await window.electronAPI.firebaseAuthLogout();
        }
      } finally {
        currentUser = null;
      }
    },

    // Admin 기능: 사용자 생성 (renderer에서 Firebase SDK 직접 사용 금지)
    async createUser(email, password) {
      if (!window?.bdScanner?.auth?.createUser && !window?.electronAPI?.firebaseAuthCreateUser) {
        throw new Error('AUTH_CREATE_USER_IPC_NOT_AVAILABLE');
      }
      // main에서 createUser 수행 후 uid 반환(형태가 달라도 normalize)
      const result = window?.bdScanner?.auth?.createUser
        ? await window.bdScanner.auth.createUser(email, password)
        : await window.electronAPI.firebaseAuthCreateUser(email, password);

      const created = normalizeLoginResult(email, result) || (typeof result === 'string' ? { uid: result, email } : null);
      if (!created || !created.uid) {
        // Some implementations might return { uid } directly
        if (result && result.uid) return { uid: result.uid, email: result.email || email };
        throw new Error('AUTH_CREATE_USER_INVALID_RESULT');
      }
      return created;
    },
  };
}
