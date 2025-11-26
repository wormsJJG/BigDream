// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// ★★★ preload.js가 실행되었는지 콘솔에서 확인 ★★★
console.log('--- preload.js: 로드됨 ---');

contextBridge.exposeInMainWorld(
    'electronAPI', // window.electronAPI 로 부르게 됩니다.
    {
        // ★★★ 각 함수가 존재하는지 콘솔에서 확인 ★★★
        runScan: () => {
            console.log('--- preload.js: runScan 호출됨 ---');
            return ipcRenderer.invoke('run-scan');
        },
        openScanFile: () => {
            console.log('--- preload.js: openScanFile 호출됨 ---');
            return ipcRenderer.invoke('open-scan-file');
        }
    }
);

contextBridge.exposeInMainWorld('electronAPI', {
    runScan: () => ipcRenderer.invoke('run-scan'),
    openScanFile: () => ipcRenderer.invoke('open-scan-file'),
    
    // [추가] 연결 확인 함수 노출
    checkDeviceConnection: () => ipcRenderer.invoke('check-device-connection') 
});

console.log('--- preload.js: electronAPI 브릿지 생성 완료 ---');