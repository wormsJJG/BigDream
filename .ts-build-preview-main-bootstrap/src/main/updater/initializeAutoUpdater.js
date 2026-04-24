"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAutoUpdater = initializeAutoUpdater;
function initializeAutoUpdater({ autoUpdater, log, BrowserWindow, CONFIG, Utils }) {
    const sendStatusToWindow = (channel, data) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
            mainWindow.webContents.send(channel, data);
        }
    };
    autoUpdater.on('checking-for-update', () => { log.info('업데이트 확인 중...'); });
    autoUpdater.on('update-available', (info) => {
        log.info('업데이트 가능');
        sendStatusToWindow('update-start', info.version);
    });
    autoUpdater.on('update-not-available', () => { log.info('최신 버전임'); });
    autoUpdater.on('error', (err) => {
        log.info('에러 발생: ' + err);
        sendStatusToWindow('update-error', err.message);
        if (err && err.message && (err.message.includes('403') || err.message.includes('429'))) {
            console.warn('⚠️ GitHub API 속도 제한에 도달했습니다. 나중에 다시 시도합니다.');
        }
    });
    autoUpdater.on('download-progress', (progressObj) => {
        log.info(`다운로드 중: ${progressObj.percent}%`);
        sendStatusToWindow('update-progress', {
            percent: Math.floor(progressObj.percent),
            bytesPerSecond: Utils.formatBytes(progressObj.bytesPerSecond) + '/s',
            transferred: Utils.formatBytes(progressObj.transferred),
            total: Utils.formatBytes(progressObj.total)
        });
    });
    autoUpdater.on('update-downloaded', () => {
        log.info('다운로드 완료. 앱을 재시작하여 업데이트를 적용합니다.');
        autoUpdater.quitAndInstall();
    });
    if (CONFIG.IS_DEV_MODE) {
        log.info('[Update] 개발 모드: 업데이트 체크를 생략합니다.');
        return;
    }
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify().catch((e) => {
            log.error('최초 업데이트 확인 실패:', e.message);
        });
    }, 5000);
}
