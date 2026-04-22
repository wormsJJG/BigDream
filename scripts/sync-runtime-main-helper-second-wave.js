const fs = require('fs');
const path = require('path');

const root = process.cwd();
const previewRoot = path.join(root, '.ts-build-preview', 'src', 'main', 'services');
const runtimeRoot = path.join(root, 'src', 'main', 'services');

const targets = [
    'iosBackupCache.js',
    'androidScanAnalysis.js'
];

for (const fileName of targets) {
    const from = path.join(previewRoot, fileName);
    const to = path.join(runtimeRoot, fileName);

    if (!fs.existsSync(from)) {
        throw new Error(`Preview output not found: ${from}`);
    }

    fs.copyFileSync(from, to);
    console.log(`synced ${fileName}`);
}

