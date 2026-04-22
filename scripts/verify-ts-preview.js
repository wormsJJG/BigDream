const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const previewRoot = path.join(rootDir, '.ts-build-preview');

const checks = [
  {
    label: 'preview contract exists',
    file: path.join(previewRoot, 'src', 'shared', 'contracts', 'scanResultContract.js'),
    validate(content) {
      return content.includes('DEVICE_MODES') && content.includes('LEGACY_RUNTIME_FIELDS');
    }
  },
  {
    label: 'preview ipc exists',
    file: path.join(previewRoot, 'src', 'shared', 'ipc', 'ipcChannels.js'),
    validate(content) {
      return content.includes('firebase-auth-login') && content.includes('perform-device-security-action');
    }
  },
  {
    label: 'preview shared auth service exists',
    file: path.join(previewRoot, 'src', 'shared', 'services', 'authService.js'),
    validate(content) {
      return content.includes('createAuthService') && content.includes('AUTH_IPC_NOT_AVAILABLE');
    }
  },
  {
    label: 'preview shared firestore service exists',
    file: path.join(previewRoot, 'src', 'shared', 'services', 'firestoreService.js'),
    validate(content) {
      return content.includes('createFirestoreService') && content.includes('startAfter');
    }
  },
  {
    label: 'preview shared user settings service exists',
    file: path.join(previewRoot, 'src', 'shared', 'services', 'userSettingsService.js'),
    validate(content) {
      return content.includes('checkUserRole') && content.includes('fetchUserInfoAndSettings');
    }
  }
];

let pass = 0;
let fail = 0;

console.log('TypeScript preview verification\n');

for (const check of checks) {
  try {
    if (!fs.existsSync(check.file)) {
      console.log(`[FAIL] ${check.label}: missing ${path.relative(rootDir, check.file)}`);
      fail += 1;
      continue;
    }

    const content = fs.readFileSync(check.file, 'utf8');
    if (!check.validate(content)) {
      console.log(`[FAIL] ${check.label}: content check failed`);
      fail += 1;
      continue;
    }

    console.log(`[PASS] ${check.label}`);
    pass += 1;
  } catch (error) {
    console.log(`[FAIL] ${check.label}: ${error.message}`);
    fail += 1;
  }
}

console.log(`\nSummary: ${pass} pass, ${fail} fail`);

if (fail > 0) {
  process.exitCode = 1;
}
