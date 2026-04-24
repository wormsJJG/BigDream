const fs = require('fs');
const path = require('path');

const root = process.cwd();
const previewPath = path.join(root, '.ts-build-preview-main-bootstrap', 'src', 'main', 'bootstrap.js');
const runtimePath = path.join(root, 'src', 'main', 'bootstrap.js');

const requiredSnippets = [
  "./window/createMainWindow",
  "./config/createConfig",
  "./updater/initializeAutoUpdater",
  "./services/createMainUtils",
  "./services/loginStorage",
  "./services/firestoreService",
  "./services/androidService",
  "./services/iosService",
  "./ipc/authHandlers",
  "./ipc/firestoreHandlers",
  "./ipc/androidHandlers",
  "./ipc/iosHandlers",
  "./ipc/appHandlers",
  "./testing/mockData"
];

const failures = [];

if (!fs.existsSync(previewPath)) {
  failures.push(`[FAIL] missing preview output: ${path.relative(root, previewPath)}`);
} else {
  const preview = fs.readFileSync(previewPath, 'utf8');
  if (/^\s*import\s.+from\s+['"][^'"]+['"];?/m.test(preview) || /^\s*export\s+/m.test(preview)) {
    failures.push(`[FAIL] preview output still contains ESM syntax: ${path.relative(root, previewPath)}`);
  }
  if (!/module\.exports|exports\./.test(preview)) {
    failures.push(`[FAIL] preview output is not obviously CJS-shaped: ${path.relative(root, previewPath)}`);
  }
  if (!/function start\(\{ rootDir \}\)|const start = \(\{ rootDir \}\)/.test(preview)) {
    failures.push(`[FAIL] preview output does not contain start(...) wiring: ${path.relative(root, previewPath)}`);
  }

  for (const snippet of requiredSnippets) {
    if (!preview.includes(snippet)) {
      failures.push(`[FAIL] preview output is missing bootstrap dependency: ${snippet}`);
    }
  }
}

if (fs.existsSync(runtimePath) && fs.existsSync(previewPath)) {
  const runtime = fs.readFileSync(runtimePath, 'utf8');
  const preview = fs.readFileSync(previewPath, 'utf8');
  const runtimeRequires = (runtime.match(/require\(['"][^'"]+['"]\)/g) || []).length;
  const previewRequires = (preview.match(/require\(['"][^'"]+['"]\)/g) || []).length;
  if (previewRequires < runtimeRequires - 2) {
    failures.push('[FAIL] preview output appears to be missing too many require(...) edges compared to runtime bootstrap');
  }
}

console.log('Main bootstrap CJS preview verification');
console.log('');

if (failures.length === 0) {
  console.log('[PASS] bootstrap preview output is CJS-safe and wiring-complete');
  process.exit(0);
}

for (const failure of failures) {
  console.log(failure);
}

console.log('');
console.log(`Summary: 0 pass, ${failures.length} fail`);
process.exit(1);
