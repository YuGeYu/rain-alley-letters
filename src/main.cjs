const developerVault = require('./developer-vault.cjs');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  safeStorage,
  shell,
  Notification,
  Tray,
  Menu,
  dialog,
  clipboard,
} = require('electron');
const crypto = require('node:crypto');
const { installOfficialPayload } = require('./cs2-installer.cjs');
const { inspectUninstall, uninstallPayload } = require('./cs2-uninstaller.cjs');
const { installInventory } = require('./inventory-installer.cjs');
const { externalProtocol } = require('./external-protocol.cjs');
const { spawn, spawnSync } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isPrivateNetworkHost } = require('./site-policy.cjs');
const { resolveNetdiskInput, providerFor, isSharePageUrl, isLinkSwiftAuthorizeUrl, isLinkSwiftOAuthPageUrl, PROVIDER_HOSTS } = require('./netdisk-resolver.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'rainalley', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

app.setAppUserModelId('cn.rainalley.letters');
app.setName('雨巷来信');
// The client is a static SVG/CSS workspace with no WebGL surface. Keeping
// Chromium's hardware compositor enabled only adds a GPU process and cache
// pressure on machines where this app should remain idle.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const USERNAME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
const NETDISK_PAGE_HOSTS = new Set([...PROVIDER_HOSTS]);
const NETDISK_API_HOSTS = new Set([
  'baidupcs.com', 'pcs.baidu.com', 'openapi.baidu.com', 'pan.baidu.com', 'yun.baidu.com', 'api.aliyundrive.com', 'personal-kd-njs.yun.139.com',
  'api.cloud.189.cn', 'api-pan.xunlei.com', 'drive-pc.quark.cn', 'pc-api.uc.cn', 'www.123pan.com',
  'login.123pan.com', 'aliyundrive.com', 'aliyundrive.net', 'alipan.com', 'alicloudccp.com', 'aliyundrive.cloud', 'cmecloud.cn',
  '189.cn', 'xunlei.com', 'quark.cn', 'uc.cn', '123pan.com', '123pan.cn', '123684.com', '123865.com', '123952.com', '123912.com', 'cjjd19.com',
]);
const TRUSTED_SITE_HOSTS = new Set(['pig.600318.xyz', 'vault.600318.xyz', 'api.600318.xyz', 'www.bilibili.com', 'space.bilibili.com', 'player.bilibili.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', ...NETDISK_PAGE_HOSTS, ...NETDISK_API_HOSTS]);
const ACCOUNT_API_HOSTS = new Set(['auth.600318.xyz', 'rain-alley-auth.600318.workers.dev']);
const DEFAULT_STATE = Object.freeze({
  selectedFeature: 'street-postcard', installedFeatures: ['street-postcard'], muted: true, lightweight: false, theme: 'dark',
  favorites: [], history: [], navigationPolicy: 'allowlist', allowedHosts: [...TRUSTED_SITE_HOSTS], blockedHosts: [],
  allowHttp: false, allowLocalNetwork: false, allowPopups: false, downloadsEnabled: true, downloadBaseUrl: 'https://vault.600318.xyz/',
  downloadDirectory: '', allowedPermissions: [], closeToTray: true, webBookmarks: [],
});
let windowRef;
let trayRef;
let websiteView;
const websiteViews = new Map();
const websiteTabIds = new Set();
let activeWebsiteId = '';
const activeDownloads = new Map();
const downloadHistory = new Map();
const claimedDownloadPaths = new Set();
let suppressDownloadHistory = false;
let quitting = false;
let wasMaximized = false;
let authSession;
let appState;
let appStatePromise;
let appStateWriteQueue = Promise.resolve();
let apiBaseUrl = '';
let linkSwiftValues = {};
let linkSwiftValuesPromise;
const linkSwiftRequests = new Map();
const linkSwiftContents = new Map();
const linkSwiftAuthWindows = new Set();

function randomReadable(length, alphabet) {
  let result = '';
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  while (result.length < length) {
    for (const byte of crypto.randomBytes(Math.max(16, length - result.length))) {
      if (byte < limit) result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  }
  return result;
}

function apiUrl(route) {
  if (!apiBaseUrl) throw new Error('云端服务还没有部署。');
  return new URL(route, apiBaseUrl).toString();
}

async function requestApi(route, { method = 'GET', body, token } = {}) {
  let response;
  try {
    // Use Chromium's native resolver/proxy/certificate stack, matching the desktop
    // network path. Node's resolver may be intercepted separately on Windows.
    response = await net.fetch(apiUrl(route), {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch (cause) {
    throw new Error(cause?.name === 'TimeoutError' ? '连接超时，请检查网络后重试。' : '暂时无法连接账号服务，请检查网络后重试。');
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error('账号服务返回了无法识别的结果。'); }
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `请求失败（${response.status}）。`);
  return payload;
}

function statePath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function linkSwiftValuesPath() {
  return path.join(app.getPath('userData'), 'linkswift-values.enc');
}

async function loadLinkSwiftValues() {
  if (linkSwiftValuesPromise) return linkSwiftValuesPromise;
  linkSwiftValuesPromise = (async () => {
    if (!safeStorage.isEncryptionAvailable()) return linkSwiftValues;
    try {
      const encrypted = await fs.readFile(linkSwiftValuesPath(), 'utf8');
      const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) linkSwiftValues = parsed;
    } catch { /* first run, unavailable, or damaged encrypted settings use a clean store */ }
    return linkSwiftValues;
  })();
  return linkSwiftValuesPromise;
}

let linkSwiftWriteQueue = Promise.resolve();
function saveLinkSwiftValues() {
  if (!safeStorage.isEncryptionAvailable()) return Promise.resolve(false);
  const next = linkSwiftWriteQueue.then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(linkSwiftValues)).toString('base64');
    const temporary = `${linkSwiftValuesPath()}.${process.pid}.tmp`;
    await fs.writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, linkSwiftValuesPath());
    return true;
  });
  linkSwiftWriteQueue = next.catch(() => {});
  return next;
}

function linkSwiftEnabledFor(contents) {
  return Boolean(contents && linkSwiftContents.get(contents.id) === contents);
}

function abortLinkSwiftRequests(contents = null) {
  const prefix = contents ? `${contents.id}:` : null;
  for (const [key, controller] of linkSwiftRequests) {
    if (prefix && !key.startsWith(prefix)) continue;
    controller.abort();
    linkSwiftRequests.delete(key);
  }
  if (contents) {
    linkSwiftContents.delete(contents.id);
    if (!contents.isDestroyed()) contents.send('site:linkswift-disabled');
    return;
  }
  for (const active of linkSwiftContents.values()) if (!active.isDestroyed()) active.send('site:linkswift-disabled');
  linkSwiftContents.clear();
}

function enableLinkSwiftContents(contents) {
  if (!contents || contents.isDestroyed()) throw new Error('网盘页面已关闭。');
  linkSwiftContents.set(contents.id, contents);
  contents.send('site:linkswift-enabled');
}

function isBaiduAuthenticationUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (host === 'baidu.com' || host.endsWith('.baidu.com'));
  } catch { return false; }
}

function createLinkSwiftAuthorizationWindow(url, sourceContents) {
  if (!sourceContents || !linkSwiftEnabledFor(sourceContents) || !isLinkSwiftAuthorizeUrl(url)) throw new Error('LinkSwift 授权地址未通过校验。');
  const authWindow = new BrowserWindow({
    parent: windowRef,
    title: '百度网盘授权 · 雨巷来信',
    width: 720,
    height: 760,
    minWidth: 540,
    minHeight: 480,
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      partition: 'persist:rain-alley-sites',
      preload: path.join(__dirname, 'site-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  const contents = authWindow.webContents;
  linkSwiftAuthWindows.add(authWindow);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, nextUrl) => { if (!isBaiduAuthenticationUrl(nextUrl)) event.preventDefault(); });
  contents.on('will-redirect', (event, nextUrl) => { if (!isBaiduAuthenticationUrl(nextUrl)) event.preventDefault(); });
  contents.on('did-start-navigation', (_event, _nextUrl, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) abortLinkSwiftRequests(contents);
  });
  contents.on('did-finish-load', () => {
    let current;
    try { current = new URL(contents.getURL()); } catch { return; }
    if (!isLinkSwiftOAuthPageUrl(current)) return;
    const provider = providerFor(current);
    if (provider?.id !== 'baidu') return;
    injectLinkSwiftInto(contents, provider, { allowOAuthPage: true }).catch(() => {
      windowRef?.webContents.send('desktop:linkswift-auth-failed');
    });
  });
  authWindow.on('closed', () => {
    abortLinkSwiftRequests(contents);
    linkSwiftAuthWindows.delete(authWindow);
  });
  authWindow.loadURL(url.toString()).catch(() => {
    if (!authWindow.isDestroyed()) authWindow.close();
  });
  return authWindow;
}

async function loadAppState() {
  if (appState) return appState;
  if (appStatePromise) return appStatePromise;
  appStatePromise = (async () => {
    let saved = {};
    try {
      const value = JSON.parse(await fs.readFile(statePath(), 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
    } catch { /* first launch or damaged preferences fall back to safe defaults */ }
    const installed = Array.isArray(saved.installedFeatures)
      ? [...new Set(['street-postcard', ...saved.installedFeatures.filter((id) => typeof id === 'string' && id !== 'rain-alley' && /^[a-z0-9-]{2,40}$/.test(id))])]
      : [...DEFAULT_STATE.installedFeatures];
    appState = {
      selectedFeature: typeof saved.selectedFeature === 'string' && saved.selectedFeature !== 'rain-alley' && /^[a-z0-9-]{2,40}$/.test(saved.selectedFeature) ? saved.selectedFeature : DEFAULT_STATE.selectedFeature,
      installedFeatures: installed,
      muted: typeof saved.muted === 'boolean' ? saved.muted : DEFAULT_STATE.muted,
      lightweight: typeof saved.lightweight === 'boolean' ? saved.lightweight : DEFAULT_STATE.lightweight,
      theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : DEFAULT_STATE.theme,
      favorites: cleanFeatureIds(saved.favorites),
      history: cleanFeatureIds(saved.history).slice(0, 300),
      navigationPolicy: ['allowlist', 'blocklist', 'allow-all', 'deny-all'].includes(saved.navigationPolicy) ? saved.navigationPolicy : DEFAULT_STATE.navigationPolicy,
      allowedHosts: cleanHosts(saved.allowedHosts, TRUSTED_SITE_HOSTS),
      blockedHosts: cleanHosts(saved.blockedHosts, []),
      allowExternalProtocols: saved.allowExternalProtocols === true,
      allowHttp: saved.allowHttp === true, allowLocalNetwork: saved.allowLocalNetwork === true, allowPopups: saved.allowPopups === true, downloadsEnabled: saved.downloadsEnabled !== false,
      downloadBaseUrl: cleanOptionalHttpsUrl(saved.downloadBaseUrl, DEFAULT_STATE.downloadBaseUrl),
      downloadDirectory: typeof saved.downloadDirectory === 'string' && path.isAbsolute(saved.downloadDirectory) ? saved.downloadDirectory.slice(0, 1000) : '',
      cs2Archive: typeof saved.cs2Archive === 'string' && path.isAbsolute(saved.cs2Archive) ? saved.cs2Archive.slice(0, 1000) : '',
      celebrationAt: Number.isFinite(saved.celebrationAt) ? saved.celebrationAt : 0,
      cs2Directory: typeof saved.cs2Directory === 'string' && path.isAbsolute(saved.cs2Directory) ? saved.cs2Directory.slice(0, 1000) : '',
      allowedPermissions: cleanPermissions(saved.allowedPermissions), closeToTray: saved.closeToTray !== false,
      webBookmarks: cleanWebBookmarks(saved.webBookmarks),
    };
    return appState;
  })();
  return appStatePromise;
}

function saveAppState(input) {
  const next = appStateWriteQueue.then(() => writeAppState(input));
  appStateWriteQueue = next.catch(() => {});
  return next;
}

async function writeAppState(input) {
  const previous = await loadAppState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return previous;
  const next = {
    selectedFeature: typeof input.selectedFeature === 'string' && /^[a-z0-9-]{2,40}$/.test(input.selectedFeature) ? input.selectedFeature : previous.selectedFeature,
    installedFeatures: Array.isArray(input.installedFeatures)
      ? [...new Set(['street-postcard', ...input.installedFeatures.filter((id) => typeof id === 'string' && /^[a-z0-9-]{2,40}$/.test(id))])]
      : previous.installedFeatures,
    muted: typeof input.muted === 'boolean' ? input.muted : previous.muted,
    lightweight: typeof input.lightweight === 'boolean' ? input.lightweight : previous.lightweight,
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : previous.theme,
    favorites: Array.isArray(input.favorites) ? cleanFeatureIds(input.favorites) : previous.favorites,
    history: Array.isArray(input.history) ? cleanFeatureIds(input.history).slice(0, 300) : previous.history,
    navigationPolicy: ['allowlist', 'blocklist', 'allow-all', 'deny-all'].includes(input.navigationPolicy) ? input.navigationPolicy : previous.navigationPolicy,
    allowedHosts: Array.isArray(input.allowedHosts) ? cleanHosts(input.allowedHosts, []) : previous.allowedHosts,
    blockedHosts: Array.isArray(input.blockedHosts) ? cleanHosts(input.blockedHosts, []) : previous.blockedHosts,
    allowHttp: typeof input.allowHttp === 'boolean' ? input.allowHttp : previous.allowHttp,
    allowLocalNetwork: typeof input.allowLocalNetwork === 'boolean' ? input.allowLocalNetwork : previous.allowLocalNetwork,
    allowPopups: typeof input.allowPopups === 'boolean' ? input.allowPopups : previous.allowPopups,
    allowExternalProtocols: typeof input.allowExternalProtocols === 'boolean' ? input.allowExternalProtocols : previous.allowExternalProtocols,
    downloadsEnabled: typeof input.downloadsEnabled === 'boolean' ? input.downloadsEnabled : previous.downloadsEnabled,
    downloadBaseUrl: typeof input.downloadBaseUrl === 'string' ? cleanOptionalHttpsUrl(input.downloadBaseUrl, previous.downloadBaseUrl) : previous.downloadBaseUrl,
    downloadDirectory: typeof input.downloadDirectory === 'string' && path.isAbsolute(input.downloadDirectory) ? input.downloadDirectory.slice(0, 1000) : previous.downloadDirectory,
    cs2Archive: input.cs2Archive === '' ? '' : typeof input.cs2Archive === 'string' && path.isAbsolute(input.cs2Archive) ? input.cs2Archive.slice(0, 1000) : previous.cs2Archive,
    celebrationAt: Number.isFinite(input.celebrationAt) ? Math.max(previous.celebrationAt || 0, input.celebrationAt) : previous.celebrationAt,
    cs2Directory: typeof input.cs2Directory === 'string' && path.isAbsolute(input.cs2Directory) ? input.cs2Directory.slice(0, 1000) : previous.cs2Directory,
    allowedPermissions: Array.isArray(input.allowedPermissions) ? cleanPermissions(input.allowedPermissions) : previous.allowedPermissions,
    closeToTray: typeof input.closeToTray === 'boolean' ? input.closeToTray : previous.closeToTray,
    webBookmarks: Array.isArray(input.webBookmarks) ? cleanWebBookmarks(input.webBookmarks) : previous.webBookmarks,
  };
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  const temporary = `${statePath()}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, statePath());
  appState = next;
  return next;
}

function cleanFeatureIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((id) => typeof id === 'string' && /^[a-z0-9-]{2,40}$/.test(id)).slice(0, 600))];
}

function cleanHosts(values, fallback = []) {
  if (!Array.isArray(values)) return [...fallback];
  return [...new Set(values.map((host) => typeof host === 'string' ? host.trim().toLowerCase().replace(/^\.+|\.+$/g, '') : '')
    .filter((host) => host.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)).slice(0, 300))];
}

function cleanWebBookmarks(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const item of values.slice(0, 300)) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || item.url.length > 1200) continue;
    let url;
    try { url = new URL(item.url); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || isPrivateNetworkHost(url.hostname)) continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 160) : '';
    const hostname = url.hostname.toLowerCase();
    const createdAt = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now();
    const lastUsedAt = Number.isFinite(Number(item.lastUsedAt)) ? Number(item.lastUsedAt) : createdAt;
    result.push({ url: normalized, hostname, title: title || hostname, createdAt, lastUsedAt });
  }
  return result.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

function cleanPermissions(values) {
  const allowed = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']);
  return Array.isArray(values) ? [...new Set(values.filter((item) => allowed.has(item)))] : [];
}

function cleanOptionalHttpsUrl(value, fallback) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString().slice(0, 600) : fallback;
  } catch { return fallback; }
}

function siteAllowed(url, current = appState || DEFAULT_STATE) {
  if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' && current.allowHttp)) || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!current.allowLocalNetwork && isPrivateNetworkHost(host)) return false;
  if (current.blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return false;
  if (current.navigationPolicy === 'deny-all') return false;
  if (current.navigationPolicy === 'allow-all') return true;
  if (current.navigationPolicy === 'blocklist') return true;
  return current.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function persistSession(username, token, expiresAt, role = 'player') {
  let encryptedToken;
  if (safeStorage.isEncryptionAvailable()) encryptedToken = safeStorage.encryptString(token).toString('base64');
  const current = await loadAppState();
  const data = {
    username,
    expiresAt,
    ...(encryptedToken ? { encryptedToken } : {}),
  };
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const temporary = path.join(app.getPath('userData'), `session.${process.pid}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, path.join(app.getPath('userData'), 'session.json'));
  authSession = { username, token, expiresAt, role };
  return { username, role, installedFeatures: [...current.installedFeatures], preferences: { muted: current.muted, lightweight: current.lightweight, theme: current.theme, selectedFeature: current.selectedFeature } };
}

async function readPersistedSession() {
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'session.json'), 'utf8'));
    if (!saved?.username || !saved?.encryptedToken || !safeStorage.isEncryptionAvailable()) return null;
    const token = safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'));
    return { username: saved.username, token, expiresAt: saved.expiresAt };
  } catch { return null; }
}

async function clearPersistedSession() {
  authSession = null;
  try { await fs.unlink(path.join(app.getPath('userData'), 'session.json')); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
}

function ensureTrusted(event) {
  if (!windowRef || event.sender !== windowRef.webContents) throw new Error('不允许的桌面调用。');
}

async function createAccount() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const username = `YX${randomReadable(8, USERNAME_ALPHABET)}`;
    const password = randomReadable(20, PASSWORD_ALPHABET);
    try {
      const response = await requestApi('/api/register', { method: 'POST', body: { username, password } });
      const profile = await persistSession(response.account.username, response.session.token, response.session.expiresAt, response.account.role);
      return { username: response.account.username, password, profile };
    } catch (cause) {
      if (attempt < 5 && /已被使用/u.test(cause.message)) continue;
      throw cause;
    }
  }
  throw new Error('暂时无法生成新账号，请稍后重试。');
}

async function updateAccount(input) {
  if (!authSession?.token) throw new Error('登录后才能修改账号资料。');
  const response = await requestApi('/api/account', {
    method: 'PUT',
    body: {
      currentPassword: typeof input?.currentPassword === 'string' ? input.currentPassword : '',
      ...(typeof input?.newUsername === 'string' ? { newUsername: input.newUsername.trim() } : {}),
      ...(typeof input?.newPassword === 'string' && input.newPassword ? { newPassword: input.newPassword } : {}),
    },
    token: authSession.token,
  });
  await persistSession(response.account.username, authSession.token, response.session?.expiresAt || authSession.expiresAt, response.account.role);
  let recoveryWarning = '';
  if (response.account.role === 'root') {
    try { await developerVault.write({ username: response.account.username, password: input.newPassword || input.currentPassword }); }
    catch { recoveryWarning = '账号已修改，但本机恢复凭据未更新，请记住新账号和密码。'; }
  }
  return { username: response.account.username, role: response.account.role, recoveryWarning };
}

function getCredentialFolder() {
  return path.join(app.getPath('pictures'), '雨巷来信');
}

async function saveCredentialImage(dataUrl, username) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 2_500_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error('账号图片格式无效，请重新生成。');
  }
  const safeName = typeof username === 'string' && /^YX[A-Za-z0-9]{8}$/.test(username) ? username : 'account';
  const data = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (data.length < 256 || data.length > 1_750_000 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('无法保存账号图片，请重新生成。');
  }
  const folder = getCredentialFolder();
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, `${safeName}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  await fs.writeFile(file, data, { flag: 'wx', mode: 0o600 });
  return { path: file };
}

function normalizeSiteUrl(value, { allowUnsafeProtocol = false } = {}) {
  if (typeof value !== 'string' || value.length > 600) throw new Error('这个站点尚未开放。');
  let url;
  try { url = new URL(value); } catch { throw new Error('站点地址无效。'); }
  if (isPrivateNetworkHost(url.hostname) && !appState?.allowLocalNetwork) throw new Error('本机、局域网及内部网络地址默认关闭。请先在设置里开启局域网访问。');
  if (!siteAllowed(url) && !allowUnsafeProtocol) throw new Error('这个站点暂时不在允许范围内。请检查站点权限，或确认后加入许可列表。');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持普通 HTTP 或 HTTPS 网页，不支持本地文件和其他协议。');
  if (url.protocol === 'http:' && !appState?.allowHttp && !allowUnsafeProtocol) throw new Error('HTTP 明文站点默认已关闭，请先在设置里启用并确认风险。');
  return url;
}

function hideWebsiteViews(visibleId = '') {
  for (const [id, view] of websiteViews) {
    if (!view.webContents.isDestroyed()) view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    if (id === visibleId) websiteView = view;
  }
  if (!visibleId) websiteView = null;
}
function websiteBounds(input, tabId = activeWebsiteId) {
  if (!windowRef || !input || typeof input !== 'object') return false;
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(input[key]));
  if (!values.every(Number.isFinite)) return false;
  const view = typeof tabId === 'string' ? websiteViews.get(tabId) : null;
  if (!view || view.webContents.isDestroyed()) { hideWebsiteViews(); return true; }
  const [x, y, width, height] = values;
  hideWebsiteViews(tabId);
  if (width < 1 || height < 1) return true;
  const [contentWidth, contentHeight] = windowRef.getContentSize();
  const left = Math.max(0, Math.min(contentWidth - 1, Math.round(x)));
  const top = Math.max(0, Math.min(contentHeight - 1, Math.round(y)));
  view.setBounds({ x: left, y: top, width: Math.max(1, Math.min(contentWidth - left, Math.round(width))), height: Math.max(1, Math.min(contentHeight - top, Math.round(height))) });
  return true;
}
function activateWebsiteTab(tabId) {
  if (!websiteTabIds.has(tabId)) return null;
  const view = websiteViews.get(tabId);
  activeWebsiteId = tabId;
  hideWebsiteViews(tabId);
  if (!view || view.webContents.isDestroyed()) return { id: tabId, url: '', title: '新标签页', canGoBack: false, canGoForward: false };
  const history = view.webContents.navigationHistory;
  const currentUrl = view.webContents.getURL();
  let fallbackTitle = '新标签页';
  try { fallbackTitle = new URL(currentUrl).hostname || fallbackTitle; } catch { /* an empty new tab has no URL yet */ }
  return { id: tabId, url: currentUrl, title: view.webContents.getTitle() || fallbackTitle, canGoBack: history.canGoBack(), canGoForward: history.canGoForward(), loading: contentsLoading(view.webContents) };
}

function contentsLoading(contents) {
  try { return contents.isLoading(); } catch { return false; }
}
function createWebsiteView(tabId) {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:rain-alley-sites',
      preload: path.join(__dirname, 'site-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  const contents = view.webContents;
  const notify = (channel, detail = {}) => windowRef?.webContents.send(channel, { tabId, ...detail });
  windowRef.contentView.addChildView(view);
  websiteTabIds.add(tabId);
  websiteViews.set(tabId, view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  contents.setWindowOpenHandler(({ url: nextUrl }) => {
    let safe;
    try { safe = new URL(nextUrl); } catch { notify('desktop:site-blocked', { url: nextUrl }); return { action: 'deny' }; }
    const current = (() => { try { return new URL(contents.getURL()); } catch { return null; } })();
    if (linkSwiftEnabledFor(contents) && providerFor(current)?.id === 'baidu' && isLinkSwiftAuthorizeUrl(safe)) {
      try { createLinkSwiftAuthorizationWindow(safe, contents); } catch { notify('desktop:linkswift-auth-failed'); }
      return { action: 'deny' };
    }
    if (!siteAllowed(safe) || !appState.allowPopups) notify('desktop:site-navigation-requested', { url: safe.toString(), host: safe.hostname });
    else contents.loadURL(safe.toString());
    return { action: 'deny' };
  });
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isInPlace || !isMainFrame) return;
    abortLinkSwiftRequests(contents);
  });
  contents.on('will-navigate', (event, nextUrl) => {
    let url;
    try { url = new URL(nextUrl); } catch { event.preventDefault(); notify('desktop:site-blocked', { url: nextUrl }); return; }
    if (!siteAllowed(url)) { event.preventDefault(); notify('desktop:site-navigation-requested', { url: url.toString(), host: url.hostname }); }
  });
  contents.on('will-redirect', (event, nextUrl) => {
    let url;
    try { url = new URL(nextUrl); } catch { event.preventDefault(); notify('desktop:site-blocked', { url: nextUrl }); return; }
    if (!siteAllowed(url)) { event.preventDefault(); notify('desktop:site-navigation-requested', { url: url.toString(), host: url.hostname }); }
  });
  const reportNavigation = (nextUrl) => {
    const history = contents.navigationHistory;
    notify('desktop:site-navigated', { url: nextUrl, canGoBack: history.canGoBack(), canGoForward: history.canGoForward() });
  };
  contents.on('did-navigate', (_event, nextUrl) => reportNavigation(nextUrl));
  contents.on('did-navigate-in-page', (_event, nextUrl) => reportNavigation(nextUrl));
  contents.on('did-fail-load', (_event, code, description) => { if (code !== -3) notify('desktop:site-failed', { description: description || '检查网络后可重新载入，或者返回功能目录。' }); });
  contents.on('did-finish-load', () => {
    notify('desktop:site-loaded');
    notify('desktop:site-title', { url: contents.getURL(), title: contents.getTitle() });
  });
  contents.on('page-title-updated', (_event, title) => notify('desktop:site-title', { url: contents.getURL(), title }));
  contents.once('destroyed', () => {
    websiteViews.delete(tabId);
    linkSwiftContents.delete(contents.id);
    if (activeWebsiteId === tabId) {
      activeWebsiteId = [...websiteViews.keys()].at(-1) || '';
      websiteView = activeWebsiteId ? websiteViews.get(activeWebsiteId) : null;
    }
  });
  return view;
}
async function openWebsite(value, approvedByUser = false, tabId = null) {
  const url = normalizeSiteUrl(value, { allowUnsafeProtocol: approvedByUser });
  if (tabId == null) tabId = crypto.randomUUID();
  if (typeof tabId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(tabId)) throw new Error('网页标签地址无效。');
  if (!siteAllowed(url)) {
    if (!approvedByUser || appState.navigationPolicy !== 'allowlist' || appState.blockedHosts.some((blocked) => url.hostname === blocked || url.hostname.endsWith('.' + blocked))) {
      windowRef?.webContents.send('desktop:site-blocked', { tabId, url: url.toString(), host: url.hostname });
      throw new Error('这个站点不符合当前权限设置。');
    }
    appState = await saveAppState({ allowedHosts: [...appState.allowedHosts, url.hostname] });
  }
  if (url.protocol === 'http:' && !appState.allowHttp) throw new Error('已为你拦截 HTTP 明文网页。请先到设置里开启 HTTP 并再次确认。');
  const view = websiteViews.get(tabId) || createWebsiteView(tabId);
  websiteTabIds.add(tabId);
  activeWebsiteId = tabId;
  websiteView = view;
  hideWebsiteViews(tabId);
  await view.webContents.loadURL(url.toString());
  return { id: tabId, url: url.toString(), title: view.webContents.getTitle() || url.hostname, canGoBack: view.webContents.navigationHistory.canGoBack(), canGoForward: view.webContents.navigationHistory.canGoForward(), loading: contentsLoading(view.webContents) };
}
function showDownloadNotification(title, filename) {
  if (!Notification.isSupported()) return;
  try { new Notification({ title, body: filename, silent: true }).show(); } catch { /* the in-app download status remains available */ }
}
async function ensureDownloadDirectory() {
  const current = appState?.downloadDirectory;
  if (current && path.isAbsolute(current)) {
    try {
      const stat = await fs.stat(current);
      await fs.access(current, fsSync.constants.W_OK);
      if (stat.isDirectory()) return current;
    } catch { /* a moved or removed folder must be selected again */ }
  }
  if (process.env.RAIN_ALLEY_TEST_MODE === '1') {
    const testDirectory = path.join(app.getPath('userData'), 'test-downloads');
    await fs.mkdir(testDirectory, { recursive: true });
    appState = await saveAppState({ downloadDirectory: testDirectory });
    return testDirectory;
  }
  while (true) {
    const result = await dialog.showOpenDialog({
      title: '选择雨巷来信下载文件夹',
      buttonLabel: '使用此文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      const selected = path.resolve(result.filePaths[0]);
      try {
        await fs.access(selected, fsSync.constants.W_OK);
        appState = await saveAppState({ downloadDirectory: selected });
        return selected;
      } catch {
        const choice = await dialog.showMessageBox({
          type: 'error',
          title: '无法使用这个文件夹',
          message: '雨巷来信需要一个可写入的下载文件夹。请改选其他位置。',
          buttons: ['重新选择', '退出应用'],
          defaultId: 0,
          cancelId: 1,
        });
        if (choice.response !== 0) throw new Error('没有设置可用的下载文件夹。');
        continue;
      }
    }
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: '还需要选择下载文件夹',
      message: '网页下载会保存到你选择的位置。首次使用前，请先指定一个文件夹。',
      buttons: ['重新选择', '退出应用'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) throw new Error('启动前必须先选择下载文件夹。');
  }
}
function configureSiteSession() {
  const siteSession = session.fromPartition('persist:rain-alley-sites');
  const permitted = (permission, origin) => {
    try {
      // writeText requires sanitized-write; never grant clipboard reads here.
      if (permission === 'clipboard-sanitized-write') return siteAllowed(new URL(origin));
      const mapped = permission === 'media' || permission === 'mediaKeySystem' ? 'media' : permission === 'geolocation' ? 'geolocation' : permission === 'notifications' ? 'notifications' : permission === 'clipboard-read' ? 'clipboard-read' : permission;
      return appState?.allowedPermissions.includes(mapped) === true && siteAllowed(new URL(origin));
    } catch { return false; }
  };
  siteSession.setPermissionCheckHandler((_contents, permission, origin) => permitted(permission, origin));
  siteSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(permitted(permission, details.requestingUrl || '')));
  siteSession.on('will-download', (event, item) => {
    if (!appState?.downloadsEnabled) { event.preventDefault(); item.cancel(); windowRef?.webContents.send('desktop:download-blocked'); return; }
    const folder = appState.downloadDirectory;
    if (!folder || !path.isAbsolute(folder) || !fsSync.existsSync(folder)) { event.preventDefault(); item.cancel(); windowRef?.webContents.send('desktop:download-folder-missing'); return; }
    const requested = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'download';
    const extension = path.extname(requested);
    const stem = extension ? requested.slice(0, -extension.length) : requested;
    let filename = requested;
    let index = 1;
    let target = path.join(folder, filename);
    while (fsSync.existsSync(target) || claimedDownloadPaths.has(target)) {
      filename = `${stem} (${index++})${extension}`;
      target = path.join(folder, filename);
    }
    claimedDownloadPaths.add(target);
    item.setSavePath(target);
    const id = crypto.randomUUID();
    activeDownloads.set(id, item);
    const report = (status) => {
      const entry = { id, name: filename, path: target, status, received: item.getReceivedBytes(), total: item.getTotalBytes(), canResume: item.canResume() };
      if (!suppressDownloadHistory) {
        downloadHistory.set(id, entry);
        if (downloadHistory.size > 100) downloadHistory.delete(downloadHistory.keys().next().value);
      }
      windowRef?.webContents.send('desktop:download-update', entry);
    };
    report('started');
    showDownloadNotification('开始下载', filename);
    item.on('updated', (_event, state) => report(item.isPaused() ? 'paused' : state === 'interrupted' ? 'interrupted' : 'progress'));
    item.once('done', (_event, state) => {
      activeDownloads.delete(id);
      claimedDownloadPaths.delete(target);
      const status = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed';
      report(status);
      if (status === 'completed') showDownloadNotification('下载完成', filename);
      else if (status === 'failed') showDownloadNotification('下载未完成', filename);
    });
  });
}
function closeWebsite(tabId = '') {
  const closing = (tabId ? [tabId] : [...websiteTabIds]).map((id) => [id, websiteViews.get(id)]);
  if (tabId && !websiteTabIds.has(tabId)) return false;
  if (!tabId && !websiteTabIds.size) return false;
  for (const [id, view] of closing) {
    if (view) {
      abortLinkSwiftRequests(view.webContents);
      windowRef?.contentView.removeChildView(view);
      view.webContents.close();
      websiteViews.delete(id);
    }
    websiteTabIds.delete(id);
  }
  if (!tabId) {
    for (const authWindow of [...linkSwiftAuthWindows]) if (!authWindow.isDestroyed()) authWindow.close();
    linkSwiftAuthWindows.clear();
  }
  if (!websiteTabIds.has(activeWebsiteId)) activeWebsiteId = [...websiteTabIds].at(-1) || '';
  websiteView = activeWebsiteId ? websiteViews.get(activeWebsiteId) : null;
  if (!websiteViews.size) activeWebsiteId = '';
  return true;
}
function showHome() {
  if (!windowRef) { createWindow(); return; }
  if (windowRef.isMinimized()) windowRef.restore();
  if (!windowRef.isVisible()) windowRef.show();
  windowRef.focus();
  windowRef.webContents.send('desktop:show-home');
}

function closeWindowToTray() {
  if (!windowRef) return false;
  closeWebsite();
  const closingWindow = windowRef;
  windowRef = null;
  closingWindow.destroy();
  return true;
}

function minimizeToTray() {
  if (!windowRef) return false;
  hideWebsiteViews();
  windowRef.webContents.send('desktop:suspend');
  windowRef.hide();
  return true;
}

function createTray() {
  if (trayRef) return;
  const iconPath = shellIconPath();
  const image = nativeImage.createFromPath(iconPath);
  trayRef = new Tray(image.isEmpty() ? iconPath : image);
  trayRef.setToolTip('雨巷来信 · 工具集合');
  const menu = Menu.buildFromTemplate([
    { label: '打开雨巷主页', click: showHome },
    { type: 'separator' },
    { label: '退出雨巷来信', click: () => { quitting = true; closeWebsite(); app.quit(); } },
  ]);
  trayRef.setContextMenu(menu);
  trayRef.on('click', showHome);
  trayRef.on('double-click', showHome);
}

async function registerAppProtocol() {
  protocol.handle('rainalley', (request) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response('Bad request', { status: 400 }); }
    const root = path.resolve(__dirname);
    const target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
}

function repairAppShortcuts(icon) {
  const shortcuts = [path.join(app.getPath('desktop'), '雨巷来信.lnk'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', '雨巷来信', '雨巷来信.lnk')];
  for (const file of shortcuts) {
    try {
      if (fsSync.existsSync(file) && path.resolve(shell.readShortcutLink(file).target).toLowerCase() !== process.execPath.toLowerCase()) continue;
      fsSync.mkdirSync(path.dirname(file), { recursive: true });
      shell.writeShortcutLink(file, 'replace', { target: process.execPath, cwd: path.dirname(process.execPath), icon, iconIndex: 0, appUserModelId: 'cn.rainalley.letters', description: '雨巷来信 · 工具集合' });
    } catch (cause) { console.warn('[shortcut-repair]', cause.message); }
  }
}

function shellIconPath() {
  const target = path.join(app.getPath('userData'), 'rain-alley-shell.ico');
  fsSync.mkdirSync(path.dirname(target), { recursive: true });
  fsSync.copyFileSync(path.join(__dirname, '..', 'assets', 'rain-alley.ico'), target);
  return target;
}

function createWindow() {
  if (windowRef) { showHome(); return; }
  windowRef = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1050,
    minHeight: 760,
    center: true,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    show: false,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: '雨巷来信 · 工具集合',
    icon: shellIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  // Give both native window icons and Explorer relaunch metadata a stable
  // filesystem path, including when assets are packaged in ASAR.
  const appIcon = nativeImage.createFromPath(shellIconPath());
  if (!appIcon.isEmpty()) windowRef.setIcon(appIcon);
  // Explicit shell relaunch metadata prevents Explorer from choosing the
  // development Electron executable as this window's taskbar identity.
  const shellIcon = shellIconPath();
  windowRef.setAppDetails({ appId: 'cn.rainalley.letters', appIconPath: shellIcon, appIconIndex: 0, relaunchDisplayName: '雨巷来信', relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"` });
  if (app.isPackaged) repairAppShortcuts(shellIcon);
  windowRef.loadURL('rainalley://app/index.html');
  // The renderer no longer owns a continuously animated 3D scene. Keep
  // background throttling enabled so hidden/tray windows release scheduler
  // time immediately instead of competing with the rest of the desktop.
  windowRef.webContents.setBackgroundThrottling(true);
  windowRef.webContents.on('console-message', (event) => {
    if (event.level >= 2) console.log(`[renderer:${event.level}] ${event.message.slice(0, 220)} (${event.sourceId}:${event.lineNumber})`);
  });
  windowRef.webContents.on('render-process-gone', (_event, details) => console.error(`[renderer-gone] ${details.reason}`));
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowRef.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('rainalley://app/')) event.preventDefault(); });
  windowRef.once('ready-to-show', () => {
    createTray();
    if (wasMaximized) windowRef.maximize();
    windowRef.show();
  });
  windowRef.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (appState?.closeToTray !== false) closeWindowToTray();
    else windowRef.minimize();
  });
  windowRef.on('closed', () => { windowRef = null; });
  windowRef.on('show', () => { windowRef?.webContents.send('desktop:show-home'); });
  windowRef.on('minimize', () => {
    hideWebsiteViews();
    windowRef?.webContents.send('desktop:suspend');
  });
  windowRef.on('restore', () => windowRef?.webContents.send('desktop:resume'));
  windowRef.on('maximize', () => { wasMaximized = true; windowRef?.webContents.send('desktop:window-state', true); });
  windowRef.on('unmaximize', () => { wasMaximized = false; windowRef?.webContents.send('desktop:window-state', false); });
}

ipcMain.handle('window:minimize', (event) => { ensureTrusted(event); windowRef?.minimize(); return true; });
ipcMain.handle('window:minimize-to-taskbar', (event) => { ensureTrusted(event); windowRef?.minimize(); return true; });
ipcMain.handle('window:minimize-to-tray', (event) => { ensureTrusted(event); return minimizeToTray(); });
ipcMain.handle('window:restore', (event) => { ensureTrusted(event); if (!windowRef) return false; if (windowRef.isMinimized()) windowRef.restore(); windowRef.show(); windowRef.focus(); return true; });
ipcMain.handle('window:maximize', (event) => {
  ensureTrusted(event);
  if (!windowRef) return false;
  if (windowRef.isMaximized()) windowRef.unmaximize(); else windowRef.maximize();
  return windowRef.isMaximized();
});
ipcMain.handle('window:is-maximized', (event) => { ensureTrusted(event); return windowRef?.isMaximized() ?? false; });
ipcMain.handle('window:close', (event) => { ensureTrusted(event); closeWindowToTray(); return true; });
ipcMain.on('window:close-to-tray', (event) => { ensureTrusted(event); closeWindowToTray(); });
ipcMain.handle('window:quit', (event) => { ensureTrusted(event); quitting = true; closeWebsite(); app.quit(); return true; });
ipcMain.handle('window:toggle-always-on-top', (event, value) => { ensureTrusted(event); windowRef?.setAlwaysOnTop(Boolean(value), 'floating'); return windowRef?.isAlwaysOnTop() ?? false; });
ipcMain.handle('app:version', (event) => { ensureTrusted(event); return app.getVersion(); });
ipcMain.handle('app:theme', (event) => { ensureTrusted(event); return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'; });
ipcMain.handle('app:get-state', async (event) => {
  ensureTrusted(event);
  const state = await loadAppState();
  return {
    username: authSession?.username || null,
    maximized: windowRef?.isMaximized() ?? false,
    windowMinimized: windowRef?.isMinimized() ?? false,
    windowVisible: windowRef?.isVisible() ?? false,
    installedFeatures: [...state.installedFeatures],
    preferences: { ...state, installedFeatures: [...state.installedFeatures] },
  };
});
ipcMain.handle('app:save-state', async (event, value) => { ensureTrusted(event); return saveAppState(value); });
ipcMain.handle('clipboard:write', async (event, value) => { ensureTrusted(event); await clipboard.writeText(typeof value === 'string' ? value.slice(0, 100_000) : ''); return true; });
ipcMain.handle('account:resume', async (event) => {
  ensureTrusted(event);
  if (authSession && authSession.expiresAt > Math.floor(Date.now() / 1000)) return { username: authSession.username, role: authSession.role };
  authSession = null;
  const saved = await readPersistedSession();
  if (!saved || saved.expiresAt <= Math.floor(Date.now() / 1000)) { await clearPersistedSession(); return null; }
  try {
    const response = await requestApi('/api/session', { token: saved.token });
    await persistSession(response.account.username, saved.token, saved.expiresAt, response.account.role);
    return { username: response.account.username, role: response.account.role };
  } catch (cause) {
    if (/登录已失效/u.test(cause.message)) await clearPersistedSession();
    throw cause;
  }
});
ipcMain.handle('account:register', async (event) => { ensureTrusted(event); return createAccount(); });
ipcMain.handle('account:login', async (event, input) => {
  ensureTrusted(event);
  const username = typeof input?.username === 'string' ? input.username.trim() : '';
  const password = typeof input?.password === 'string' ? input.password : '';
  const response = await requestApi('/api/login', { method: 'POST', body: { username, password } });
  let recoveryWarning = '';
  if (response.account.role === 'root') {
    try { await developerVault.write({ username: response.account.username, password }); }
    catch { recoveryWarning = '登录成功，但本机恢复凭据未保存，请记住账号和密码。'; }
  }
  const profile = await persistSession(response.account.username, response.session.token, response.session.expiresAt, response.account.role);
  return { ...profile, recoveryWarning };
});
ipcMain.handle('account:developer-available', async (event) => {
  ensureTrusted(event);
  try { return Boolean(await developerVault.read()); } catch { return false; }
});
ipcMain.handle('account:developer-login', async (event) => {
  ensureTrusted(event);
  const credentials = await developerVault.read();
  if (!credentials) throw new Error('这台设备尚未保存主理人凭据。');
  const response = await requestApi('/api/login', { method: 'POST', body: credentials });
  if (response.account.role !== 'root') throw new Error('主理人账号尚未启用，请在确认部署后完成账号初始化。');
  return persistSession(response.account.username, response.session.token, response.session.expiresAt, response.account.role);
});
ipcMain.handle('account:update', async (event, input) => { ensureTrusted(event); return updateAccount(input); });
ipcMain.handle('account:logout', async (event) => {
  ensureTrusted(event);
  if (authSession?.token) {
    try { await requestApi('/api/logout', { method: 'POST', token: authSession.token }); } catch { /* clearing the local session remains available offline */ }
  }
  await clearPersistedSession();
  return true;
});
ipcMain.handle('account:save-credential-image', async (event, value) => {
  ensureTrusted(event);
  return saveCredentialImage(value?.dataUrl, value?.username);
});
ipcMain.handle('account:latest-credential-image', async (event) => {
  ensureTrusted(event);
  try {
    const folder = getCredentialFolder();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^YX[A-Za-z0-9]{8}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.png$/.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(folder, entry.name);
        return { path: filePath, modified: (await fs.stat(filePath)).mtimeMs };
      }));
    return candidates.sort((a, b) => b.modified - a.modified)[0]?.path || null;
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    throw new Error('读取账号图片文件夹失败。');
  }
});
ipcMain.handle('account:show-credential-image', async (event, value) => {
  ensureTrusted(event);
  if (typeof value?.path !== 'string') throw new Error('没有可打开的账号图片。');
  const absolute = path.resolve(value.path);
  if (!absolute.startsWith(`${getCredentialFolder()}${path.sep}`)) throw new Error('账号图片路径无效。');
  shell.showItemInFolder(absolute);
  return true;
});
ipcMain.handle('module:get-comments', async (event, featureId) => {
  ensureTrusted(event);
  if (!authSession?.token || typeof featureId !== 'string' || !/^[a-z0-9-]{2,40}$/.test(featureId)) throw new Error('登录后才能查看留言。');
  return requestApi(`/api/modules/${encodeURIComponent(featureId)}/comments`, { token: authSession.token });
});
ipcMain.handle('module:add-comment', async (event, input) => {
  ensureTrusted(event);
  if (!authSession?.token || typeof input?.featureId !== 'string' || !/^[a-z0-9-]{2,40}$/.test(input.featureId)) throw new Error('登录后才能寄出留言。');
  return requestApi(`/api/modules/${encodeURIComponent(input.featureId)}/comments`, { method: 'POST', body: { body: input.body }, token: authSession.token });
});
ipcMain.handle('profile:get-public', async (event, username) => {
  ensureTrusted(event);
  if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{4,24}$/.test(username)) throw new Error('个人页面地址无效。');
  return requestApi(`/api/profiles/${encodeURIComponent(username)}`, { token: authSession?.token });
});
ipcMain.handle('profile:save-own', async (event, profile) => {
  ensureTrusted(event);
  if (!authSession?.token) throw new Error('登录后才能编辑自己的个人页面。');
  return requestApi(`/api/profiles/${encodeURIComponent(authSession.username)}`, { method: 'PUT', body: profile, token: authSession.token });
});
ipcMain.handle('downloads:choose-directory', async (event) => {
  ensureTrusted(event);
  const result = await dialog.showOpenDialog(windowRef, { title: '选择网页下载文件夹', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});
ipcMain.handle('downloads:open-directory', async (event) => {
  ensureTrusted(event);
  const folder = appState?.downloadDirectory;
  if (!folder || !path.isAbsolute(folder) || !fsSync.existsSync(folder)) throw new Error('下载文件夹不可用，请在设置中重新选择。');
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle('downloads:list', (event) => { ensureTrusted(event); return [...downloadHistory.values()].reverse(); });
ipcMain.handle('downloads:control', (event, id, action) => {
  ensureTrusted(event);
  const item = activeDownloads.get(id);
  if (!item || !['progressing', 'interrupted'].includes(item.getState())) return false;
  if (action === 'pause') item.pause();
  else if (action === 'resume' && item.canResume()) item.resume();
  else if (action === 'cancel') item.cancel();
  else return false;
  return true;
});
ipcMain.handle('downloads:open-file', async (event, id) => {
  ensureTrusted(event);
  const entry = downloadHistory.get(id);
  if (!entry?.path || entry.status !== 'completed' || !fsSync.existsSync(entry.path)) throw new Error('下载文件暂时不可用。');
  const error = await shell.openPath(entry.path);
  if (error) throw new Error(error);
  return true;
});
ipcMain.handle('app:clear-data', async (event) => {
  ensureTrusted(event);
  const userData = path.resolve(app.getPath('userData'));
  const downloadDirectory = appState?.downloadDirectory ? path.resolve(appState.downloadDirectory) : '';
  if (downloadDirectory && (downloadDirectory === userData || userData.startsWith(`${downloadDirectory}${path.sep}`))) {
    throw new Error('下载文件夹位于应用数据目录内侧，无法安全清除应用数据并同时保留下载内容。请先在设置中改选其他下载文件夹。');
  }
  closeWebsite();
  await Promise.all([appStateWriteQueue, linkSwiftWriteQueue]);
  const siteSession = session.fromPartition('persist:rain-alley-sites');
  const defaultSession = session.defaultSession;
  const clearSession = async (targetSession) => {
    await Promise.all([
      targetSession.clearStorageData(),
      targetSession.clearCache(),
      targetSession.clearAuthCache(),
      targetSession.clearHostResolverCache(),
    ]);
  };
  await Promise.all([clearSession(siteSession), clearSession(defaultSession)]);
  await fs.rm(getCredentialFolder(), { recursive: true, force: true });
  const preserve = downloadDirectory.startsWith(`${userData}${path.sep}`) ? downloadDirectory : '';
  let lockedProfileEntries = 0;
  async function clearExceptDownloads(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (preserve && (target === preserve || preserve.startsWith(`${target}${path.sep}`))) {
        if (target !== preserve) await clearExceptDownloads(target);
        continue;
      }
      try { await fs.rm(target, { recursive: true, force: true }); }
      catch (cause) {
        if (!['EBUSY', 'ENOTEMPTY'].includes(cause.code)) throw cause;
        lockedProfileEntries += 1;
      }
    }
  }
  await clearExceptDownloads(userData);
  authSession = null;
  appState = null;
  appStatePromise = null;
  appStateWriteQueue = Promise.resolve();
  linkSwiftValues = {};
  linkSwiftValuesPromise = null;
  downloadHistory.clear();
  suppressDownloadHistory = true;
  return { downloadsPreserved: Boolean(preserve), lockedProfileEntries };
});
ipcMain.handle('cs2:choose-directory', async (event) => {
  ensureTrusted(event);
  const result = await dialog.showOpenDialog(windowRef, { title: '选择 Counter-Strike 2 游戏目录', properties: ['openDirectory'] });
  const selected = result.canceled ? null : normalizeCs2Directory(result.filePaths[0] || null);
  if (selected) appState = await saveAppState({ cs2Directory: selected });
  return selected;
});
function normalizeCs2Directory(input) {
  if (!input || !path.isAbsolute(input)) return null;
  let candidate = path.resolve(input);
  const looksLikeCsgo = path.basename(candidate).toLowerCase() === 'csgo' && path.basename(path.dirname(candidate)).toLowerCase() === 'game';
  const hasCsgo = fsSync.existsSync(path.join(candidate, 'game', 'csgo'));
  if (!looksLikeCsgo && hasCsgo) candidate = path.join(candidate, 'game', 'csgo');
  return candidate;
}
function findCs2Installations() {
  const candidates = new Set();
  const roots = new Set([
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Steam'),
  ]);
  const registered = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
  const steamPath = registered.stdout?.match(/SteamPath\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
  if (steamPath) roots.add(path.resolve(steamPath.replaceAll('/', '\\')));
  for (const steamRoot of roots) {
    candidates.add(path.join(steamRoot, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo'));
    try {
      const libraryFile = fsSync.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const match of libraryFile.matchAll(/"path"\s*"([^"]+)"/g)) candidates.add(path.join(match[1].replaceAll('\\\\', '\\'), 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo'));
    } catch { /* a Steam root may not exist or use libraryfolders.vdf */ }
  }
  return [...candidates].find((candidate) => fsSync.existsSync(path.join(candidate, 'gameinfo.gi')) || fsSync.existsSync(path.join(path.dirname(candidate), 'csgo.exe'))) || null;
}
ipcMain.handle('cs2:find-directory', async (event) => {
  ensureTrusted(event);
  const saved = appState?.cs2Directory;
  if (saved && fsSync.existsSync(path.join(saved, 'gameinfo.gi'))) return saved;
  const found = findCs2Installations();
  if (found) appState = await saveAppState({ cs2Directory: found });
  return found;
});
ipcMain.handle('cs2:choose-archive', async (event) => {
  ensureTrusted(event);
  const result = await dialog.showOpenDialog(windowRef, { title: '选择 CS2 Bot Improver 官方 ZIP', properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  const selected = result.canceled ? null : result.filePaths[0] || null;
  if (selected) await saveAppState({ cs2Archive: selected });
  return selected;
});
ipcMain.handle('cs2:get-archive', async (event) => {
  ensureTrusted(event);
  const saved = (await loadAppState()).cs2Archive;
  const available = saved && await fs.stat(saved).then((info) => info.isFile()).catch(() => false);
  return { path: saved || '', available: Boolean(available) };
});
ipcMain.handle('cs2:open-panel', async (event, directory) => {
  ensureTrusted(event);
  if (typeof directory !== 'string') throw new Error('CS2 游戏目录无效。');
  const root = normalizeCs2Directory(directory);
  if (!root) throw new Error('CS2 游戏目录无效。');
  const target = path.join(root, 'Panel v1.4.7.exe');
  if (!fsSync.existsSync(target)) throw new Error('所选游戏目录中还没有 Panel，请先安装官方插件包。');
  return new Promise((resolve, reject) => {
    const child = spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => reject(new Error('Panel 无法启动，请在游戏目录中检查文件权限。')));
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
});
ipcMain.handle('cs2:install', async (event, input = {}) => {
  ensureTrusted(event);
  let root = typeof input.directory === 'string' ? normalizeCs2Directory(input.directory) : '';
  let archive = typeof input.archive === 'string' && input.archive.trim() ? path.resolve(input.archive) : '';
  if (!root || !path.isAbsolute(root)) throw new Error('请先选择 CS2 游戏目录。');
  if (input.cleanOtherPlugins !== true || typeof input.keepBackup !== 'boolean') return { cancelled: true };
  appState = await saveAppState({ cs2Directory: root });
  if (!archive) {
    archive = path.join(app.getPath('userData'), 'cs2-bot-improver-v1.4.7.zip');
    if (!fsSync.existsSync(archive)) {
      const response = await net.fetch('https://github.com/ed0ard/CS2-Bot-Improver/releases/download/v1.4.7/CS2BotImprover.zip');
      if (!response.ok) throw new Error(`官方插件下载失败（${response.status}），请检查网络后重试。`);
      await fs.mkdir(path.dirname(archive), { recursive: true });
      const temporary = `${archive}.${process.pid}.tmp`;
      await fs.writeFile(temporary, Buffer.from(await response.arrayBuffer()));
      await fs.rename(temporary, archive);
    }
  }
  if (!path.isAbsolute(archive) || !fsSync.existsSync(archive)) throw new Error('没有找到官方插件 ZIP 文件。');
  const digest = await new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fsSync.createReadStream(archive); stream.on('data', (chunk) => hash.update(chunk)); stream.once('error', reject); stream.once('end', () => resolve(hash.digest('hex').toUpperCase())); });
  if (digest !== 'EFFB3C9C76301F74DA1582FB167B44FA12B86772C2CACC91848767C27DB92E67') throw new Error('文件校验未通过。请从官方 v1.4.7 Release 下载 CS2BotImprover.zip。');
  const structureOkay = path.basename(root).toLowerCase() === 'csgo' && path.basename(path.dirname(root)).toLowerCase() === 'game'
    && fsSync.existsSync(path.join(root, 'gameinfo.gi')) && fsSync.existsSync(path.join(path.dirname(root), 'bin', 'win64'));
  if (!structureOkay) {
    const choice = await dialog.showMessageBox(windowRef, { type: 'warning', title: '请确认 CS2 游戏目录', message: '所选位置看起来不像 CS2 的 game\\csgo 目录。', detail: '你仍可以继续安装；程序会把官方包文件放入当前选择的目录。', buttons: ['仍然继续', '返回选择'], defaultId: 1, cancelId: 1 });
    if (choice.response !== 0) return { cancelled: true };
  }
  await saveAppState({ cs2Archive: archive });
  return runCs2Install(root, archive, input.keepBackup);
});

let cs2InstallRunning = false;
async function runtimeArchive() {
  const archive = path.join(__dirname, '..', 'assets/plugins/cs2-shared-runtime.zip');
  if (!fsSync.existsSync(archive)) throw new Error('随应用附带的共享运行库缺失，请修复雨巷来信安装。');
  const digest = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  if (digest !== require('./shared-runtime-manifest.json').archiveSha256) throw new Error('随应用附带的共享运行库校验失败。');
  return archive;
}
function requireGameClosed() {
  const processes = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (processes.status !== 0) throw new Error('无法检查游戏运行状态，请稍后重试。');
  if (/"(?:cs2|Panel v1\.[^"]*)\.exe"/i.test(processes.stdout)) throw new Error('请先关闭 CS2 和人机增强 Panel。');
}
ipcMain.handle('inventory:install', async (event, input = {}) => {
  ensureTrusted(event);
  if (input.cleanOtherPlugins !== true || typeof input.keepBackup !== 'boolean') return { cancelled: true };
  const root = normalizeCs2Directory(input.directory);
  if (!root || path.basename(root).toLowerCase() !== 'csgo' || path.basename(path.dirname(root)).toLowerCase() !== 'game' || !fsSync.existsSync(path.join(root, 'gameinfo.gi'))) throw new Error('请选择有效的 CS2 game\\csgo 目录。');
  if (cs2InstallRunning) throw new Error('插件安装或卸载正在进行，请稍候。');
  cs2InstallRunning = true;
  try {
    requireGameClosed();
    const runtime = await runtimeArchive();
    requireGameClosed();
    const result = await installInventory({ root, archive: path.join(__dirname, '..', 'assets/plugins/InventorySimulator-v3.7.2.zip'), runtimeArchive: runtime, keepBackup: input.keepBackup });
    await saveAppState({ cs2Directory: root });
    return result;
  } finally { cs2InstallRunning = false; }
});
ipcMain.handle('inventory:inspect-uninstall', async (event, input = {}) => {
  ensureTrusted(event);
  const root = normalizeCs2Directory(input.directory);
  if (!root) throw new Error('请先选择 CS2 游戏目录。');
  return inspectUninstall({ root, plugin: 'inventory', keepConfig: input.keepConfig !== false });
});
ipcMain.handle('inventory:uninstall', async (event, input = {}) => {
  ensureTrusted(event);
  if (input.confirmed !== true) return { cancelled: true };
  const root = normalizeCs2Directory(input.directory);
  if (!root) throw new Error('请先选择 CS2 游戏目录。');
  if (cs2InstallRunning) throw new Error('插件安装或卸载正在进行，请稍候。');
  cs2InstallRunning = true;
  try { requireGameClosed(); return await uninstallPayload({ root, plugin: 'inventory', keepConfig: input.keepConfig !== false, fingerprint: input.fingerprint }); }
  finally { cs2InstallRunning = false; }
});
ipcMain.handle('inventory:open-folder', async (event, directory) => {
  ensureTrusted(event);
  const root = normalizeCs2Directory(directory);
  if (!root || !fsSync.existsSync(path.join(root, 'gameinfo.gi'))) throw new Error('请选择有效的 CS2 游戏目录。');
  const target = path.join(root, 'cfg');
  const { checked } = require('./cs2-uninstaller.cjs');
  if (!await checked(root, 'cfg/rain-alley-inventory.cfg')) throw new Error('请先完成库存插件安装。');
  const error = await shell.openPath(target); if (error) throw new Error(error);
});
ipcMain.handle('inventory:launch', async event => {
  ensureTrusted(event);
  await shell.openExternal('steam://run/730//-insecure%20+map%20de_dust2%20+exec%20rain-alley-inventory.cfg');
  return true;
});
ipcMain.handle('cs2:status', async (event, directory) => {
  ensureTrusted(event);
  const root = normalizeCs2Directory(directory);
  if (!root) return {};
  return { bots: fsSync.existsSync(path.join(root, 'addons/counterstrikesharp/plugins/BotAI/BotAI.dll')), inventory: fsSync.existsSync(path.join(root, 'addons/counterstrikesharp/plugins/InventorySimulator/InventorySimulator.dll')) };
});
ipcMain.handle('app:open-source-notices', async (event) => {
  ensureTrusted(event);
  return fs.readFile(path.join(app.getAppPath(), 'THIRD_PARTY_NOTICES.md'), 'utf8');
});
ipcMain.handle('cs2:inspect-uninstall', async (event, input = {}) => {
  ensureTrusted(event);
  const root = typeof input.directory === 'string' ? normalizeCs2Directory(input.directory) : null;
  if (!root) throw new Error('请先选择 CS2 游戏目录。');
  return inspectUninstall({ root, keepConfig: input.keepConfig !== false, removeShared: input.removeShared === true });
});
ipcMain.handle('cs2:uninstall', async (event, input = {}) => {
  ensureTrusted(event);
  if (input.confirmed !== true) return { cancelled: true };
  const root = typeof input.directory === 'string' ? normalizeCs2Directory(input.directory) : null;
  if (!root) throw new Error('请先选择 CS2 游戏目录。');
  if (cs2InstallRunning) throw new Error('插件安装或卸载正在进行，请稍候。');
  cs2InstallRunning = true;
  try {
    const processes = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    if (processes.status !== 0) throw new Error('暂时无法检查游戏是否运行，请稍后重试。');
    if (/"(?:cs2|Panel v1\.[^"]*)\.exe"/i.test(processes.stdout)) throw new Error('请先关闭 CS2 和人机增强 Panel，再进行卸载。');
    const result = await uninstallPayload({ root, keepConfig: input.keepConfig !== false, removeShared: input.removeShared === true, fingerprint: input.fingerprint });
    return result;
  } finally { cs2InstallRunning = false; }
});
async function runCs2Install(root, archive, keepBackup) {
  if (cs2InstallRunning) throw new Error('另一个安装正在进行，请稍候。');
  cs2InstallRunning = true;
  try {
    const processes = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    if (processes.status !== 0) throw new Error('暂时无法检查游戏是否运行，请稍后重试。');
    if (/"(?:cs2|Panel v1\.[^"]*)\.exe"/i.test(processes.stdout)) throw new Error('请先关闭 CS2 和人机增强 Panel，再进行安装。');
    const result = await installOfficialPayload({ root, archive, keepBackup });
    const panelTarget = path.join(root, 'Panel v1.4.7.exe');
    let panelOpened = false;
    await new Promise((resolve) => {
      const panel = spawn(panelTarget, [], { cwd: root, detached: true, stdio: 'ignore', windowsHide: false });
      panel.once('error', resolve);
      panel.once('spawn', () => { panel.unref(); panelOpened = true; resolve(); });
    });
    return { ...result, panel: panelTarget, panelOpened };
  } finally { cs2InstallRunning = false; }
}
ipcMain.handle('netdisk:resolve', async (event, input) => {
  ensureTrusted(event);
  return resolveNetdiskInput(input);
});

function netdiskAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return [...NETDISK_API_HOSTS].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    || [...NETDISK_PAGE_HOSTS].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function netdiskRequest(options = {}, bridgeId, sourceContents) {
  if (!linkSwiftEnabledFor(sourceContents)) throw new Error('请先在支持的网盘页面中启用 LinkSwift。');
  let currentPage;
  try { currentPage = new URL(sourceContents.getURL()); } catch { throw new Error('当前网页地址无效。'); }
  const sourceProvider = providerFor(currentPage);
  if (!sourceProvider || (!isSharePageUrl(currentPage) && !isLinkSwiftOAuthPageUrl(currentPage))) throw new Error('只有受支持的网盘或百度授权页面可以调用 LinkSwift。');
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'HEAD'].includes(method)) throw new Error('LinkSwift 请求方法不受支持。');
  let target;
  try { target = new URL(String(options.url || '')); } catch { throw new Error('LinkSwift 请求地址无效。'); }
  const targetProvider = providerFor(target);
  if (target.protocol !== 'https:' || target.username || target.password || !netdiskAllowedHost(target.hostname) || targetProvider?.id !== sourceProvider.id) throw new Error('LinkSwift 请求地址不在当前网盘的许可范围内。');
  if (String(options.data || '').length > 1_000_000) throw new Error('LinkSwift 请求体过大。');
  const requestKey = `${sourceContents.id}:${String(bridgeId)}`;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  linkSwiftRequests.set(requestKey, controller);
  try {
    const baseHeaders = {};
    if (options.headers && typeof options.headers === 'object') {
      for (const [key, value] of Object.entries(options.headers)) {
        const name = String(key).trim().toLowerCase();
        if (!/^[a-z0-9-]{1,60}$/.test(name) || ['host', 'origin', 'content-length', 'cookie', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(name)) continue;
        const text = String(value ?? '');
        if (text.length <= 4000) baseHeaders[name] = text;
      }
    }
    baseHeaders.accept = baseHeaders.accept || '*/*';
    baseHeaders.referer = baseHeaders.referer || sourceContents.getURL();
    baseHeaders['user-agent'] = baseHeaders['user-agent'] || 'RainAlley-LinkSwift/1.1.3';
    let response;
    let current = target;
    let requestMethod = method;
    let requestData = String(options.data || '');
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const currentProvider = providerFor(current);
      if (current.protocol !== 'https:' || current.username || current.password || !netdiskAllowedHost(current.hostname) || currentProvider?.id !== sourceProvider.id) throw new Error('LinkSwift 跳转地址不在当前网盘的许可范围内。');
      const headers = { ...baseHeaders };
      if (current.origin !== target.origin) {
        delete headers.authorization;
        delete headers['proxy-authorization'];
      }
      const cookies = await sourceContents.session.cookies.get({ url: current.toString() }).catch(() => []);
      if (cookies.length) headers.cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      try {
        response = await fetch(current.toString(), { method: requestMethod, headers, body: requestMethod === 'GET' || requestMethod === 'HEAD' ? undefined : requestData, redirect: 'manual', signal: controller.signal });
      } catch (cause) {
        if (timedOut) throw new Error('LinkSwift 请求超时。');
        if (controller.signal.aborted) throw new Error('LinkSwift 请求已取消。');
        throw new Error('LinkSwift 请求失败。');
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new Error('LinkSwift 跳转次数超出限制。');
      current = new URL(location, current);
      if ([301, 302, 303].includes(response.status) && requestMethod === 'POST') { requestMethod = 'GET'; requestData = ''; }
    }
    const responseHeadersObject = Object.fromEntries(response.headers.entries());
    const responseHeaders = Object.entries(responseHeadersObject).map(([key, value]) => `${key}: ${value}`).join('\r\n');
    const chunks = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        let item;
        try { item = await reader.read(); } catch (cause) {
          if (timedOut) throw new Error('LinkSwift 响应读取超时。');
          if (controller.signal.aborted) throw new Error('LinkSwift 请求已取消。');
          throw new Error('LinkSwift 响应读取失败。');
        }
        const { done, value } = item;
        if (done) break;
        size += value.byteLength;
        if (size > 4_000_000) { await reader.cancel(); throw new Error('LinkSwift 响应过大，已停止读取。'); }
        chunks.push(Buffer.from(value));
      }
    }
    const rawBody = Buffer.concat(chunks);
    const responseType = ['arraybuffer', 'blob'].includes(String(options.responseType || '').toLowerCase())
      ? String(options.responseType).toLowerCase() : 'text';
    const binary = responseType === 'text' ? null : rawBody.toString('base64');
    const responseText = rawBody.toString('utf8');
    return {
      status: response.status,
      statusText: response.statusText,
      readyState: 4,
      finalUrl: response.url || current.toString(),
      responseHeaders,
      responseHeadersObject,
      responseText,
      response: responseType === 'text' ? responseText : binary,
      responseType,
      responseBase64: binary,
    };
  } finally {
    clearTimeout(timeout);
    linkSwiftRequests.delete(requestKey);
  }
}

ipcMain.handle('site:netdisk-request', async (event, message = {}) => {
  if (!linkSwiftEnabledFor(event.sender) || !Number.isSafeInteger(message.id) || message.id < 1) throw new Error('不允许的网盘页面请求。');
  return netdiskRequest(message.options || {}, message.id, event.sender);
});
ipcMain.on('site:netdisk-abort', (event, id) => {
  if (!linkSwiftEnabledFor(event.sender) || !Number.isSafeInteger(id) || id < 1) return;
  linkSwiftRequests.get(`${event.sender.id}:${String(id)}`)?.abort();
});
ipcMain.on('site:linkswift-storage', (event, message = {}) => {
  if (!linkSwiftEnabledFor(event.sender)) return;
  let current;
  try { current = new URL(event.sender.getURL()); } catch { return; }
  const provider = providerFor(current);
  if (!provider || (!isSharePageUrl(current) && !isLinkSwiftOAuthPageUrl(current)) || !message || typeof message.key !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(message.key) || ['__proto__', 'prototype', 'constructor'].includes(message.key)) return;
  loadLinkSwiftValues().catch(() => {});
  linkSwiftValues[provider.id] ||= {};
  let syncMessage;
  if (message.action === 'delete') delete linkSwiftValues[provider.id][message.key];
  else if (message.action === 'set') {
    let raw;
    try { raw = JSON.stringify(message.value); } catch { return; }
    if (raw === undefined || raw.length > 64_000) return;
    const store = linkSwiftValues[provider.id];
    if (!Object.prototype.hasOwnProperty.call(store, message.key) && Object.keys(store).length >= 200) return;
    const nextValue = JSON.parse(raw);
    if (JSON.stringify({ ...store, [message.key]: nextValue }).length > 500_000) return;
    Object.defineProperty(store, message.key, { value: nextValue, enumerable: true, configurable: true, writable: true });
    syncMessage = { action: 'set', key: message.key, value: nextValue };
  }
  else return;
  if (message.action === 'delete') syncMessage = { action: 'delete', key: message.key };
  for (const contents of linkSwiftContents.values()) {
    if (contents === event.sender || contents.isDestroyed()) continue;
    contents.send('site:linkswift-storage-sync', syncMessage);
  }
  saveLinkSwiftValues().catch(() => {});
});
ipcMain.handle('site:clipboard', async (event, value) => {
  if (!linkSwiftEnabledFor(event.sender)) throw new Error('不允许的网页剪贴板请求。');
  let currentPage;
  try { currentPage = new URL(event.sender.getURL()); } catch { throw new Error('当前网页地址无效。'); }
  if (!providerFor(currentPage) || (!isSharePageUrl(currentPage) && !isLinkSwiftOAuthPageUrl(currentPage))) throw new Error('当前网页不是受支持的网盘或授权页面。');
  const text = typeof value === 'string' ? value.slice(0, 100_000) : '';
  await clipboard.writeText(text);
  return true;
});
async function injectLinkSwiftInto(contents, provider, { allowOAuthPage = false } = {}) {
  if (!contents || contents.isDestroyed()) throw new Error('请先打开网盘分享页。');
  let current;
  try { current = new URL(contents.getURL()); } catch { throw new Error('当前网页地址无效。'); }
  const currentProvider = provider || providerFor(current);
  const pageAllowed = isSharePageUrl(current) || (allowOAuthPage && isLinkSwiftOAuthPageUrl(current));
  if (current.protocol !== 'https:' || !currentProvider || !pageAllowed) throw new Error('当前页面不是受支持的网盘分享页。');
  const marker = await contents.executeJavaScript('Boolean(window.__rainAlleyLinkSwiftInjected)', true).catch(() => false);
  if (marker) { enableLinkSwiftContents(contents); return { injected: true, reused: true, provider: currentProvider.name }; }
  await loadLinkSwiftValues();
  const state = linkSwiftValues[currentProvider.id] || {};
  const resources = {
    SwalLigt: await fs.readFile(path.join(__dirname, 'linkswift', 'sweetalert2-11.4.8.min.css'), 'utf8'),
    SwalDark: await fs.readFile(path.join(__dirname, 'linkswift', 'sweetalert2-theme-dark-5.0.26.min.css'), 'utf8'),
  };
  const setup = `(function(){
      if (window.__rainAlleyLinkSwiftBridge) return;
      window.__rainAlleyLinkSwiftBridge = true;
      window.__rainAlleyLinkSwiftStore = window.__rainAlleyLinkSwiftStore || Object.assign(Object.create(null), ${JSON.stringify(state)});
      window.__rainAlleyLinkSwiftResources = ${JSON.stringify(resources)};
      var seq = 0, pending = new Map();
      window.addEventListener('message', function(event){ var data = event && event.data; if (!data) return; if (data.__rainAlleyLinkSwiftStorageSync === true && typeof data.key === 'string') { if (data.action === 'delete') delete window.__rainAlleyLinkSwiftStore[data.key]; else if (data.action === 'set') Object.defineProperty(window.__rainAlleyLinkSwiftStore, data.key, {value:data.value, enumerable:true, configurable:true, writable:true}); return; } if (data.__rainAlleyLinkSwiftResponse !== true) return; var task = pending.get(data.id); if (!task) return; pending.delete(data.id); data.ok ? task.resolve(data.result) : task.reject(new Error(data.error || '请求失败')); });
      function request(options,onId){ return new Promise(function(resolve,reject){ var id = ++seq; if(onId) onId(id); pending.set(id,{resolve:resolve,reject:reject}); window.postMessage({__rainAlleyLinkSwiftRequest:true,id:id,options:options}, '*'); setTimeout(function(){ if(pending.has(id)){ pending.delete(id); reject(new Error('请求超时')); } }, 25000); }); }
      window.GM_info = { script: { author: 'hmjz100、油小猴', name: 'LinkSwift', version: '1.1.3', icon: '' }, scriptHandler: 'Rain Alley', version: '1.0' };
      window.GM_getValue = function(key, fallback){ return Object.prototype.hasOwnProperty.call(window.__rainAlleyLinkSwiftStore,key) ? window.__rainAlleyLinkSwiftStore[key] : fallback; };
      window.GM_setValue = function(key,value){ window.__rainAlleyLinkSwiftStore[key] = value; window.postMessage({__rainAlleyLinkSwiftStorage:true,action:'set',key:String(key),value:value}, '*'); };
      window.GM_deleteValue = function(key){ delete window.__rainAlleyLinkSwiftStore[key]; window.postMessage({__rainAlleyLinkSwiftStorage:true,action:'delete',key:String(key)}, '*'); };
      window.GM_setClipboard = function(value){ window.postMessage({__rainAlleyLinkSwiftClipboard:true,value:String(value||'')}, '*'); };
      window.GM_registerMenuCommand = function(){}; window.GM_openInTab = function(url){ window.open(String(url||''), '_blank'); }; window.GM_getResourceText = function(name){ return window.__rainAlleyLinkSwiftResources[String(name || '')] || ''; };
      window.GM_xmlhttpRequest = function(options){
        var callbacks = options || {}, aborted = false, settled = false, requestId = 0;
        var promise = request({url:callbacks.url,method:callbacks.method,headers:callbacks.headers,data:callbacks.data,responseType:callbacks.responseType}, function(id){requestId=id;});
        if (callbacks.onloadstart) callbacks.onloadstart({readyState: 1});
        promise.then(function(result){
          if (aborted || settled) return;
          settled = true;
          var payload = Object.assign({}, result, { responseText: result.responseText, responseHeaders: result.responseHeaders });
          if (result.responseBase64 && result.responseType === 'arraybuffer') {
            var raw = atob(result.responseBase64), bytes = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
            payload.response = bytes.buffer;
          } else if (result.responseBase64 && result.responseType === 'blob') {
            var encoded = atob(result.responseBase64), data = new Uint8Array(encoded.length);
            for (var j = 0; j < encoded.length; j += 1) data[j] = encoded.charCodeAt(j);
            var contentType = result.responseHeadersObject && (result.responseHeadersObject['content-type'] || result.responseHeadersObject['Content-Type']) || 'application/octet-stream';
            payload.response = new Blob([data], { type: contentType });
          } else payload.response = result.response;
          if (callbacks.onprogress) callbacks.onprogress({ loaded: result.responseText ? result.responseText.length : 0, total: result.responseText ? result.responseText.length : 0, lengthComputable: true });
          if (callbacks.onreadystatechange) callbacks.onreadystatechange(Object.assign({}, payload, { readyState: 2 }));
          if (aborted) return;
          if (result.responseType === 'text' && String(callbacks.responseType || '').toLowerCase() === 'json') { try { payload.response = JSON.parse(result.responseText); } catch { payload.response = null; } }
          if (callbacks.onreadystatechange) callbacks.onreadystatechange(Object.assign({}, payload, { readyState: 4 }));
          callbacks.onload && callbacks.onload(payload);
        }).catch(function(error){
          if (aborted || settled) return;
          settled = true;
          callbacks.onerror && callbacks.onerror({ error: String(error && error.message || error) });
        });
        return { abort:function(){ if(aborted || settled) return; aborted = true; settled = true; window.postMessage({__rainAlleyLinkSwiftAbort:true,id:requestId}, '*'); callbacks.onabort && callbacks.onabort({}); } };
      };
    })();
    window.__rainAlleyLinkSwiftInjected = true;`;
  const files = ['jquery-3.6.0.min.js', 'sweetalert2-11.4.8.min.js', 'md5-0.7.3.min.js', 'sha256-0.11.1.min.js', 'LinkSwift-1.1.3.user.js'];
  const scripts = [setup, ...await Promise.all(files.map((file) => fs.readFile(path.join(__dirname, 'linkswift', file), 'utf8')))];
  enableLinkSwiftContents(contents);
  try {
    await contents.executeJavaScript(scripts.join('\n'), true);
  } catch (cause) {
    abortLinkSwiftRequests(contents);
    throw cause;
  }
  return { injected: true, reused: false, provider: currentProvider.name, version: '1.1.3' };
}

ipcMain.handle('site:inject-linkswift', async (event, tabId) => {
  ensureTrusted(event);
  const view = websiteViews.get(tabId || activeWebsiteId);
  if (!view || event.sender !== windowRef?.webContents) throw new Error('请先打开网盘分享页。');
  let current;
  try { current = new URL(view.webContents.getURL()); } catch { throw new Error('当前网页地址无效。'); }
  const provider = providerFor(current);
  return injectLinkSwiftInto(view.webContents, provider);
});

ipcMain.handle('site:register-tab', (event, tabId) => { ensureTrusted(event); if (typeof tabId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(tabId)) throw new Error('网页标签地址无效。'); websiteTabIds.add(tabId); return true; });
ipcMain.handle('site:activate', (event, tabId) => { ensureTrusted(event); if (typeof tabId !== 'string') return null; return activateWebsiteTab(tabId); });
ipcMain.handle('site:open', async (event, value, approved, tabId) => { ensureTrusted(event); return openWebsite(value, approved === true, tabId); });
ipcMain.handle('site:open-external-protocol', async (event, value, approved) => {
  ensureTrusted(event);
  if (approved !== true) throw new Error('请先确认外部应用地址。');
  const url = externalProtocol(value, appState?.allowExternalProtocols);
  try { await shell.openExternal(url); } catch { throw new Error('未能打开对应应用，请确认电脑已安装该应用并注册此协议。'); }
  return true;
});
ipcMain.handle('site:set-bounds', (event, value, tabId) => { ensureTrusted(event); return websiteBounds(value, tabId); });
ipcMain.handle('site:close', (event, tabId) => { ensureTrusted(event); const result = closeWebsite(typeof tabId === 'string' ? tabId : ''); windowRef?.webContents.send('desktop:site-closed', { tabId }); return result; });
ipcMain.handle('site:clear-data', async (event) => {
  ensureTrusted(event);
  const siteSession = session.fromPartition('persist:rain-alley-sites');
  await Promise.all([siteSession.clearStorageData(), siteSession.clearCache(), siteSession.clearAuthCache()]);
  for (const view of websiteViews.values()) if (!view.webContents.isDestroyed()) view.webContents.reload();
  return true;
});
ipcMain.handle('site:reload', (event, tabId) => { ensureTrusted(event); const view = websiteViews.get(tabId || activeWebsiteId); if (view) return view.webContents.reload(); return false; });
ipcMain.handle('site:go-back', (event, tabId) => { ensureTrusted(event); const contents = websiteViews.get(tabId || activeWebsiteId)?.webContents; if (contents?.navigationHistory.canGoBack()) { contents.navigationHistory.goBack(); return true; } return false; });
ipcMain.handle('site:go-forward', (event, tabId) => { ensureTrusted(event); const contents = websiteViews.get(tabId || activeWebsiteId)?.webContents; if (contents?.navigationHistory.canGoForward()) { contents.navigationHistory.goForward(); return true; } return false; });

app.whenReady().then(async () => {
  try {
    await registerAppProtocol();
    const configPath = path.join(__dirname, 'cloudflare-config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const parsedApi = new URL(config.apiBaseUrl);
    if (parsedApi.protocol !== 'https:' || !ACCOUNT_API_HOSTS.has(parsedApi.hostname) || parsedApi.username || parsedApi.password || parsedApi.pathname !== '/') {
      throw new Error('Cloudflare API 地址必须是受信任的 HTTPS 账号服务域名。');
    }
    apiBaseUrl = parsedApi.toString().replace(/\/$/, '');
  } catch (cause) {
    console.error(`[cloudflare-config] ${String(cause?.message || 'missing').slice(0, 160)}`);
  }
  await loadAppState();
  await ensureDownloadDirectory();
  configureSiteSession();
  createWindow();
  app.on('activate', showHome);
}).catch((cause) => { console.error(`[startup-failed] ${String(cause?.message || 'unknown').slice(0, 180)}`); app.quit(); });

app.on('before-quit', () => { quitting = true; closeWebsite(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('second-instance', showHome);
