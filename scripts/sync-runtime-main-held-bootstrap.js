const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const previewPath = path.join(rootDir, '.ts-build-preview-main-bootstrap', 'src', 'main', 'bootstrap.js');
const runtimePath = path.join(rootDir, 'src', 'main', 'bootstrap.js');

if (!fs.existsSync(previewPath)) {
  throw new Error(`Preview output missing: ${previewPath}`);
}

fs.copyFileSync(previewPath, runtimePath);
console.log('[SYNC] bootstrap.js');
console.log('[DONE] main held bootstrap synced');
