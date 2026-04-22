const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const previewRoot = path.join(rootDir, '.ts-build-preview', 'src', 'shared');
const runtimeRoot = path.join(rootDir, 'src', 'shared');

const targets = [
  {
    label: 'shared contract',
    preview: path.join(previewRoot, 'contracts', 'scanResultContract.js'),
    runtime: path.join(runtimeRoot, 'contracts', 'scanResultContract.js'),
    markers: ['DEVICE_MODES', 'LEGACY_RUNTIME_FIELDS'],
    header: '// Synced from TypeScript preview output. Source of truth: scanResultContract.ts\n'
  },
  {
    label: 'shared ipc',
    preview: path.join(previewRoot, 'ipc', 'ipcChannels.js'),
    runtime: path.join(runtimeRoot, 'ipc', 'ipcChannels.js'),
    markers: ['firebase-auth-login', 'perform-device-security-action'],
    header: '// Synced from TypeScript preview output. Source of truth: ipcChannels.ts\n'
  },
  {
    label: 'shared auth service',
    preview: path.join(previewRoot, 'services', 'authService.js'),
    runtime: path.join(runtimeRoot, 'services', 'authService.js'),
    markers: ['createAuthService', 'AUTH_IPC_NOT_AVAILABLE'],
    header: '// Synced from TypeScript preview output. Source of truth: authService.ts\n'
  },
  {
    label: 'shared firestore service',
    preview: path.join(previewRoot, 'services', 'firestoreService.js'),
    runtime: path.join(runtimeRoot, 'services', 'firestoreService.js'),
    markers: ['createFirestoreService', 'startAfter'],
    header: '// Synced from TypeScript preview output. Source of truth: firestoreService.ts\n'
  },
  {
    label: 'shared user settings service',
    preview: path.join(previewRoot, 'services', 'userSettingsService.js'),
    runtime: path.join(runtimeRoot, 'services', 'userSettingsService.js'),
    markers: ['checkUserRole', 'fetchUserInfoAndSettings'],
    header: '// Synced from TypeScript preview output. Source of truth: userSettingsService.ts\n'
  }
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const target of targets) {
  if (!fs.existsSync(target.preview)) {
    fail(`missing preview file for ${target.label}: ${path.relative(rootDir, target.preview)}`);
  }

  const content = fs.readFileSync(target.preview, 'utf8');
  for (const marker of target.markers) {
    if (!content.includes(marker)) {
      fail(`preview file for ${target.label} failed validation: missing "${marker}"`);
    }
  }

  fs.writeFileSync(target.runtime, `${target.header}${content}`, 'utf8');
  console.log(`synced ${path.relative(rootDir, target.runtime)}`);
}
