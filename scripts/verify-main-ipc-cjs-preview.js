const fs = require('fs');
const path = require('path');

const root = process.cwd();
const previewDir = path.join(root, '.ts-build-preview-main-ipc', 'src', 'main', 'ipc');

const targets = [
  'authHandlers.js',
  'firestoreHandlers.js',
  'iosHandlers.js',
  'appHandlers.js',
  'androidHandlers.js'
];

const failures = [];

for (const fileName of targets) {
  const filePath = path.join(previewDir, fileName);
  if (!fs.existsSync(filePath)) {
    failures.push(`[FAIL] missing preview output: ${path.relative(root, filePath)}`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (/^\s*import\s.+from\s+['"][^'"]+['"];?/m.test(content) || /^\s*export\s+/m.test(content)) {
    failures.push(`[FAIL] preview output still contains ESM syntax: ${path.relative(root, filePath)}`);
  }
  if (!/module\.exports|exports\./.test(content)) {
    failures.push(`[FAIL] preview output is not obviously CJS-shaped: ${path.relative(root, filePath)}`);
  }
}

console.log('Main IPC CJS preview verification');
console.log('');

if (failures.length === 0) {
  console.log(`[PASS] ${targets.length} IPC preview files are CJS-safe`);
  process.exit(0);
}

for (const failure of failures) {
  console.log(failure);
}

console.log('');
console.log(`Summary: 0 pass, ${failures.length} fail`);
process.exit(1);
