const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const previewRoot = path.join(rootDir, '.ts-build-preview', 'src', 'renderer', 'app');
const runtimeRoot = path.join(rootDir, 'src', 'renderer', 'app');

const targets = [
  {
    label: 'renderer app screen paths',
    preview: path.join(previewRoot, 'screenPaths.js'),
    runtime: path.join(runtimeRoot, 'screenPaths.js'),
    markers: ['SCREEN_IDS', 'getScreenTemplateCandidates'],
    header: '// Synced from TypeScript preview output. Source of truth: screenPaths.ts\n'
  },
  {
    label: 'renderer app template loader',
    preview: path.join(previewRoot, 'templateLoader.js'),
    runtime: path.join(runtimeRoot, 'templateLoader.js'),
    markers: ['screenPaths.js', 'loadTemplates'],
    header: '// Synced from TypeScript preview output. Source of truth: templateLoader.ts\n'
  },
  {
    label: 'renderer app view manager',
    preview: path.join(previewRoot, 'viewManager.js'),
    runtime: path.join(runtimeRoot, 'viewManager.js'),
    markers: ['createViewManager', 'updateIosStageProgress', 'updateProgress'],
    header: '// Synced from TypeScript preview output. Source of truth: viewManager.ts\n'
  }
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const target of targets) {
  if (!fs.existsSync(target.preview)) {
    fail(`missing preview file for ${target.label}: ${path.relative(rootDir, target.preview)}`);
  }

  const content = fs.readFileSync(target.preview, 'utf8');
  for (const marker of target.markers) {
    if (!content.includes(marker)) {
      fail(`preview file for ${target.label} failed validation: missing "${marker}"`);
    }
  }

  fs.writeFileSync(target.runtime, `${target.header}${content}`, 'utf8');
  console.log(`synced ${path.relative(rootDir, target.runtime)}`);
}
