/**
 * src/main/ipc/appHandlers.js
 * IPC registration for app-level utility flows.
 */

const os = require('os');
const path = require('path');
const IPC_MODULE = require('../../shared/ipc/ipcChannels');
const IPC = IPC_MODULE.default || IPC_MODULE;

function registerAppHandlers({ ipcMain, BrowserWindow, dialog, app, fs }) {
  if (!ipcMain) throw new Error('registerAppHandlers: ipcMain is required');
  if (!BrowserWindow) throw new Error('registerAppHandlers: BrowserWindow is required');
  if (!dialog) throw new Error('registerAppHandlers: dialog is required');
  if (!app) throw new Error('registerAppHandlers: app is required');
  if (!fs) throw new Error('registerAppHandlers: fs is required');

  ipcMain.handle(IPC.APP.FORCE_WINDOW_RESET, () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return;

    mainWindow.blur();
    setTimeout(() => {
      mainWindow.focus();
      mainWindow.show();
      if (mainWindow.webContents) {
        mainWindow.webContents.focus();
      }
    }, 50);
  });

  ipcMain.handle(IPC.APP.SAVE_SCAN_RESULT, async (_event, data) => {
    try {
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const modelName = data?.deviceInfo?.model ? data.deviceInfo.model.replace(/\s/g, '_') : 'UnknownDevice';
      const defaultPath = path.join(os.homedir(), `BD_${dateStr}_${modelName}.json`);

      const result = await dialog.showSaveDialog({
        title: '검사 결과 저장',
        defaultPath,
        filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
      });

      if (result.canceled) {
        return { success: false, message: '저장 취소' };
      }

      const filePath = result.filePath;
      try {
        data.meta = data.meta || {};
        data.meta.savedAt = new Date().toISOString();
      } catch (_e) {}

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return { success: true, message: `결과가 성공적으로 저장되었습니다:\n${filePath}` };
    } catch (err) {
      console.error('로컬 저장 오류:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.ANDROID.OPEN_SCAN_FILE, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '검사 결과 열기',
        properties: ['openFile'],
        filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: '열기 취소' };
      }

      const filePath = result.filePaths[0];
      const scanData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (!scanData.deviceInfo || !scanData.deviceInfo.os) {
        throw new Error('파일 구조가 올바르지 않거나 OS 정보가 누락되었습니다.');
      }

      const rawOs = String(scanData.deviceInfo.os).toLowerCase();
      const normalizedOsMode = rawOs.includes('ios') ? 'ios' : 'android';
      const stat = fs.statSync(filePath);

      return {
        success: true,
        data: scanData,
        osMode: normalizedOsMode,
        fileMeta: {
          filePath,
          mtimeMs: stat.mtimeMs,
          savedAt: stat.mtimeMs
        }
      };
    } catch (err) {
      console.error('로컬 파일 열기 오류:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.APP.READ_TEXT_FILE, async (_evt, { relativePath }) => {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error('relativePath is required');
    }

    const baseDir = app.getAppPath();
    const resolved = path.resolve(baseDir, relativePath);
    if (!resolved.startsWith(baseDir)) {
      throw new Error('Invalid path');
    }

    return await fs.promises.readFile(resolved, 'utf8');
  });
}

module.exports = { registerAppHandlers };
