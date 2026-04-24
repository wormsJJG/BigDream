const fs = require('fs');
const path = require('path');

const root = process.cwd();

const selfWrapperTargets = [
    path.join(root, 'src', 'main', 'services'),
    path.join(root, 'src', 'renderer', 'features', 'scan')
];

const cjsRuntimeTargets = [
    path.join(root, 'src', 'main', 'services'),
    path.join(root, 'src', 'main', 'config'),
    path.join(root, 'src', 'main', 'window'),
    path.join(root, 'src', 'main', 'updater'),
    path.join(root, 'src', 'main', 'ipc'),
    path.join(root, 'src', 'shared', 'ipc')
];

const requireUnsafeEsmTargets = [
    path.join(root, 'src', 'main', 'services'),
    path.join(root, 'src', 'main', 'config'),
    path.join(root, 'src', 'main', 'window'),
    path.join(root, 'src', 'main', 'updater'),
    path.join(root, 'src', 'shared', 'ipc')
];

const suspiciousPatterns = [
    /import\s+\{\s*([A-Za-z0-9_$]+)\s+as\s+\1Js\s*\}\s+from\s+['"]\.\/([^'"]+)\.js['"];?/,
    /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*\1Js\b/,
];

function getJsFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.join(dirPath, name));
}

function isSelfWrapper(filePath, content) {
    const baseName = path.basename(filePath, '.js');
    const importMatch = content.match(/import\s+\{\s*([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)\s*\}\s+from\s+['"]\.\/([^'"]+)\.js['"];?/);
    if (!importMatch) return false;

    const importedName = importMatch[1];
    const aliasName = importMatch[2];
    const importedFile = importMatch[3];

    if (importedFile !== baseName) return false;
    if (!new RegExp(`export\\s+const\\s+${importedName}\\s*=\\s*${aliasName}\\b`).test(content)) return false;

    return true;
}

const selfWrapperFailures = [];
const cjsEsmFailures = [];
const requireUnsafeEsmFailures = [];
const scanned = [];

for (const dirPath of selfWrapperTargets) {
    for (const filePath of getJsFiles(dirPath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        scanned.push(filePath);

        const hasSuspiciousPattern = suspiciousPatterns.some((pattern) => pattern.test(content));
        if (!hasSuspiciousPattern) continue;

        if (isSelfWrapper(filePath, content)) {
            selfWrapperFailures.push(filePath);
        }
    }
}

for (const dirPath of cjsRuntimeTargets) {
    for (const filePath of getJsFiles(dirPath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (/^\s*import\s.+from\s+['"][^'"]+['"];?/m.test(content) || /^\s*export\s+/m.test(content)) {
            cjsEsmFailures.push(filePath);
        }
    }
}

for (const dirPath of requireUnsafeEsmTargets) {
    for (const filePath of getJsFiles(dirPath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const hasEsmSyntax = /^\s*import\s.+from\s+['"][^'"]+['"];?/m.test(content) || /^\s*export\s+/m.test(content);
        const hasRequireCall = /\brequire\(/.test(content);
        if (hasEsmSyntax && hasRequireCall) {
            requireUnsafeEsmFailures.push(filePath);
        }
    }
}

console.log('Runtime sync safety verification');
console.log('');

if (selfWrapperFailures.length === 0 && cjsEsmFailures.length === 0 && requireUnsafeEsmFailures.length === 0) {
    console.log(`[PASS] scanned ${scanned.length} runtime JS files, 0 self-wrapper regressions`);
    console.log('[PASS] main CJS runtime files contain 0 ESM syntax regressions');
    console.log('[PASS] main runtime JS files contain 0 ESM+require regressions');
    process.exit(0);
}

for (const filePath of selfWrapperFailures) {
    console.log(`[FAIL] self-wrapper runtime JS detected: ${path.relative(root, filePath)}`);
}

for (const filePath of cjsEsmFailures) {
    console.log(`[FAIL] ESM syntax detected in CJS runtime JS: ${path.relative(root, filePath)}`);
}

for (const filePath of requireUnsafeEsmFailures) {
    console.log(`[FAIL] ESM runtime JS contains require() and may break at runtime: ${path.relative(root, filePath)}`);
}

console.log('');
console.log(`Summary: 0 pass, ${selfWrapperFailures.length + cjsEsmFailures.length + requireUnsafeEsmFailures.length} fail`);
process.exit(1);
