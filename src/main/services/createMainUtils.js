const { shell } = require('electron');
const { spawn } = require('child_process');

function createMainUtils({ axios, CONFIG, fs, exec, BrowserWindow, dialog }) {
  if (!axios) throw new Error('createMainUtils: axios is required');
  if (!CONFIG) throw new Error('createMainUtils: CONFIG is required');
  if (!fs) throw new Error('createMainUtils: fs is required');
  if (!exec) throw new Error('createMainUtils: exec is required');
  if (!BrowserWindow) throw new Error('createMainUtils: BrowserWindow is required');
  if (!dialog) throw new Error('createMainUtils: dialog is required');

  return {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    formatAppName(bundleId) {
      if (!bundleId) return 'Unknown';
      const parts = bundleId.split('.');
      const name = parts[parts.length - 1];
      return name.charAt(0).toUpperCase() + name.slice(1);
    },

    async checkVirusTotal(fileHash) {
      if (!CONFIG.VIRUSTOTAL_API_KEY) {
        return null;
      }

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

    runCommand(command, options = {}) {
      const opts = options || {};
      const hasStreamHandlers =
        !!opts.stream ||
        typeof opts.onStdout === 'function' ||
        typeof opts.onStderr === 'function' ||
        typeof opts.onProgress === 'function';

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

      return new Promise((resolve, reject) => {
        let stdoutAll = '';
        let stderrAll = '';

        const child = spawn(command, { shell: true, windowsHide: true });

        child.stdout.on('data', (buf) => {
          const text = buf.toString();
          stdoutAll += text;
          if (typeof opts.onStdout === 'function') opts.onStdout(text);
          if (typeof opts.onProgress === 'function') opts.onProgress({ stream: 'stdout', text });
        });

        child.stderr.on('data', (buf) => {
          const text = buf.toString();
          stderrAll += text;
          if (typeof opts.onStderr === 'function') opts.onStderr(text);
          if (typeof opts.onProgress === 'function') opts.onProgress({ stream: 'stderr', text });
        });

        child.on('error', (err) => {
          console.error(`명령어 실패: ${command}\n${String((err && err.message) || err)}`);
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

    cleanDirectory(dirPath) {
      try {
        if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (e) {
        console.warn(`폴더 삭제 실패 (${dirPath}):`, e.message);
      }
    },

    formatBytes(bytes, decimals = 2) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    },

    async isMvtInstalled() {
      try {
        await this.runCommand('mvt-ios version');
        return true;
      } catch (e) {
        console.log(e);
        return false;
      }
    },

    async installMvtIfMissing(mainWindow) {
      if (await this.isMvtInstalled()) {
        console.log('✅ MVT 이미 설치되어 있음.');
        return true;
      }

      console.log('🔄 MVT 설치 시도 중...');
      const statusBox = new BrowserWindow({
        width: 400,
        height: 150,
        frame: false,
        parent: mainWindow || undefined,
        modal: !!mainWindow,
        show: false
      });

      statusBox.loadFile('loading.html');
      statusBox.once('ready-to-show', () => statusBox.show());

      try {
        await this.runCommand('pip3 install --upgrade pip setuptools wheel');
        await this.runCommand('pip3 install mvt --user');
        console.log('✅ MVT 설치 성공.');
        statusBox.close();
        return true;
      } catch (e) {
        statusBox.close();
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'MVT 설치 실패',
          message: `MVT 설치 중 오류가 발생했습니다. 수동 설치가 필요합니다. 오류: ${e.message}`
        });
        return false;
      }
    },

    async checkAndInstallPrerequisites(mainWindow) {
      let pythonInstalled = false;

      try {
        await this.runCommand('python --version');
        console.log('✅ Python 설치 확인 완료.');
        pythonInstalled = true;
      } catch (e) {
        try {
          await this.runCommand('python --version');
          console.log('✅ Python 설치 확인 완료.');
          pythonInstalled = true;
        } catch (_e) {
          console.log('❌ Python이 시스템에 설치되어 있지 않거나 PATH에 없습니다.');
        }
      }

      if (!pythonInstalled) {
        const dialogResult = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '필수 프로그램 설치 안내',
          message: 'MVT 분석을 위해 Python 3.9 이상이 필요합니다.\n\n[예]를 누르면 공식 다운로드 페이지로 이동합니다.',
          buttons: ['예 (설치 페이지 열기)', '아니오 (계속 진행)']
        });

        if (dialogResult.response === 0) {
          shell.openExternal('https://www.python.org/downloads/windows/');
        }
        return false;
      }

      return await this.installMvtIfMissing(mainWindow);
    }
  };
}

module.exports = { createMainUtils };
