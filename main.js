// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    console.log('--- main.js: createWindow() 호출됨 ---');
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // preload.js 스크립트를 주입합니다.
            // 이 경로가 틀리면 앱이 절대 동작하지 않습니다.
            preload: path.join(__dirname, 'preload.js'),
            // 보안 설정 (필수)
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');

    // ★★★ 디버깅을 위해 개발자 도구를 자동으로 엽니다 ★★★
    mainWindow.webContents.openDevTools();
    
    console.log('--- main.js: preload.js 경로:', path.join(__dirname, 'preload.js'), '---');
}

app.whenReady().then(() => {
    console.log('--- main.js: App is ready, createWindow 호출 ---');
    createWindow();
});

ipcMain.handle('check-device-connection', async () => {
    try {
        const devices = await client.listDevices();
        if (devices.length > 0) {
            // 연결된 첫 번째 기기의 모델명 가져오기 시도 (선택사항)
            const serial = devices[0].id;
            let model = serial; // 기본값은 시리얼 번호
            try {
                // 모델명 가져오기: adb -s [serial] shell getprop ro.product.model
                const output = await client.shell(serial, 'getprop ro.product.model');
                const data = await adb.util.readAll(output);
                model = data.toString().trim();
            } catch (e) { /* 모델명 가져오기 실패 시 무시 */ }

            return { connected: true, model: model };
        } else {
            return { connected: false };
        }
    } catch (err) {
        console.error('기기 확인 중 오류:', err);
        return { connected: false, error: err.message };
    }
});

// (검사열기 기능 - File Open Dialog)
ipcMain.handle('open-scan-file', async () => {
    console.log('--- main.js: open-scan-file 이벤트 수신 ---');
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Scan Results', extensions: ['json'] }]
    });

    if (canceled || filePaths.length === 0) {
        return null;
    }

    try {
        const data = fs.readFileSync(filePaths[0], 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error("파일 읽기 오류:", error);
        return null;
    }
});

// (이곳에 나중에 'run-scan' 등 ADB 관련 로직 추가)
ipcMain.handle('run-scan', async () => {
    console.log('--- main.js: run-scan 이벤트 수신 (기능 구현 필요) ---');
    // (시뮬레이션) 2초 후에 가짜 결과 반환
    await new Promise(resolve => setTimeout(resolve, 2000)); 
    return { 
        suspiciousApps: [{ name: 'com.fake.sideloaded', reason: 'Sideloaded' }],
        apkFiles: ['/sdcard/fake.apk']
    };
});
