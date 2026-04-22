const fs = require('fs');
const path = require('path');

const root = process.cwd();
const previewRoot = path.join(root, '.ts-build-preview');

const targets = [
  'src/renderer/features/scan/androidScanProgress.js',
  'src/renderer/features/scan/iosScanProgress.js',
  'src/renderer/features/scan/scanLifecycle.js',
  'src/renderer/features/scan/scanLogQuota.js',
  'src/renderer/features/scan/scanPostActions.js',
  'src/renderer/features/scan/scanStartUi.js',
  'src/renderer/features/scan/iosScanProgressBinding.js',
  'src/renderer/features/scan/androidScanRunner.js',
  'src/renderer/features/scan/iosScanRunner.js',
  'src/renderer/features/scan/scanDeviceRuntime.js',
  'src/renderer/features/scan/scanLogSession.js',
  'src/renderer/features/scan/scanEntryBindings.js',
  'src/renderer/features/scan/scanLayoutRuntime.js',
  'src/renderer/features/scan/scanMenuLifecycle.js',
  'src/renderer/features/scan/scanBootstrapHelpers.js'
];

function syncFile(relPath) {
  const previewPath = path.join(previewRoot, relPath);
  const runtimePath = path.join(root, relPath);

  if (!fs.existsSync(previewPath)) {
    throw new Error(`Preview output not found: ${relPath}`);
  }

  const content = fs.readFileSync(previewPath, 'utf8');
  fs.writeFileSync(runtimePath, content, 'utf8');
  return relPath;
}

const synced = targets.map(syncFile);
console.log(`[ts-sync] renderer scan orchestration synced ${synced.length} files`);
synced.forEach((file) => console.log(` - ${file}`));
