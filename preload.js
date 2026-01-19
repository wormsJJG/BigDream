// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// ★★★ preload.js가 실행되었는지 콘솔에서 확인 ★★★
console.log('--- preload.js: 로드됨 ---');

contextBridge.exposeInMainWorld(
    'electronAPI', // window.electronAPI 로 부르게 됩니다.
    {
        // ★★★ 각 함수가 존재하는지 콘솔에서 확인 ★★★
        checkDeviceConnection: () => {

            console.log('--- preload.js: checkDeviceConnection 호출됨');
            return ipcRenderer.invoke('check-device-connection');
        },

        runScan: () => {
            console.log('--- preload.js: runScan 호출됨 ---');
            return ipcRenderer.invoke('run-scan');
        },
        openScanFile: () => {
            console.log('--- preload.js: openScanFile 호출됨 ---');
            return ipcRenderer.invoke('open-scan-file');
        },

        forceWindowReset: () => {
            return ipcRenderer.invoke('force-window-reset');
        },

        getAppData: (packageName) => {
            console.log('--- preload.js: getAppData() 호출됨 ---');

            return ipcRenderer.invoke('get-app-data', packageName);
        },

        uninstallApp: (packageName) => {

            console.log('--- preload.js: uninstallApp 호출됨');

            return ipcRenderer.invoke('uninstall-app', packageName);
        },

        neutralizeApp: (pkg) => {

            console.log('--- preload.js: neutalizeApp 호출됨');

            return ipcRenderer.invoke('neutralize-app', pkg);
        },

        checkIosConnection: () => {

            console.log('--- preload.js: checkIosConnection 호출됨');

            return ipcRenderer.invoke('check-ios-connection');
        },

        runIosScan: (udid) => {

            console.log('--- preload.js: runIosScan 호출됨');

            return ipcRenderer.invoke('run-ios-scan', udid);
        },
        // 백업 삭제 API
        deleteIosBackup: (udid) => {
            console.log('--- preload.js: deleteIosBackup 호출됨');
            return ipcRenderer.invoke('delete-ios-backup', udid);
        },
        // APK 파일 삭제 통로
        deleteApkFile: (data) => ipcRenderer.invoke('delete-apk-file', data),

        saveScanResult: (data) => {

            console.log('--- preload.js: saveScanResult 호출됨');
            return ipcRenderer.invoke('saveScanResult', data);
        },
        checkForUpdate: (currentVersion) => {

            console.log('--- preload.js: checkForUpdate 호출됨');
            return ipcRenderer.invoke('checkForUpdate', currentVersion)
        },
        saveLoginInfo: async (data) => {

            console.log(data)
            console.log('--- preload.js: save-login-info 호출됨');
            return ipcRenderer.invoke('saveLoginInfo', data);
        },
        getLoginInfo: async () => {

            console.log('--- preload.js: get-login-info 호출됨');
            return ipcRenderer.invoke('getLogininfo');
        },
        onUpdateStart: (callback) => ipcRenderer.on('update-start', (event, version) => callback(version)),
        onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, data) => callback(data)),
        onUpdateError: (callback) => ipcRenderer.on('update-error', (event, msg) => callback(msg)),
        autoPushReportToAndroid: () => ipcRenderer.invoke('auto-push-report-to-android')
    }
);

console.log('--- preload.js: electronAPI 브릿지 생성 완료 ---');



