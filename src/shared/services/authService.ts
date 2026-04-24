import type { AuthCreateUserResult, AuthService, AuthUser } from '../../types/renderer-context';

let currentUser: AuthUser | null = null;

function normalizeLoginResult(email: string, result: unknown): AuthUser | null {
  if (!result) return null;
  if (typeof result === 'string') return { uid: result, email };
  if (typeof result === 'object' && result !== null) {
    const typed = result as {
      uid?: string;
      email?: string;
      user?: { uid?: string; email?: string };
    };
    if (typed.uid) return { uid: typed.uid, email: typed.email || email };
    if (typed.user?.uid) return { uid: typed.user.uid, email: typed.user.email || email };
  }
  return null;
}

export function createAuthService(): AuthService {
  return {
    setCurrentUser(user: AuthUser | null) {
      currentUser = user || null;
    },
    getCurrentUser() {
      return currentUser;
    },
    async login(email: string, password: string) {
      if (!window?.bdScanner?.auth?.login && !window?.electronAPI?.firebaseAuthLogin) {
        throw new Error('AUTH_IPC_NOT_AVAILABLE');
      }
      const result = window?.bdScanner?.auth?.login
        ? await window.bdScanner.auth.login(email, password)
        : await window.electronAPI.firebaseAuthLogin(email, password);

      const user = normalizeLoginResult(email, result) || { uid: undefined, email };
      currentUser = user.uid ? user : currentUser;
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
    async createUser(email: string, password: string): Promise<AuthCreateUserResult> {
      if (!window?.bdScanner?.auth?.createUser && !window?.electronAPI?.firebaseAuthCreateUser) {
        throw new Error('AUTH_CREATE_USER_IPC_NOT_AVAILABLE');
      }
      const result = window?.bdScanner?.auth?.createUser
        ? await window.bdScanner.auth.createUser(email, password)
        : await window.electronAPI.firebaseAuthCreateUser(email, password);

      const created = normalizeLoginResult(email, result) || (typeof result === 'string' ? { uid: result, email } : null);
      if (!created || !created.uid) {
        if (typeof result === 'object' && result !== null && 'uid' in result && typeof result.uid === 'string') {
          return {
            uid: result.uid,
            email: ('email' in result && typeof result.email === 'string') ? result.email : email
          };
        }
        throw new Error('AUTH_CREATE_USER_INVALID_RESULT');
      }
      return created as AuthCreateUserResult;
    },
  };
}
