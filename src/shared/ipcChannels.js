// src/shared/ipcChannels.js
// IPC channel names are centralized here so main/preload stay in sync.

/**
 * IMPORTANT:
 * - Keep this file CommonJS only.
 * - Both main (require) and preload (require) depend on it.
 */
module.exports = {
  AUTH: {
    LOGIN: 'firebase-auth-login',
    LOGOUT: 'firebase-auth-logout',
    CREATE_USER: 'firebase-auth-create-user'
  },

  ANDROID: {
    CHECK_DEVICE_CONNECTION: 'check-device-connection',
    RUN_SCAN: 'run-scan',
    OPEN_SCAN_FILE: 'open-scan-file',
    GET_APP_DATA: 'get-app-data',
    UNINSTALL_APP: 'uninstall-app',
    NEUTRALIZE_APP: 'neutralize-app',
    DELETE_APK_FILE: 'delete-apk-file',
    AUTO_PUSH_REPORT: 'auto-push-report-to-android',
    START_FULL_SCAN: 'start-full-scan',
    GET_DASHBOARD_DATA: 'get-android-dashboard-data'
  },

  IOS: {
    CHECK_CONNECTION: 'check-ios-connection',
    RUN_SCAN: 'run-ios-scan',
    DELETE_BACKUP: 'delete-ios-backup'
  },

  APP: {
    FORCE_WINDOW_RESET: 'force-window-reset',
    SAVE_SCAN_RESULT: 'saveScanResult',
    CHECK_FOR_UPDATE: 'checkForUpdate',
    SAVE_LOGIN_INFO: 'saveLoginInfo',
    GET_LOGIN_INFO: 'getLogininfo',
    READ_TEXT_FILE: 'read-text-file'
  },

  FIRESTORE: {
    CALL: 'firestore-call'
  },

  EVENTS: {
    UPDATE_START: 'update-start',
    UPDATE_PROGRESS: 'update-progress',
    UPDATE_ERROR: 'update-error'
  }
};
