const fs = require('fs');
const path = require('path');

const root = process.cwd();
const previewRoot = path.join(root, '.ts-build-preview');

const targets = [
  'src/renderer/features/scan/deviceSecurityStatus.js',
  'src/renderer/features/scan/resultPanels.js',
  'src/renderer/features/scan/appCollections.js',
  'src/renderer/features/scan/iosInstalledApps.js',
  'src/renderer/features/scan/iosCoreAreas.js',
  'src/renderer/features/scan/androidAppListController.js'
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
console.log(`[ts-sync] renderer scan medium synced ${synced.length} files`);
synced.forEach((file) => console.log(` - ${file}`));
