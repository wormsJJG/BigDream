const fs = require('fs');
const path = require('path');

const root = process.cwd();

const targets = [
    path.join(root, 'src', 'main', 'services'),
    path.join(root, 'src', 'renderer', 'features', 'scan')
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

const failures = [];
const scanned = [];

for (const dirPath of targets) {
    for (const filePath of getJsFiles(dirPath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        scanned.push(filePath);

        const hasSuspiciousPattern = suspiciousPatterns.some((pattern) => pattern.test(content));
        if (!hasSuspiciousPattern) continue;

        if (isSelfWrapper(filePath, content)) {
            failures.push(filePath);
        }
    }
}

console.log('Runtime sync safety verification');
console.log('');

if (failures.length === 0) {
    console.log(`[PASS] scanned ${scanned.length} runtime JS files, 0 self-wrapper regressions`);
    process.exit(0);
}

for (const filePath of failures) {
    console.log(`[FAIL] self-wrapper runtime JS detected: ${path.relative(root, filePath)}`);
}

console.log('');
console.log(`Summary: 0 pass, ${failures.length} fail`);
process.exit(1);
