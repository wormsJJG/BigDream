const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const previewConfigBase = path.join(rootDir, '.ts-build-preview', 'src', 'main', 'config');
const previewServicesBase = path.join(rootDir, '.ts-build-preview', 'src', 'main', 'services');
const runtimeConfigBase = path.join(rootDir, 'src', 'main', 'config');
const runtimeServicesBase = path.join(rootDir, 'src', 'main', 'services');

const targets = [
  {
    previewPath: path.join(previewConfigBase, 'createConfig.js'),
    runtimePath: path.join(runtimeConfigBase, 'createConfig.js'),
    label: 'createConfig.js',
  },
  {
    previewPath: path.join(previewServicesBase, 'createMainUtils.js'),
    runtimePath: path.join(runtimeServicesBase, 'createMainUtils.js'),
    label: 'createMainUtils.js',
  },
];

for (const target of targets) {
  if (!fs.existsSync(target.previewPath)) {
    throw new Error(`Preview output missing: ${target.previewPath}`);
  }

  fs.copyFileSync(target.previewPath, target.runtimePath);
  console.log(`[SYNC] ${target.label}`);
}

console.log('[DONE] main core light wave synced');
