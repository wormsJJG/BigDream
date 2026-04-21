const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const electronInstall = path.join(rootDir, 'node_modules', 'electron', 'install.js');

process.env.npm_config_cache = process.env.npm_config_cache || path.join(rootDir, '.npm-cache');
process.env.electron_config_cache = process.env.electron_config_cache || path.join(rootDir, '.electron-cache');

const result = spawnSync(process.execPath, [electronInstall], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
