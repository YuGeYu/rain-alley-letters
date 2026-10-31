const fs = require('node:fs/promises');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const folder = () => path.join(app.getPath('home'), '.rain-alley-developer');
const vaultPath = () => path.join(folder(), 'account.enc');
// Windows CurrentUser DPAPI survives app packaging and Chromium profile changes.
// Secrets travel through stdin only, never command-line arguments or logs.
async function protectWindows(bytes, decrypt = false) {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $e=[Text.Encoding]::UTF8.GetBytes('RainAlleyDeveloper/v1'); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-NonInteractive','-Command',script], {windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output=''; child.stdout.on('data',chunk=>output+=chunk); child.stderr.resume();
    child.on('error',()=>reject(new Error('Windows 凭据保护服务无法启动。')));
    child.on('close',code=>code===0 ? resolve(Buffer.from(output.trim(),'base64')) : reject(new Error('Windows 凭据保护服务未能完成操作。')));
    child.stdin.on('error',()=>{});child.stdin.end(bytes.toString('base64'));
  });
}
async function read() {
  try {
    const bytes = await fs.readFile(vaultPath());
    let plain;
    if (bytes[0] === 123) {
      const envelope = JSON.parse(bytes.toString('utf8'));
      if (envelope.version !== 1 || envelope.provider !== 'windows-dpapi') throw new Error('INVALID_VAULT');
      plain = (await protectWindows(Buffer.from(envelope.ciphertext,'base64'), true)).toString('utf8');
    } else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE');
      plain = safeStorage.decryptString(bytes);
    }
    const data = JSON.parse(plain);
    if (typeof data.username !== 'string' || typeof data.password !== 'string') throw new Error('INVALID_VAULT');
    return data;
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw new Error('本机主理人凭据无法解密，请使用原 Windows 用户或手动登录。');
  }
}
async function write(data) {
  if (process.platform !== 'win32' && !safeStorage.isEncryptionAvailable()) throw new Error('加密服务暂不可用，主理人凭据尚未保存。');
  await fs.mkdir(folder(), { recursive: true });
  if (process.platform === 'win32') {
    const who = await promisify(execFile)('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = who.stdout.match(/S-1-5-[0-9-]+/)?.[0];
    if (!sid) throw new Error('无法确定 Windows 用户，恢复资料尚未保存。');
    await promisify(execFile)('icacls.exe', [folder(), '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true });
  }
  const temporary = vaultPath() + '.' + process.pid + '.tmp';
  const plain = JSON.stringify(data);
  const encrypted = process.platform === 'win32' ? Buffer.from(JSON.stringify({version:1,provider:'windows-dpapi',ciphertext:(await protectWindows(Buffer.from(plain))).toString('base64')})) : safeStorage.encryptString(plain);
  await fs.writeFile(temporary, encrypted, { mode: 0o600 });
  await fs.rename(temporary, vaultPath());
  // Human-readable recovery is intentionally kept outside source/releases,
  // under an ACL limited to the current Windows account. Never log its contents.
  const recovery = `雨巷来信 · 主理人恢复资料（含密码，请勿分享）\n账号：${data.username}\n密码：${data.password}\n本机入口：登录页「使用本机保存的主理人账号」。\n更换 Windows 用户或设备时，可使用这里的账号和密码手动登录。\n`;
  await fs.writeFile(path.join(folder(), '恢复资料.txt'), recovery, { encoding: 'utf8', mode: 0o600 });
}
// Independent of disposable Chromium/app data; never copied into a release.
module.exports = { read, write, folder, vaultPath };
