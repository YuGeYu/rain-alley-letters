const { spawn } = require('node:child_process');
const path = require('node:path');

const executable = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
const app = spawn(executable, ['.'], {
  cwd: __dirname,
  stdio: 'inherit',
  windowsHide: false,
  shell: false,
  env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: path.dirname(executable) }
});

app.once('error', (error) => {
  console.error('无法启动 Electron：', error.message);
  process.exitCode = 1;
});
app.once('exit', (code, signal) => {
  if (signal) console.error(`Electron 已被系统信号终止：${signal}`);
  process.exitCode = code ?? 1;
});
