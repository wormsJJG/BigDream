const fs = require('fs');
const path = require('path');

const root = process.cwd();
const previewRoot = path.join(root, '.ts-build-preview');
const target = 'src/renderer/features/scan/resultsRenderer.js';

const previewPath = path.join(previewRoot, target);
const runtimePath = path.join(root, target);

if (!fs.existsSync(previewPath)) {
  throw new Error(`Preview output not found: ${target}`);
}

const content = fs.readFileSync(previewPath, 'utf8');
fs.writeFileSync(runtimePath, content, 'utf8');

console.log('[ts-sync] renderer scan resultsRenderer synced 1 file');
console.log(` - ${target}`);
