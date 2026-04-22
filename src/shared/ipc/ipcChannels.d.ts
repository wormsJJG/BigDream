declare const IPC: {
  AUTH: {
    LOGIN: 'firebase-auth-login';
    LOGOUT: 'firebase-auth-logout';
    CREATE_USER: 'firebase-auth-create-user';
  };
  ANDROID: {
    CHECK_DEVICE_CONNECTION: 'check-device-connection';
    RUN_SCAN: 'run-scan';
    OPEN_SCAN_FILE: 'open-scan-file';
    GET_APP_DATA: 'get-app-data';
    GET_GRANTED_PERMISSIONS: 'get-granted-permissions';
    UNINSTALL_APP: 'uninstall-app';
    NEUTRALIZE_APP: 'neutralize-app';
    DELETE_APK_FILE: 'delete-apk-file';
    AUTO_PUSH_REPORT: 'auto-push-report-to-android';
    GET_DASHBOARD_DATA: 'get-android-dashboard-data';
    GET_DEVICE_SECURITY_STATUS: 'get-device-security-status';
    PERFORM_DEVICE_SECURITY_ACTION: 'perform-device-security-action';
    SET_DEVICE_SECURITY_SETTING: 'set-device-security-setting';
    OPEN_ANDROID_SETTINGS: 'open-android-settings';
  };
  IOS: {
    CHECK_CONNECTION: 'check-ios-connection';
    RUN_SCAN: 'run-ios-scan';
    DELETE_BACKUP: 'delete-ios-backup';
    EXPORT_REPORT_PDF: 'export-ios-report-pdf';
    PROGRESS: 'ios-scan-progress';
  };
  APP: {
    FORCE_WINDOW_RESET: 'force-window-reset';
    SAVE_SCAN_RESULT: 'saveScanResult';
    SAVE_LOGIN_INFO: 'saveLoginInfo';
    GET_LOGIN_INFO: 'getLogininfo';
    READ_TEXT_FILE: 'read-text-file';
  };
  FIRESTORE: {
    CALL: 'firestore-call';
  };
  EVENTS: {
    UPDATE_START: 'update-start';
    UPDATE_PROGRESS: 'update-progress';
    UPDATE_ERROR: 'update-error';
  };
};

export = IPC;
