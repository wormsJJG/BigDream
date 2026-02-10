/**
 * src/main/services/loginStorage.js
 *
 * Single responsibility: persist/load login info.
 *
 * Behavior:
 * - If remember=true and safeStorage encryption is available => store encrypted safePw (base64)
 * - Otherwise store plain pw
 * - Backward compatible with legacy { safePw } only payload
 */

function createLoginStorage({ configPath, safeStorage, fs }) {
  if (!configPath) throw new Error('loginStorage: configPath is required');
  if (!safeStorage) throw new Error('loginStorage: safeStorage is required');
  if (!fs) throw new Error('loginStorage: fs is required');

  function save({ id, pw, remember }) {
    const data = {
      id: String(id ?? ''),
      remember: Boolean(remember),
    };

    if (data.remember) {
      const plainPw = String(pw ?? '');
      if (safeStorage.isEncryptionAvailable()) {
        data.isEncrypted = true;
        data.safePw = safeStorage.encryptString(plainPw).toString('base64');
      } else {
        data.isEncrypted = false;
        data.pw = plainPw;
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(data));
    return { success: true };
  }

  function load() {
    try {
      if (!fs.existsSync(configPath)) {
        return { remember: false, id: '', pw: '' };
      }

      const fileContent = fs.readFileSync(configPath, 'utf8');
      if (!fileContent) return { remember: false, id: '', pw: '' };

      const data = JSON.parse(fileContent);

      const remember = Boolean(data.remember);
      const id = String(data.id ?? '');
      let pw = '';

      if (remember) {
        // 1) encrypted
        if (data.isEncrypted && data.safePw && safeStorage.isEncryptionAvailable()) {
          try {
            const buffer = Buffer.from(String(data.safePw), 'base64');
            pw = safeStorage.decryptString(buffer);
          } catch (_e) {
            pw = '';
          }
        }
        // 2) plain
        else if (typeof data.pw === 'string') {
          pw = data.pw;
        }
        // 3) legacy: safePw only
        else if (data.safePw && safeStorage.isEncryptionAvailable()) {
          try {
            const buffer = Buffer.from(String(data.safePw), 'base64');
            pw = safeStorage.decryptString(buffer);
          } catch (_e) {
            pw = '';
          }
        }
      }

      return { remember, id, pw };
    } catch (error) {
      // Keep callers safe: never throw from load.
      return { remember: false, id: '', pw: '' };
    }
  }

  return { save, load };
}

module.exports = { createLoginStorage };
