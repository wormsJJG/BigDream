const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const previewWindowBase = path.join(rootDir, '.ts-build-preview', 'src', 'main', 'window');
const previewUpdaterBase = path.join(rootDir, '.ts-build-preview', 'src', 'main', 'updater');
const runtimeWindowBase = path.join(rootDir, 'src', 'main', 'window');
const runtimeUpdaterBase = path.join(rootDir, 'src', 'main', 'updater');

const targets = [
  {
    previewPath: path.join(previewWindowBase, 'createMainWindow.js'),
    runtimePath: path.join(runtimeWindowBase, 'createMainWindow.js'),
    label: 'createMainWindow.js',
  },
  {
    previewPath: path.join(previewUpdaterBase, 'initializeAutoUpdater.js'),
    runtimePath: path.join(runtimeUpdaterBase, 'initializeAutoUpdater.js'),
    label: 'initializeAutoUpdater.js',
  },
];

for (const target of targets) {
  if (!fs.existsSync(target.previewPath)) {
    throw new Error(`Preview output missing: ${target.previewPath}`);
  }

  fs.copyFileSync(target.previewPath, target.runtimePath);
  console.log(`[SYNC] ${target.label}`);
}

console.log('[DONE] main shell light wave synced');
