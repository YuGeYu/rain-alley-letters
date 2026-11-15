const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync('python', [path.join(__dirname, 'prepare-bilidesk.py')], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
