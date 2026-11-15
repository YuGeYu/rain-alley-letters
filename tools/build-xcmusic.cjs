const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cwd = path.join(root, 'vendor/XCMusic');
const env = { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: path.join(root, 'node_modules/electron/dist') };
const result = spawnSync(process.execPath, ['node_modules/@vue/cli-service/bin/vue-cli-service.js', 'electron:build', '--dir', '--win', '--x64'], { cwd, env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status || 0;
