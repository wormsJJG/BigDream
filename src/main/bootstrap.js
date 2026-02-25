/**
 * src/main/bootstrap.js
 * Main-process bootstrap (refactor-safe).
 * - Keeps rootDir for resource resolution.
 * - Keeps legacy relative paths working via process.chdir(rootDir).
 */
function start({ rootDir }) {
  if (!rootDir) {
    throw new Error('bootstrap.start requires { rootDir }');
  }

  // Keep legacy relative paths working (e.g., loadFile('loading.html')).
  try { process.chdir(rootDir); } catch (e) {}

  /**
   * main.js
   * BD (Big Dream) Mobile Security Solution
   * Electron Main Process
   */

  const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const crypto = require('crypto');
  const adb = require('adbkit');
  const axios = require('axios');
  const gplayRaw = require('google-play-scraper');
  const gplay = gplayRaw.default || gplayRaw;
  const { exec, spawn } = require('child_process');
  const { autoUpdater } = require("electron-updater");
  const log = require('electron-log');
  const { EventEmitter } = require('events');
  const ApkReader = require('adbkit-apkreader');

  const { createMainWindow } = require('./window/createMainWindow');
  const { initializeAutoUpdater } = require('./updater/initializeAutoUpdater');
  const { createLoginStorage } = require('./services/loginStorage');
  const { createFirestoreService } = require('./services/firestoreService');
  const { createUpdateService } = require('./services/updateService');
  const { registerAuthHandlers } = require('./ipc/authHandlers');
  const { registerFirestoreHandlers } = require('./ipc/firestoreHandlers');
  const { registerUpdateHandlers } = require('./ipc/updateHandlers');
  const { createAndroidService } = require('./services/androidService');
  const { createIosService } = require('./services/iosService');
  const { registerAndroidHandlers } = require('./ipc/androidHandlers');
  const { registerIosHandlers } = require('./ipc/iosHandlers');


  const aiEvents = new EventEmitter();
  aiEvents.setMaxListeners(0);

  const { analyzeAppWithStaticModel } = require(path.join(rootDir, 'ai', 'aiStaticAnalyzer')); // 경로는 맞게 조정

  let aiProcess = null;

  // ============================================================
  // [1] 환경 설정 및 상수 (CONFIGURATION)
  // ============================================================

  const RESOURCE_DIR = app.isPackaged ? process.resourcesPath : rootDir;

  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = "info";
  autoUpdater.autoDownload = true; // 업데이트 발견 시 자동 다운로드
  autoUpdater.allowPrerelease = false;

  // "true"(string) / true(boolean) 혼재로 인한 설정 오동작 방지
  const parseBool = (v, fallback = false) => {
      if (v === true) return true;
      if (v === false) return false;
      if (v === 1 || v === 0) return Boolean(v);
      if (typeof v === 'string') {
          const s = v.trim().toLowerCase();
          if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
          if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
      }
      return fallback;
  };

  const CONFIG = {
      IS_DEV_MODE: false,
      KEEP_BACKUP: false,     // true: 백업 파일 삭제 안 함 (유지보수용) / false: 검사 후 즉각 삭제 (배포용)
      VIRUSTOTAL_API_KEY: '2aa1cd78a23bd4ae58db52c773d7070fd7f961acb6debcca94ba9b5746c2ec96',
      PATHS: {
          ADB: path.join(RESOURCE_DIR, 'platform-tools', os.platform() === 'win32' ? 'adb.exe' : 'adb'),
          IOS_TOOLS: path.join(RESOURCE_DIR, 'ios-tools'),
          IOS_ID: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'idevice_id.exe' : 'idevice_id'),
          IOS_INFO: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo'),
          IOS_BACKUP: path.join(RESOURCE_DIR, 'ios-tools', os.platform() === 'win32' ? 'idevicebackup2.exe' : 'idevicebackup2'),
          TEMP_BACKUP: path.join(app.getPath('userData'), 'iphone_backups'),
          MVT_RESULT: path.join(app.getPath('userData'), 'mvt_results'),
          LOGIN_CONFIG_PATH: path.join(app.getPath('userData'), 'login-info.json')
      }
  };

  // Normalize boolean flags (avoid "KEEP_BACKUP: 'true'" causing unexpected behavior)
  CONFIG.KEEP_BACKUP = parseBool(CONFIG.KEEP_BACKUP, false);

  // ============================================================
  // [1-1] Services (side-effect free)
  // ============================================================
  const loginStorage = createLoginStorage({
    configPath: CONFIG.PATHS.LOGIN_CONFIG_PATH,
    safeStorage,
    fs,
  });

const firestoreService = createFirestoreService();
const updateService = createUpdateService({ firestoreService });



  // ==========================================================
  // [1-2] IPC registration (grouped by feature)
  // ==========================================================
  registerAuthHandlers({ ipcMain, loginStorage });
  registerFirestoreHandlers({ ipcMain, firestoreService });
  registerUpdateHandlers({ ipcMain, updateService });

  const Utils = {

      sleep: (ms) => new Promise(r => setTimeout(r, ms)),

      formatAppName(bundleId) {
          if (!bundleId) return "Unknown";
          const parts = bundleId.split('.');
          let name = parts[parts.length - 1];
          return name.charAt(0).toUpperCase() + name.slice(1);
      },

      // VirusTotal API 호출
      async checkVirusTotal(fileHash) {
          try {
              const response = await axios.get(`https://www.virustotal.com/api/v3/files/${fileHash}`, {
                  headers: { 'x-apikey': CONFIG.VIRUSTOTAL_API_KEY }
              });
              const stats = response.data.data.attributes.last_analysis_stats;
              return {
                  malicious: stats.malicious,
                  suspicious: stats.suspicious,
                  total: stats.malicious + stats.suspicious + stats.harmless + stats.undetected
              };
          } catch (error) {
              if (error.response && error.response.status === 404) return { not_found: true };
              return null;
          }
      },

      // 명령어 실행 (Promise 래퍼)
      runCommand(command, options = {}) {
          const opts = options || {};
          const hasStreamHandlers = !!opts.stream
              || typeof opts.onStdout === 'function'
              || typeof opts.onStderr === 'function'
              || typeof opts.onProgress === 'function';

          // ✅ Backward compatible behavior (buffered exec)
          if (!hasStreamHandlers) {
              return new Promise((resolve, reject) => {
                  exec(command, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
                      if (error) {
                          console.error(`명령어 실패: ${command}\n${stderr}`);
                          reject(error);
                      } else {
                          resolve(stdout);
                      }
                  });
              });
          }

          // ✅ Streaming behavior (spawn) for real-time progress parsing
          return new Promise((resolve, reject) => {
              const { spawn } = require('child_process');

              let stdoutAll = '';
              let stderrAll = '';

              const child = spawn(command, { shell: true, windowsHide: true });

              child.stdout.on('data', (buf) => {
                  const text = buf.toString();
                  stdoutAll += text;
                  if (typeof opts.onStdout === 'function') {
                      opts.onStdout(text);
                  }
                  if (typeof opts.onProgress === 'function') {
                      opts.onProgress({ stream: 'stdout', text });
                  }
              });

              child.stderr.on('data', (buf) => {
                  const text = buf.toString();
                  stderrAll += text;
                  if (typeof opts.onStderr === 'function') {
                      opts.onStderr(text);
                  }
                  if (typeof opts.onProgress === 'function') {
                      opts.onProgress({ stream: 'stderr', text });
                  }
              });

              child.on('error', (err) => {
                  console.error(`명령어 실패: ${command}\n${String(err && err.message || err)}`);
                  reject(err);
              });

              child.on('close', (code) => {
                  if (code === 0) {
                      resolve(stdoutAll);
                      return;
                  }

                  const err = new Error(`Command failed (code ${code}): ${command}`);
                  err.code = code;
                  err.stderr = stderrAll;
                  console.error(`명령어 실패: ${command}\n${stderrAll}`);
                  reject(err);
              });
          });
      },

      // 폴더 삭제
      cleanDirectory(dirPath) {
          try {
              if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
          } catch (e) { console.warn(`폴더 삭제 실패 (${dirPath}):`, e.message); }
      },

      formatBytes(bytes, decimals = 2) {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const dm = decimals < 0 ? 0 : decimals;
          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
      },

      async isMvtInstalled() {
          try {
              // mvt-ios 버전 정보를 요청하여 에러가 없으면 설치된 것으로 간주
              await this.runCommand('mvt-ios version');
              return true;
          } catch (e) {
              console.log(e)
              return false;
          }
      },

      async installMvtIfMissing(mainWindow) {
          if (await this.isMvtInstalled()) {
              console.log("✅ MVT 이미 설치되어 있음.");
              return true;
          }

          console.log("🔄 MVT 설치 시도 중...");
          const statusBox = new BrowserWindow({
              width: 400, height: 150, frame: false, parent: mainWindow, modal: true, show: false
          });
          // 상태 창 로드 (별도의 HTML 파일 필요)
          statusBox.loadFile('loading.html');
          statusBox.once('ready-to-show', () => statusBox.show());


          try {
              // 1. 필요한 Python 패키지 설치 (MVT 설치 전에 필수적으로 필요한 패키지)
              await this.runCommand('pip3 install --upgrade pip setuptools wheel');

              // 2. MVT 설치 (이 명령어는 시간이 오래 걸릴 수 있습니다.)
              // --user 플래그를 사용하여 시스템 권한 없이 현재 사용자 계정에 설치
              await this.runCommand('pip3 install mvt --user');

              console.log("✅ MVT 설치 성공.");
              statusBox.close();
              return true;

          } catch (e) {
              statusBox.close();
              dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'MVT 설치 실패',
                  message: `MVT 설치 중 오류가 발생했습니다. 수동 설치가 필요합니다. 오류: ${e.message}`,
              });
              return false;
          }
      },

      async checkAndInstallPrerequisites(mainWindow) {
          let pythonInstalled = false;

          // 1. Python 설치 여부 확인
          try {
              await this.runCommand('python --version');
              console.log("✅ Python 설치 확인 완료.");
              pythonInstalled = true;
          } catch (e) {
              try {
                  await this.runCommand('python --version');
                  console.log("✅ Python 설치 확인 완료.");
                  pythonInstalled = true;
              } catch (e) {
                  console.log("❌ Python이 시스템에 설치되어 있지 않거나 PATH에 없습니다.");
              }
          }

          if (!pythonInstalled) {
              // 2. Python이 없을 경우, 설치 안내 메시지 박스 표시
              const dialogResult = await dialog.showMessageBox(mainWindow, {
                  type: 'warning',
                  title: '필수 프로그램 설치 안내',
                  message: 'MVT 분석을 위해 Python 3.9 이상이 필요합니다.\n\n[예]를 누르면 공식 다운로드 페이지로 이동합니다.',
                  buttons: ['예 (설치 페이지 열기)', '아니오 (계속 진행)']
              });

              if (dialogResult.response === 0) {
                  require('electron').shell.openExternal('https://www.python.org/downloads/windows/');
              }
              return false;
          }

          // 3. Python이 설치되어 있다면 MVT 설치 단계로 이동
          return await this.installMvtIfMissing(mainWindow);
      }
  };

  // ADB 클라이언트 초기화
  const client = adb.createClient({ bin: CONFIG.PATHS.ADB });

  // ============================================================
  // [2] 앱 생명주기 및 창 관리 (APP LIFECYCLE)
  // ============================================================

  // Window/updater logic moved into src/main/* modules for maintainability.

  app.whenReady().then(async () => {
      const mainWindow = createMainWindow({ baseDir: rootDir });
      await Utils.checkAndInstallPrerequisites(mainWindow);
      initializeAutoUpdater({ autoUpdater, log, BrowserWindow, CONFIG, Utils });
  }).catch(err => {
      console.log(err)
  });

  app.on('window-all-closed', () => {
      app.quit();
  })

  // 창 리셋 (UI 강제 새로고침 효과)
  ipcMain.handle('force-window-reset', () => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
          // 1. 강제로 포커스 해제 (Blur)
          mainWindow.blur();

          // 2. 아주 짧은 딜레이 후 다시 포커스 및 활성화
          setTimeout(() => {
              mainWindow.focus(); // 창 자체 포커스
              mainWindow.show();  // 확실하게 보이기

              // 3. 웹 콘텐츠(HTML) 내부에도 포커스 신호 전달
              if (mainWindow.webContents) {
                  mainWindow.webContents.focus();
              }
          }, 50); // 0.05초 딜레이 (OS가 인식할 시간 확보)
      }
  });


  async function getIosDeviceInfo(udid) {
      console.log(`[iOS] 기기 정보 조회 시도... (UDID: ${udid})`);

      let info = {
          model: 'iPhone (Unknown)',
          serial: udid,
          phoneNumber: '-',
          isRooted: false,
          os: 'iOS'
      };

      try {
          const toolDir = path.dirname(CONFIG.PATHS.IOS_BACKUP);
          const ideviceinfoPath = path.join(toolDir, 'ideviceinfo.exe');
          const cmd = `"${ideviceinfoPath}" -u ${udid}`;

          const output = await Utils.runCommand(cmd);

          const rawMap = {};
          output.split('\n').forEach(line => {
              const parts = line.split(':');
              if (parts.length >= 2) {
                  const key = parts[0].trim();
                  const val = parts.slice(1).join(':').trim();
                  rawMap[key] = val;
              }
          });

          const modelMap = {
              'iPhone10,3': 'iPhone X', 'iPhone10,6': 'iPhone X',
              'iPhone11,2': 'iPhone XS', 'iPhone11,4': 'iPhone XS Max', 'iPhone11,6': 'iPhone XS Max',
              'iPhone11,8': 'iPhone XR',
              'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max',
              'iPhone12,8': 'iPhone SE (2nd)',
              'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12',
              'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
              'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13',
              'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
              'iPhone14,6': 'iPhone SE (3rd)',
              'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
              'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
              'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
              'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
          };

          const pType = rawMap['ProductType'];
          if (pType) info.model = modelMap[pType] || pType;

          if (rawMap['SerialNumber']) info.serial = rawMap['SerialNumber'];
          if (rawMap['PhoneNumber']) info.phoneNumber = rawMap['PhoneNumber'];
          if (rawMap['ProductVersion']) info.os = `iOS ${rawMap['ProductVersion']}`;

      } catch (e) {
          console.warn(`⚠️ [iOS] ideviceinfo 실행 실패: ${e.message}`);
      }

      return info;
  }

    ipcMain.handle('saveScanResult', async (event, data) => {
      // data: { deviceInfo: {...}, allApps: [...], ... } 전체 검사 결과 객체
      try {
          const { dialog } = require('electron');

          // 파일명 생성: BD_YYYYMMDD_MODEL.json
          const now = new Date();
          const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
          const modelName = data.deviceInfo.model ? data.deviceInfo.model.replace(/\s/g, '_') : 'UnknownDevice';
          const defaultPath = path.join(os.homedir(), `BD_${dateStr}_${modelName}.json`);

          const result = await dialog.showSaveDialog({
              title: '검사 결과 저장',
              defaultPath: defaultPath,
              filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
          });

          if (result.canceled) {
              return { success: false, message: '저장 취소' };
          }

          const filePath = result.filePath;

          try {
              data.meta = data.meta || {};
              data.meta.savedAt = new Date().toISOString();
          } catch (_e) { }

          const jsonContent = JSON.stringify(data, null, 2);
          fs.writeFileSync(filePath, jsonContent);

          return { success: true, message: `결과가 성공적으로 저장되었습니다:\n${filePath}` };

      } catch (e) {
          console.error("로컬 저장 오류:", e);
          return { success: false, error: e.message };
      }
  });

  ipcMain.handle('open-scan-file', async (event) => {
      try {
          const { dialog } = require('electron');

          const result = await dialog.showOpenDialog({
              title: '검사 결과 열기',
              properties: ['openFile'],
              filters: [{ name: 'BD Scanner Report', extensions: ['json'] }]
          });

          if (result.canceled || result.filePaths.length === 0) {
              return { success: false, message: '열기 취소' };
          }

          const filePath = result.filePaths[0];
          const jsonContent = fs.readFileSync(filePath, 'utf-8');
          const scanData = JSON.parse(jsonContent);

          // 💡 [핵심] 저장된 OS 모드 파악 (UI 렌더링에 필요)
          // - 기존 데이터는 deviceInfo.os 값이 'ANDROID', 'iOS', 'iOS 17.2' 처럼 다양한 형태로 저장될 수 있음
          // - UI 분기에는 반드시 'android' | 'ios' 로 정규화해서 내려줘야 함
          if (!scanData.deviceInfo || !scanData.deviceInfo.os) {
              throw new Error('파일 구조가 올바르지 않거나 OS 정보가 누락되었습니다.');
          }

          const rawOs = String(scanData.deviceInfo.os).toLowerCase();
          const normalizedOsMode = rawOs.includes('ios') ? 'ios' : 'android';

          const stat = fs.statSync(filePath);
          const fileMeta = {
              filePath,
              mtimeMs: stat.mtimeMs,
              savedAt: stat.mtimeMs
          };

          return { success: true, data: scanData, osMode: normalizedOsMode, fileMeta };

      } catch (e) {
          console.error("로컬 파일 열기 오류:", e);
          return { success: false, error: e.message };
      }
  });

  // [8] 테스트용 가짜 데이터 (MOCK DATA)
  // ============================================================
  const MockData = {
      getAndroidConnection() {
          return { status: 'connected', model: 'SM-TEST' };
      },

      getAndroidScanResult() {
          const allApps = [
              { packageName: 'com.google.android.youtube', cachedTitle: 'YouTube', installer: 'com.android.vending', isSideloaded: false, uid: '10100', origin: '공식 스토어', dataUsage: { rx: 50000000, tx: 3000000 } },
              { packageName: 'com.android.systemui', cachedTitle: 'System UI', installer: null, isSideloaded: false, uid: '1000', origin: '시스템 앱', dataUsage: { rx: 1000000, tx: 500000 } },
              {
                  packageName: 'com.android.settings.daemon',
                  cachedTitle: 'Wi-Fi Assistant',
                  installer: null,
                  isSideloaded: true,
                  uid: '10272',
                  origin: '외부 설치',
                  dataUsage: { rx: 50000, tx: 85000000 },
                  permissions: ['ACCESS_FINE_LOCATION', 'READ_SMS', 'RECEIVE_BOOT_COMPLETED']
              },
              {
                  packageName: 'com.fp.backup',
                  cachedTitle: 'Backup Service',
                  installer: 'com.sideload.browser',
                  isSideloaded: true,
                  uid: '10273',
                  origin: '외부 설치',
                  dataUsage: { rx: 10000000, tx: 10000000 },
                  reason: '[VT 확진] 악성(22/68) + READ_SMS, READ_CALL_LOG 권한 다수'
              },
              {
                  packageName: 'com.hidden.syscore',
                  cachedTitle: '',
                  installer: null,
                  isSideloaded: true,
                  uid: '10274',
                  origin: '외부 설치',
                  dataUsage: { rx: 10000, tx: 2000000 },
                  permissions: ['SYSTEM_ALERT_WINDOW', 'CAMERA', 'RECORD_AUDIO']
              },
              { packageName: 'com.kakao.talk', cachedTitle: '카카오톡', installer: 'com.android.vending', isSideloaded: false, uid: '10275', origin: '공식 스토어', dataUsage: { rx: 20000000, tx: 5000000 } },
          ];

          const apkFiles = [
              '/sdcard/Download/system_update_v1.apk',
              '/sdcard/Android/data/com.hidden.syscore/files/core.apk',
          ];

          const suspiciousApps = allApps.filter(app => app.reason || (app.uid === '10272' && app.isSideloaded));

          if (!suspiciousApps.some(app => app.packageName === 'com.android.settings.daemon')) {
              suspiciousApps.push(allApps.find(app => app.packageName === 'com.android.settings.daemon'));
          }

          if (!suspiciousApps.some(app => app.packageName === 'com.hidden.syscore')) {
              suspiciousApps.push(allApps.find(app => app.packageName === 'com.hidden.syscore'));
          }

          return {
              deviceInfo: {
                  model: 'SM-F966N (MOCK)',
                  serial: 'RFCY71W09GM',
                  phoneNumber: '알 수 없음',
                  os: 'Android 14'
              },
              allApps: allApps,
              apkFiles: apkFiles,
              suspiciousApps: suspiciousApps.filter(Boolean),
              networkUsageMap: {
                  '10100': { rx: 50000000, tx: 3000000 },
                  '1000': { rx: 1000000, tx: 500000 },
                  '10272': { rx: 50000, tx: 85000000 },
                  '10273': { rx: 10000000, tx: 10000000 },
                  '10274': { rx: 10000, tx: 2000000 },
                  '10275': { rx: 20000000, tx: 5000000 }
              }
          };
      },

      getIosConnection() {
          return { status: 'connected', model: 'iPhone 15 Pro (TEST)', udid: '00008101-001E30590C000000', type: 'ios' };
      },

      getIosScanResult() {
          const installedApps = [
              { packageName: 'com.apple.camera', cachedTitle: '카메라' },
              { packageName: 'com.google.Gmail', cachedTitle: 'Gmail' },
              { packageName: 'com.lguplus.aicallagent', cachedTitle: '익시오' },
              { packageName: 'com.apple.weather', cachedTitle: '날씨' },
              { packageName: 'net.whatsapp.WhatsApp', cachedTitle: 'WhatsApp' },
              { packageName: 'com.spyware.agent.hidden', cachedTitle: '시스템 서비스' },
              { packageName: 'com.naver.map', cachedTitle: '네이버 지도' },
              { packageName: 'com.tistory.blog', cachedTitle: '티스토리' },
              { packageName: 'com.google.youtube', cachedTitle: 'YouTube' },
              { packageName: 'com.kakaobank.bank', cachedTitle: '카카오뱅크' },
          ];

          return {
              deviceInfo: {
                  model: 'iPhone 16 Pro (MOCK)',
                  serial: 'IOS-TEST-UDID',
                  phoneNumber: '+82 10-9999-0000',
                  os: 'iOS 17.4'
              },
              suspiciousItems: [
                  { module: 'SMS', check_name: 'iMessage Link IOC', description: '악성 도메인 접속 유도 링크 수신', path: '/private/var/mobile/Library/SMS/sms.db', sha256: 'a1b2c3d4...' },
                  { module: 'WebKit', check_name: 'Browser History IOC', description: 'Safari에서 C2 서버 도메인 접속 흔적 발견', path: '/private/var/mobile/Library/WebKit', sha256: 'e5f6g7h8...' },
                  { module: 'Process', check_name: 'Suspicious Process', description: '비정상적인 이름의 백그라운드 프로세스 활동', path: 'com.apple.bh', sha256: 'i9j0k1l2...' },
              ],
              mvtResults: {
                  web: { status: 'warning', warnings: ['악성 URL 접속 흔적: hxxp://c2-server.com', 'Safari 캐시에서 비정상 파일 발견'] },
                  messages: { status: 'warning', warnings: ['악성 도메인 접속 유도 링크 수신'] },
                  system: { status: 'warning', warnings: ['비정상적인 이름의 백그라운드 프로세스 활동', '의심스러운 Crash Report 발견'] },
                  apps: { status: 'safe', warnings: [] },
                  artifacts: { status: 'safe', warnings: [] }
              },
              allApps: installedApps,
              apkFiles: [],
          };
      },
  };


  // ============================================================
  // [REFAC] Android / iOS domain services + IPC handlers
  // ============================================================
  const androidService = createAndroidService({
    client,
    adb,
    ApkReader,
    fs,
    path,
    os,
    crypto,
    log,
    exec,
    CONFIG,
    analyzeAppWithStaticModel
  });

  const iosService = createIosService({
    fs,
    path,
    os,
    log,
    CONFIG,
    Utils
  });

  registerAndroidHandlers({
    ipcMain,
    CONFIG,
    MockData,
    Utils,
    client,
    androidService,
    log,
    app,
    BrowserWindow
  });

  registerIosHandlers({
    ipcMain,
    CONFIG,
    MockData,
    iosService,
    log
  });



  // ============================================================================
  // [Firestore Proxy + Template File Reader]
  // - Keeps renderer focused on UI/events.
  // - Main process performs Firestore CRUD via IPC.
  // - Also exposes safe file read for HTML template fragments (print/views).
  // ============================================================================
  const __path = path; // alias to make intent clear

  // Read a bundled text file safely (used for template fragments like print/view.html)
  ipcMain.handle('read-text-file', async (_evt, { relativePath }) => {
      if (!relativePath || typeof relativePath !== 'string') {
          throw new Error('relativePath is required');
      }
      // Base directory: app root (asar in production)
      const baseDir = app.getAppPath();
      const resolved = __path.resolve(baseDir, relativePath);

      // Prevent path traversal
      if (!resolved.startsWith(baseDir)) {
          throw new Error('Invalid path');
      }
      return await fs.promises.readFile(resolved, 'utf8');
  });
}

module.exports = { start };
