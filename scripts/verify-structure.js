#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function check(condition, message, { level = 'error' } = {}) {
  return { ok: !!condition, level, message };
}

function collectResults() {
  const results = [];
  const packageJson = readJson(path.join(rootDir, 'package.json'));

  results.push(check(exists('main.js'), 'main entry exists: main.js'));
  results.push(check(packageJson.main === 'main.js', 'package.json main points to main.js'));
  results.push(check(exists('src/main/bootstrap.js'), 'bootstrap entry exists: src/main/bootstrap.js'));
  results.push(check(exists('preload.js'), 'runtime preload exists: preload.js'));
  results.push(check(!exists('src/preload/preload.js'), 'duplicate preload implementation removed', { level: 'warn' }));
  results.push(check(exists('renderer.js'), 'renderer entry exists: renderer.js'));
  results.push(check(exists('index.html'), 'index.html exists'));
  results.push(check(exists('loading.html'), 'loading.html exists for prerequisite modal'));

  const mainSource = read('main.js');
  results.push(check(mainSource.includes("require('./src/main/bootstrap')"), 'main.js delegates to src/main/bootstrap.js'));

  const createWindowSource = read('src/main/window/createMainWindow.js');
  results.push(check(createWindowSource.includes("preload: path.join(baseDir, 'preload.js')"), 'main window uses root preload.js as runtime preload'));

  const rootPreloadSource = read('preload.js');
  results.push(check(rootPreloadSource.includes('contextBridge.exposeInMainWorld'), 'root preload exposes renderer bridge'));

  const scripts = packageJson.scripts || {};
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const usesReactScripts = Object.values(scripts).some((value) => String(value).includes('react-scripts'));

  if (usesReactScripts) {
    results.push(check(!!deps['react-scripts'], 'react-scripts is declared when referenced by package scripts'));
  }

  const extraResources = packageJson.build && Array.isArray(packageJson.build.extraResources)
    ? packageJson.build.extraResources
    : [];

  for (const resource of extraResources) {
    if (!resource || !resource.from) continue;
    const relativePath = String(resource.from).replace(/[\\/]+$/, '');
    results.push(check(exists(relativePath), `extraResource exists: ${relativePath}`));
  }

  const legacyCandidates = [
    'index.js',
    'src/preload/preload.js',
    'src/renderer/features/scan/model/scanController.js',
    'src/renderer/screens/login-screen/index.js',
    'src/renderer/screens/support-screen/index.js',
    'src/renderer/screens/scan-results-screen/index.js',
    'src/renderer/screens/scan-progress-screen/index.js',
    'src/renderer/screens/scan-dashboard-screen/index.js',
  ];

  for (const relativePath of legacyCandidates) {
    if (exists(relativePath)) {
      results.push(check(false, `legacy candidate present: ${relativePath}`, { level: 'warn' }));
    }
  }

  return results;
}

function printResults(results) {
  const errors = results.filter((item) => item.level === 'error' && !item.ok);
  const warnings = results.filter((item) => item.level === 'warn' && !item.ok);
  const passes = results.filter((item) => item.ok && item.level === 'error');

  console.log('Structure verification');
  console.log('');

  for (const item of passes) {
    console.log(`[PASS] ${item.message}`);
  }

  for (const item of warnings) {
    console.log(`[WARN] ${item.message}`);
  }

  for (const item of errors) {
    console.log(`[FAIL] ${item.message}`);
  }

  console.log('');
  console.log(`Summary: ${passes.length} pass, ${warnings.length} warn, ${errors.length} fail`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

printResults(collectResults());
