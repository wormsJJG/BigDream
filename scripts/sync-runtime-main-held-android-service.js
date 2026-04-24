const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const previewBase = path.join(rootDir, '.ts-build-preview', 'src', 'main', 'services');
const runtimeBase = path.join(rootDir, 'src', 'main', 'services');

const targets = ['androidService.js'];

for (const fileName of targets) {
  const previewPath = path.join(previewBase, fileName);
  const runtimePath = path.join(runtimeBase, fileName);

  if (!fs.existsSync(previewPath)) {
    throw new Error(`Preview output missing: ${previewPath}`);
  }

  fs.copyFileSync(previewPath, runtimePath);
  console.log(`[SYNC] ${fileName}`);
}

console.log('[DONE] main held android service synced');
