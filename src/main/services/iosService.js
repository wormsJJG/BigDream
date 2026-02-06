/**
 * Auto-extracted from legacy bootstrap.js for maintainable structure.
 * Responsibility: iOS domain operations only (no IPC wiring).
 */
function createIosService({ fs, path, os, log, CONFIG, Utils }) {
  // NOTE: bootstrap.js passes a single options object.
  if (!fs) throw new Error('createIosService requires fs');
  const service = {

      /**
       * Check iOS device connection using configured idevice tools.
       */
      async checkConnection() {
          console.log(`[iOS] 연결 확인 시작: ${CONFIG.PATHS.IOS_ID}`);
          try {
              const cmdId = `"${CONFIG.PATHS.IOS_ID}" -l`;
              const udidOutput = await Utils.runCommand(cmdId);
              const udid = (udidOutput || '').trim();

              if (!udid) return { status: 'disconnected' };

              const cmdInfo = `"${CONFIG.PATHS.IOS_INFO}" -k DeviceName`;
              const nameOutput = await Utils.runCommand(cmdInfo);
              const modelName = nameOutput ? nameOutput.trim() : 'iPhone Device';
              return { status: 'connected', model: modelName, udid, type: 'ios' };
          } catch (error) {
              const detailedError = error.message || 'iOS 도구 실행 중 알 수 없는 오류';
              if (!fs.existsSync(CONFIG.PATHS.IOS_ID)) {
                  return { status: 'error', error: `필수 도구 파일 없음: ${CONFIG.PATHS.IOS_ID}` };
              }
              console.error(`❌ [iOS] 연결 확인 실패 상세: ${detailedError}`);
              let userMsg = 'iOS 기기 연결 오류. iTunes/Apple 드라이버가 설치되었는지 확인하세요.';
              if (detailedError.includes('command failed')) {
                  userMsg = "iOS 도구 실행 실패. 기기가 잠금 해제되었는지, '이 컴퓨터 신뢰'를 수락했는지 확인하세요.";
              }
              return { status: 'error', error: userMsg };
          }
      },

      /**
       * Full iOS scan pipeline (backup -> mvt -> parse).
       */
      async runScan(udid) {
          console.log(`--- [iOS] 정밀 분석 시작 (UDID: ${udid}) ---`);
          const { TEMP_BACKUP, MVT_RESULT, IOS_BACKUP } = CONFIG.PATHS;
          const specificBackupPath = path.join(TEMP_BACKUP, udid);

          try {
              let isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));

              if (!isBackupComplete) {
                  console.log('[iOS] 신규 검사를 위해 백업을 시작합니다...');

                  try {
                      await Utils.runCommand('taskkill /F /IM idevicebackup2.exe /T').catch(() => {});
                      await Utils.runCommand('taskkill /F /IM ideviceinfo.exe /T').catch(() => {});
                  } catch (_e) {}

                  if (fs.existsSync(specificBackupPath)) {
                      fs.rmSync(specificBackupPath, { recursive: true, force: true });
                  }
                  if (!fs.existsSync(TEMP_BACKUP)) fs.mkdirSync(TEMP_BACKUP, { recursive: true });

                  const backupCmd = `"${IOS_BACKUP}" backup --full "${TEMP_BACKUP}" -u ${udid}`;
                  try {
                      await Utils.runCommand(backupCmd);
                      console.log('[iOS] 백업 명령어 수행 완료.');
                  } catch (_backupErr) {
                      console.warn('[iOS] 백업 종료 과정에서 경고가 발생했으나, 데이터 무결성을 확인합니다...');
                  }

                  isBackupComplete = fs.existsSync(path.join(specificBackupPath, 'Status.plist'));
              }

              if (!isBackupComplete) {
                  throw new Error('백업 데이터가 생성되지 않았습니다. 아이폰 연결 상태를 확인해주세요.');
              }

              console.log('[iOS] 🚀 데이터 확보 확인! 즉시 정밀 분석 단계로 전환합니다.');

              let deviceInfo = { model: 'iPhone', serial: udid, phoneNumber: '-', os: 'iOS' };
              try {
                  const plistPath = path.join(specificBackupPath, 'Info.plist');
                  if (fs.existsSync(plistPath)) {
                      const content = fs.readFileSync(plistPath, 'utf8');
                      deviceInfo.model = content.match(/<key>Product Type<\/key>\s*<string>(.*?)<\/string>/)?.[1] || 'iPhone';
                      deviceInfo.phoneNumber = content.match(/<key>PhoneNumber<\/key>\s*<string>(.*?)<\/string>/)?.[1] || '-';
                      const version = content.match(/<key>Product Version<\/key>\s*<string>(.*?)<\/string>/)?.[1];
                      if (version) deviceInfo.os = `iOS ${version}`;
                  }
              } catch (e) {
                  console.warn('기기 정보 추출 실패(무시하고 진행):', e.message);
              }

              Utils.cleanDirectory(MVT_RESULT);
              if (!fs.existsSync(MVT_RESULT)) fs.mkdirSync(MVT_RESULT);

              console.log('3. MVT 분석 엔진 가동...');
              const mvtCmd = `mvt-ios check-backup --output "${MVT_RESULT}" "${specificBackupPath}"`;
              await Utils.runCommand(mvtCmd).catch(() => console.warn('MVT 실행 중 경고 무시'));

              const results = service.parseMvtResults(MVT_RESULT, deviceInfo);
              console.log('[iOS] 전체 프로세스 완료. 결과 화면으로 넘어갑니다.');
              return results;
          } catch (err) {
              console.error('iOS 검사 프로세스 오류:', err.message);
              return { error: '검사 실패: ' + err.message };
          }
      },

      async deleteBackup(udid) {
          console.log(`--- [Security] 삭제 요청 수신 (전달된 UDID: ${udid}) ---`);
          if (!udid) return { success: false, error: 'No UDID provided' };
          if (CONFIG.KEEP_BACKUP) {
              console.log('[Maintenance] KEEP_BACKUP 활성화 상태: 파일을 유지합니다.');
              return { success: true };
          }
          try {
              const specificPath = path.join(CONFIG.PATHS.TEMP_BACKUP, udid);
              if (fs.existsSync(specificPath)) {
                  fs.rmSync(specificPath, { recursive: true, force: true });
                  console.log('[Security] 배포 모드: 백업 데이터 파기 성공.');
              }
              return { success: true };
          } catch (err) {
              console.error('[Security] 삭제 오류:', err.message);
              return { success: false, error: err.message };
          }
      },

      decodeUnicode(str) {
          if (!str) return '';
          try {
              return JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
          } catch (e) {
              return str;
          }
      },

      // 인자로 받은 fallbackDeviceInfo를 사용하여 초기화
      parseMvtResults(outputDir, fallbackDeviceInfo) {
          const findings = [];
          let fileCount = 0;

          // 1. 기기 정보 초기화 (변수명: finalDeviceInfo)
          let finalDeviceInfo = fallbackDeviceInfo || {
              model: 'iPhone (Unknown)', serial: '-', phoneNumber: '-', os: 'iOS', isRooted: false
          };

          // -------------------------------------------------
          // [A] backup_info.json 읽기 (기기 정보 갱신)
          // -------------------------------------------------
          const infoFilePath = path.join(outputDir, 'backup_info.json');

          if (fs.existsSync(infoFilePath)) {
              try {
                  const content = fs.readFileSync(infoFilePath, 'utf-8');
                  const infoJson = JSON.parse(content);

                  console.log('📂 [iOS] backup_info.json 로드 성공');

                  // 모델명 매핑
                  const modelMap = {
                      'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
                      'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13',
                      'iPhone14,6': 'iPhone SE (3rd)',
                      'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
                      'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
                      'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
                      'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
                      'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max',
                      'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus'
                  };

                  const pType = infoJson['Product Type'];
                  const friendlyModel = modelMap[pType] || infoJson['Product Name'] || pType || 'iPhone';

                  finalDeviceInfo = {
                      model: friendlyModel,
                      serial: infoJson['Serial Number'] || infoJson['IMEI'] || finalDeviceInfo.serial,
                      phoneNumber: infoJson['Phone Number'] || finalDeviceInfo.phoneNumber,
                      os: infoJson['Product Version'] ? `iOS ${infoJson['Product Version']}` : finalDeviceInfo.os,
                      isRooted: false
                  };

                  console.log(`✅ [iOS] 기기 정보: ${finalDeviceInfo.model} / ${finalDeviceInfo.phoneNumber}`);

              } catch (e) {
                  console.warn(`⚠️ [iOS] 기기 정보 파싱 실패: ${e.message}`);
              }
          }

          // -------------------------------------------------
          // [B] 위협 데이터 파싱 (detected.json 등)
          // -------------------------------------------------
          const targetFiles = ['detected.json', 'suspicious_processes.json', 'suspicious_files.json'];

          targetFiles.forEach(fileName => {
              const filePath = path.join(outputDir, fileName);
              if (fs.existsSync(filePath)) {
                  try {
                      const content = fs.readFileSync(filePath, 'utf-8');
                      if (content && content.trim()) {
                          let items = [];
                          try {
                              const parsed = JSON.parse(content);
                              items = Array.isArray(parsed) ? parsed : [parsed];
                          } catch (e) {
                              content.trim().split('\n').forEach(line => {
                                  try { if (line.trim()) items.push(JSON.parse(line)); } catch (err) { }
                              });
                          }
                          items.forEach(item => {
                              item.source_file = fileName;
                              findings.push(item);
                          });
                          fileCount++;
                      }
                  } catch (err) { }
              }
          });

          // -------------------------------------------------
          // 💡 [C] 설치된 앱 목록 추출 (applications.json 파싱) 💡
          // -------------------------------------------------
          const installedApps = [];
          const appsFilePath = path.join(outputDir, 'applications.json');

          if (fs.existsSync(appsFilePath)) {
              try {
                  const appContent = fs.readFileSync(appsFilePath, 'utf-8');
                  let rawApps = [];

                  // 1. **[시도 1: 단일 JSON 배열]**
                  try {
                      const parsedJson = JSON.parse(appContent);
                      if (Array.isArray(parsedJson)) {
                          rawApps = parsedJson;
                          console.log('✅ [iOS] applications.json: 단일 JSON 배열로 성공적으로 파싱됨.');
                      } else {
                          throw new Error("Not an array");
                      }
                  } catch (e) {
                      // 2. **[시도 2: JSON Lines]**
                      console.log('🔄 [iOS] applications.json: 단일 배열 파싱 실패. JSON Lines로 재시도.');
                      const lines = appContent.trim().split('\n').filter(line => line.trim().length > 0);

                      lines.forEach(line => {
                          try {
                              rawApps.push(JSON.parse(line));
                          } catch (e) { }
                      });
                  }

                  // 3. 표준 형식으로 변환
                  rawApps.forEach(appData => {
                      const bundleId = appData.softwareVersionBundleId || appData.name;
                      const itemName = appData.itemName || appData.title;

                      if (bundleId) {
                          const decodedName = this.decodeUnicode(itemName);

                          installedApps.push({
                              packageName: bundleId,
                              cachedTitle: decodedName || Utils.formatAppName(bundleId),
                              installer: appData.sourceApp || 'AppStore'
                          });
                      }
                  });

                  console.log(`✅ [iOS] 설치된 앱 목록 ${installedApps.length}개 획득 완료.`);

              } catch (e) {
                  console.error(`❌ [iOS] applications.json 파일 읽기/처리 최종 실패: ${e.message}`);
              }
          } else {
              console.warn(`⚠️ [iOS] 앱 목록 파일(applications.json)을 찾을 수 없습니다.`);
          }

          console.log(`[IosService] 파싱 완료. 위협: ${findings.length}건`);

          const mvtResults = {
              web: { name: '웹 브라우징 데이터 검사', files: ['Safari History', 'Chrome Bookmarks'], findings: [] },
              messages: { name: '메시지 및 통화 기록 검사', files: ['SMS/iMessage DB', 'Call History'], findings: [] },
              system: { name: '시스템 파일 및 설정 검사', files: ['Configuration Files', 'Log Files'], findings: [] },
              appData: { name: '설치된 앱 데이터베이스 검사', files: ['Manifest.db', 'App Sandboxes'], findings: [] },
              ioc: { name: '위협 인디케이터 검사', files: ['Detected IOCs'], findings: [] },
          };

          return {
              deviceInfo: finalDeviceInfo,
              suspiciousItems: findings,
              allApps: installedApps,
              fileCount: fileCount,
              mvtResults: mvtResults
          };
      }
  };
  return service;
}

module.exports = { createIosService };
