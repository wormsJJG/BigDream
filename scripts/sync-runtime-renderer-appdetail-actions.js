const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const previewRoot = path.join(rootDir, '.ts-build-preview', 'src', 'renderer', 'features');
const runtimeRoot = path.join(rootDir, 'src', 'renderer', 'features');

const targets = [
  {
    label: 'renderer feature app-detail init',
    preview: path.join(previewRoot, 'app-detail', 'initAppDetail.js'),
    runtime: path.join(runtimeRoot, 'app-detail', 'initAppDetail.js'),
    markers: ['initAppDetail', '../../shared/utils.actual.js', 'appDetailManager'],
    header: '// Synced from TypeScript preview output. Source of truth: initAppDetail.ts\n'
  },
  {
    label: 'renderer feature actions init',
    preview: path.join(previewRoot, 'actions', 'initActionHandlers.js'),
    runtime: path.join(runtimeRoot, 'actions', 'initActionHandlers.js'),
    markers: ['initActionHandlers', 'createAdminActionHandlers', 'bindReportPrinting'],
    header: '// Synced from TypeScript preview output. Source of truth: initActionHandlers.ts\n'
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
