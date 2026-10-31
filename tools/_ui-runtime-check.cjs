const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(process.env.RAIN_ALLEY_TEST_SOURCE_ROOT || root);
const electron = path.resolve(process.env.RAIN_ALLEY_TEST_ELECTRON || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startLocalDownloadSite() {
  const http = require('node:http');
  const payload = Buffer.from('A'.repeat(16 * 1024));
  const slowPayload = Buffer.alloc(8 * 1024 * 1024, 0x42);
  const requests = [];
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url || '/', 'http://127.0.0.1');
    requests.push({ method: request.method, pathname, cookie: request.headers.cookie || '' });
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    if (pathname === '/') {
      const page = '<!doctype html><meta charset="utf-8"><a id="download" href="/download" download="runtime-check.txt">下载测试文件</a><script>document.querySelector("#download").click()</script>';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(page) });
      response.end(page);
      return;
    }
    if (pathname === '/cookie-page') {
      const page = '<!doctype html><meta charset="utf-8"><script>if (location.search.includes("seed")) { document.cookie="rainalley_test=active; SameSite=Lax"; localStorage.setItem("rainalley_test", "active"); history.replaceState(null, "", "/cookie-page"); } fetch("/cookie-check", { cache: "no-store" });</script>';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(page) });
      response.end(page);
      return;
    }
    if (pathname === '/cookie-check') { response.writeHead(204).end(); return; }
    if (pathname === '/download' || pathname === '/slow-download') {
      const body = pathname === '/slow-download' ? slowPayload : payload;
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${pathname === '/slow-download' ? 'runtime-slow-check.txt' : 'runtime-check.txt'}"`,
        'Content-Length': body.length,
      });
      let offset = 0;
      const chunkSize = pathname === '/slow-download' ? 64 * 1024 : 2048;
      let timer;
      const interval = pathname === '/slow-download' ? 180 : 80;
      const scheduleNext = () => { timer = setTimeout(sendChunk, interval); };
      const sendChunk = () => {
        if (response.destroyed || response.writableEnded) return;
        const nextOffset = Math.min(offset + chunkSize, body.length);
        const canContinue = response.write(body.subarray(offset, nextOffset));
        offset = nextOffset;
        if (offset === body.length) {
          clearTimeout(timer);
          response.end();
        } else if (!canContinue) {
          clearTimeout(timer);
          response.once('drain', scheduleNext);
        } else scheduleNext();
      };
      scheduleNext();
      response.once('close', () => clearTimeout(timer));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, requests };
}

async function waitForFile(filePath, message, expectedSize) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && (expectedSize === undefined || stat.size === expectedSize)) return;
    } catch { /* wait for Electron to create or finish writing the file */ }
    await sleep(100);
  }
  throw new Error(message);
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

async function freePort() {
  const net = require('node:net');
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createTestApp(base) {
  const appRoot = path.join(base, 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  for (const folder of ['src', 'assets']) fs.cpSync(path.join(sourceRoot, folder), path.join(appRoot, folder), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(appRoot, 'package.json'));

  const preloadPath = path.join(appRoot, 'src', 'preload.cjs');
  let preload = fs.readFileSync(preloadPath, 'utf8');
  const replacements = [
    ["resumeAccount: () => ipcRenderer.invoke('account:resume'),", "resumeAccount: async () => ({ username: 'RAINTEST', installedFeatures: ['street-postcard'] }),"],
    ["getComments: (featureId) => ipcRenderer.invoke('module:get-comments', featureId),", "getComments: async () => ({ comments: [] }),"],
    ["addComment: (featureId, body) => ipcRenderer.invoke('module:add-comment', { featureId, body }),", "addComment: async (_featureId, body) => ({ comment: { username: 'RAINTEST', body, createdAt: Math.floor(Date.now() / 1000) } }),"],
    ["getPublicProfile: (username) => ipcRenderer.invoke('profile:get-public', username),", "getPublicProfile: async (username) => ({ account: { username, createdAt: 1790000000 }, profile: username.toLowerCase() === 'raintest' ? { displayName: '测试来客', bio: '用于窗口运行检查。', html: '<h2>自己的页面</h2><p>公开资料预览。</p>', css: '' } : { displayName: '另一位来客', bio: '只读资料。', html: '<p>访客页面</p>', css: '' } }),"],
    ["savePublicProfile: (profile) => ipcRenderer.invoke('profile:save-own', profile),", "savePublicProfile: async (profile) => ({ profile }),"],
    ["updateAccount: (value) => ipcRenderer.invoke('account:update', value),", "updateAccount: async (value) => ({ username: value.newUsername || 'RAINTEST' }),"],
    ["chooseDownloadDirectory: () => ipcRenderer.invoke('downloads:choose-directory'),", "chooseDownloadDirectory: async () => 'C:\\\\Users\\\\RAINTEST\\\\Downloads',"],
    ["registerWebsiteTab: (tabId) => ipcRenderer.invoke('site:register-tab', tabId),", "registerWebsiteTab: async () => true,"],
    ["activateWebsiteTab: (tabId) => ipcRenderer.invoke('site:activate', tabId),", "activateWebsiteTab: async (tabId) => ({ id: tabId, url: '', title: '新标签页', canGoBack: false, canGoForward: false }),"],
    ["closeWebsite: (tabId) => ipcRenderer.invoke('site:close', tabId),", "closeWebsite: async () => true,"],
    ["openWebsite: (url, approvedByUser = false, tabId) => ipcRenderer.invoke('site:open', url, approvedByUser === true, tabId),", "openWebsite: async (url, approvedByUser = false, tabId) => url.startsWith('http://127.0.0.1:') ? ipcRenderer.invoke('site:open', url, approvedByUser === true, tabId) : ({ id: tabId, url, title: new URL(url).hostname, canGoBack: false, canGoForward: false, loading: false }),"],
    ["setWebsiteBounds: (bounds, tabId) => ipcRenderer.invoke('site:set-bounds', bounds, tabId),", "setWebsiteBounds: async () => true,"],
    ["reloadWebsite: (tabId) => ipcRenderer.invoke('site:reload', tabId),", "reloadWebsite: async () => true,"],
    ["goBackWebsite: (tabId) => ipcRenderer.invoke('site:go-back', tabId),", "goBackWebsite: async () => false,"],
    ["goForwardWebsite: (tabId) => ipcRenderer.invoke('site:go-forward', tabId),", "goForwardWebsite: async () => false,"],
    ["openDownloadDirectory: () => ipcRenderer.invoke('downloads:open-directory'),", "openDownloadDirectory: async () => true,"],
    ["copyText: (value) => ipcRenderer.invoke('clipboard:write', value),", "copyText: async (value) => { const result = await ipcRenderer.invoke('clipboard:write', value); globalThis.__runtimeCopiedText = String(value); return result; },\n  readRuntimeCopiedText: () => globalThis.__runtimeCopiedText || '',"],
  ];
  for (const [from, to] of replacements) {
    assert.ok(preload.includes(from), `runtime mock hook missing: ${from.slice(0, 36)}`);
    preload = preload.replace(from, to);
  }
  fs.writeFileSync(preloadPath, preload, 'utf8');
  return appRoot;
}

function createCdp(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP command failed'));
      else resolve(message.result || {});
    }
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`DevTools timed out: ${method}`));
        }, 30000).unref?.();
      });
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    },
  };
}

async function waitForTarget(port, processRef) {
  const deadline = Date.now() + 30000;
  let lastError;
  let observed = [];
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) throw new Error(`Electron exited during startup (${processRef.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      observed = targets.map(({ type, url }) => ({ type, url }));
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) { lastError = error; }
    await sleep(200);
  }
  throw new Error(`Electron DevTools did not become available: ${lastError?.message || 'timeout'}; targets: ${JSON.stringify(observed)}`);
}

async function connectCdp(port, processRef) {
  const target = await waitForTarget(port, processRef);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Electron DevTools.')), { once: true });
  });
  const cdp = createCdp(socket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { cdp, socket };
}

async function waitFor(cdp, expression, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(message);
}

function assertResult(condition, message) { assert.ok(condition, message); }

async function testInterface(appRoot, base) {
  const userData = path.join(base, 'user-data-interface');
  const downloadDirectory = path.join(base, 'verified-downloads');
  fs.mkdirSync(downloadDirectory, { recursive: true });
  let localSite;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify({
    navigationPolicy: 'allowlist', allowedHosts: ['127.0.0.1'], blockedHosts: [],
    allowHttp: true, allowLocalNetwork: true, downloadsEnabled: true,
    downloadDirectory,
  }), 'utf8');
  const port = await freePort();
  const processRef = spawn(electron, [appRoot, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${userData}`], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: path.dirname(electron), RAIN_ALLEY_TEST_MODE: '1' },
  });
  let output = '';
  processRef.stdout.on('data', (chunk) => { output += chunk.toString(); });
  processRef.stderr.on('data', (chunk) => { output += chunk.toString(); });
  let socket;
  try {
    const connected = await connectCdp(port, processRef);
    const { cdp } = connected; socket = connected.socket;
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'The desktop app did not reach its authenticated home page.');

    const home = await cdp.evaluate(`(() => ({
      title: document.title,
      profile: document.querySelector('#headerAccount')?.textContent,
      address: document.querySelector('#appAddressInput')?.value,
      envelopes: document.querySelectorAll('#sceneFeatureRail [data-feature-id]').length,
       featureTotal: Number(document.querySelector('#heroFeatureCount')?.textContent.split('/').at(-1)),
      loadMoreHidden: document.querySelector('#homeLoadMore')?.hidden,
      gridDisplay: getComputedStyle(document.querySelector('#sceneFeatureRail')).display,
      gridOverflowX: getComputedStyle(document.querySelector('#sceneFeatureRail')).overflowX,
      gridScrollsHorizontally: document.querySelector('#sceneFeatureRail').scrollWidth > document.querySelector('#sceneFeatureRail').clientWidth + 1,
      envelopeRects: [...document.querySelectorAll('#sceneFeatureRail .home-envelope')].map((card) => {
        const art = card.querySelector('.home-envelope-art').getBoundingClientRect();
        const copy = card.querySelector('.home-envelope-copy').getBoundingClientRect();
        const status = card.querySelector('.hero-feature-status').getBoundingClientRect();
        return { artBottom: Math.round(art.bottom), copyTop: Math.round(copy.top), copyBottom: Math.round(copy.bottom), statusTop: Math.round(status.top) };
      }),
      readingFont: getComputedStyle(document.querySelector('.envelope-home-heading p')).fontSize,
      addressFont: getComputedStyle(document.querySelector('#appAddressInput')).fontSize,
      pageAccentColors: getComputedStyle(document.querySelector('.topbar'), '::after').backgroundImage.split('rgb(').length - 1,
      authAccentColors: getComputedStyle(document.querySelector('.auth-window-bar'), '::after').backgroundImage.split('rgb(').length - 1,
      darkPalette: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#000000'
        && getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() === '#ffffff'
        && document.querySelector('meta[name="theme-color"]').content === '#000000',
      addressInputCount: document.querySelectorAll('#appAddressInput').length,
       duplicateSiteAddressHidden: !document.querySelector('.site-origin'),
      drag: getComputedStyle(document.querySelector('.window-actions')).webkitAppRegion,
      dragWidth: Math.round(document.querySelector('.window-actions').getBoundingClientRect().width),
      windowButtons: document.querySelectorAll('.window-actions > button').length,
    }))()`);
    assertResult(home.title.includes('雨巷来信'), 'App title missing.');
    assertResult(home.address === 'rainalley://app/home', `Home route is wrong: ${home.address}`);
    assertResult(home.envelopes === 6 && home.envelopes < home.featureTotal && !home.loadMoreHidden, `The home page did not start with a limited batch: ${home.envelopes}/${home.featureTotal}.`);
    assertResult(home.gridDisplay === 'grid' && !home.gridScrollsHorizontally && ['visible', 'clip'].includes(home.gridOverflowX), 'The home works are not shown in a vertical card grid.');
    assertResult(home.envelopeRects.every((rect) => rect.artBottom <= rect.copyTop && rect.copyBottom <= rect.statusTop), `Envelope artwork, text and status overlap: ${JSON.stringify(home.envelopeRects)}`);
    assertResult(home.readingFont === '15px', `Home description text remains too small: ${home.readingFont}.`);
    assertResult(home.addressFont === '14px', `The top address text remains too small: ${home.addressFont}.`);
    assertResult(home.darkPalette, 'The dark theme does not use a neutral black-and-white palette.');
    assertResult(home.pageAccentColors >= 4 && home.authAccentColors >= 4, `The application pages do not retain the four-color accent system: ${JSON.stringify({ page: home.pageAccentColors, auth: home.authAccentColors })}`);
    assertResult(home.addressInputCount === 1 && home.duplicateSiteAddressHidden, 'A second embedded site address is visible.');
    assertResult(home.drag === 'drag' && home.dragWidth >= 120 && home.windowButtons >= 4, 'The window controls are not in the draggable title bar.');

    await cdp.evaluate("const page = document.querySelector('#sceneHomePage'); page.scrollTop = page.scrollHeight; page.dispatchEvent(new Event('scroll'));");
    await waitFor(cdp, "document.querySelectorAll('#sceneFeatureRail [data-feature-id]').length > 6", 'Scrolling the home page did not progressively load more works.');
    while (await cdp.evaluate("!document.querySelector('#homeLoadMore').hidden")) {
      await cdp.evaluate("document.querySelector('#homeLoadMore').click()");
    }
    const loadedHome = await cdp.evaluate("({ count: document.querySelectorAll('#sceneFeatureRail [data-feature-id]').length, done: document.querySelector('#homeLoadMore')?.hidden })");
    assertResult(loadedHome.count === home.featureTotal && loadedHome.done, 'Progressive home loading did not finish cleanly.');

    const openedEnvelopeId = await cdp.evaluate("document.querySelector('#sceneFeatureRail [data-feature-id]')?.dataset.featureId");
    await cdp.evaluate("document.querySelector('#sceneFeatureRail [data-feature-id]').click()");
    await waitFor(cdp, "document.querySelector('#sceneFeatureRail .home-envelope.is-opening')", 'Opening a tool envelope did not play the opening motion.');
    await cdp.evaluate('window.__envelopeRuntimeStarted = performance.now()');
    await sleep(450);
    const envelopeMotion = await cdp.evaluate(`(() => {
      const card = document.querySelector('#sceneFeatureRail [data-envelope-id]');
      const art = card?.querySelector('.home-envelope-art');
      return { page: document.body.dataset.page, opening: card?.classList.contains('is-opening'),
        elapsed: Math.round(performance.now() - window.__envelopeRuntimeStarted), duration: card && getComputedStyle(card).animationDuration,
        animation: card && getComputedStyle(card).animationName, cardOverflow: card && getComputedStyle(card).overflow,
        artOverflow: art && getComputedStyle(art).overflow, letter: art?.querySelector('.envelope-letter')?.getBoundingClientRect().top,
        artTop: art?.getBoundingClientRect().top };
    })()`);
    assertResult(envelopeMotion.page === 'scene' && envelopeMotion.opening && envelopeMotion.cardOverflow === 'visible' && envelopeMotion.artOverflow === 'visible'
      && envelopeMotion.letter < envelopeMotion.artTop, `The envelope transition did not reveal the raised letter before navigation: ${JSON.stringify(envelopeMotion)}`);
    await waitFor(cdp, "document.body.dataset.page === 'detail'", 'Opening a tool envelope did not reach its detail page.');
    await cdp.evaluate("document.querySelector('#homeBrowserTab').click()");
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'The home tab did not return after opening an envelope.');

    await cdp.evaluate("document.querySelector('#sceneFeatureRail [data-favorite-id]').click()");
    await waitFor(cdp, "document.querySelector('#sceneFeatureRail .home-envelope.is-opening')", 'Favoriting an envelope did not play the opening motion.');
    await waitFor(cdp, "window.alleyDesktop.getState().then((state) => state.preferences.favorites.length === 1)", 'The home envelope favorite did not persist.');
    await cdp.evaluate("document.querySelector('#openCollectionButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'collection'", 'Favorites page did not open.');
    const collection = await cdp.evaluate(`(() => {
      const list = document.querySelector('#featureGrid');
      const tabs = document.querySelector('.catalog-tabs');
      return { address: document.querySelector('#appAddressInput').value, count: list.querySelectorAll('[data-envelope-id]').length,
        listOverflowY: getComputedStyle(list).overflowY, listOverflowX: getComputedStyle(list).overflowX,
        tabsOverflowY: getComputedStyle(tabs).overflowY, pageOverflowY: getComputedStyle(document.querySelector('#collectionPage')).overflowY,
        visibleVerticalScrollbar: list.clientWidth < list.offsetWidth || tabs.clientWidth < tabs.offsetWidth };
    })()`);
    assertResult(collection.address === 'rainalley://app/favorites', `Favorites route is wrong: ${collection.address}`);
    assertResult(collection.count === 1, `Expected one favorite envelope, got ${collection.count}.`);
    assertResult(collection.listOverflowY === 'auto' && collection.tabsOverflowY === 'hidden', 'The envelope directory does not use vertical scrolling.');
    assertResult(collection.listOverflowX === 'hidden', 'The envelope directory unexpectedly scrolls horizontally.');

    await cdp.evaluate("document.querySelector('#historyModeButton').click()");
    await waitFor(cdp, "document.querySelector('#appAddressInput').value === 'rainalley://app/history'", 'History address did not update.');
    const history = await cdp.evaluate("({ count: document.querySelectorAll('#featureGrid [data-envelope-id]').length, unique: new Set([...document.querySelectorAll('#featureGrid [data-envelope-id]')].map((item) => item.dataset.envelopeId)).size })");
    assertResult(history.count === 1 && history.unique === 1, 'History did not de-duplicate a favorite event.');

    await cdp.evaluate("document.querySelector('#allFeaturesModeButton').click()");
    await waitFor(cdp, "document.querySelector('#appAddressInput').value.startsWith('rainalley://app/catalog')", 'All catalog route did not update.');
    const catalogInitialBatch = await cdp.evaluate("({ count: document.querySelectorAll('#featureGrid [data-envelope-id]').length, total: Number(document.querySelector('.catalog-tabs [data-filter=all] .tab-count').textContent) })");
    assertResult(catalogInitialBatch.count < catalogInitialBatch.total, `The catalog rendered every item at once: ${JSON.stringify(catalogInitialBatch)}`);
    await cdp.evaluate("document.querySelector('#featureGrid').dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }))");
    await waitFor(cdp, "document.querySelectorAll('#featureGrid [data-envelope-id]').length > 6", 'Wheel did not append a catalog batch.');
    while (await cdp.evaluate("!document.querySelector('#catalogPagination').hidden")) {
      await cdp.evaluate("document.querySelector('#catalogPagination button').click()");
    }
    await waitFor(cdp, "document.querySelectorAll('#featureGrid [data-envelope-id]').length === Number(document.querySelector('.catalog-tabs [data-filter=all] .tab-count').textContent)", 'Scrolling down did not append the remaining catalog envelopes.');
    await cdp.evaluate("document.querySelector('.catalog-tabs [data-filter=website]').click()");
    await waitFor(cdp, "document.querySelector('#appAddressInput').value === 'rainalley://app/catalog?category=website'", 'Category route did not retain its query.');
    const catalog = await cdp.evaluate(`(() => { const list = document.querySelector('#featureGrid'); return {
      route: document.querySelector('#appAddressInput').value, count: list.querySelectorAll('[data-envelope-id]').length,
      ids: [...list.querySelectorAll('[data-envelope-id]')].map((item) => item.dataset.envelopeId),
      overflowY: getComputedStyle(list).overflowY, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth
    } })()`);
    assertResult(catalog.ids.length > 0 && catalog.overflowY === 'auto', 'Filtered envelope list layout is invalid.');
    await cdp.evaluate("document.querySelector('#featureGrid [data-feature-id=\"pig-daily\"]').click()");
    await waitFor(cdp, "document.body.dataset.page === 'site' && document.querySelector('#sitePlaceholder').hidden", 'The embedded website page did not open.');
    const initialSiteHistory = await cdp.evaluate("({ back: document.querySelector('#addressBack').disabled, forward: document.querySelector('#addressForward').disabled })");
    assertResult(initialSiteHistory.back && initialSiteHistory.forward, 'Web navigation controls did not follow the active tab history state.');
    const siteLayout = await cdp.evaluate("(() => { const shell = document.querySelector('#siteFrameShell').getBoundingClientRect(); return { addressCount: document.querySelectorAll('#appAddressInput').length, hasLegacySiteAddress: Boolean(document.querySelector('.site-origin')), shellBottom: Math.round(shell.bottom), viewportBottom: innerHeight }; })()");
    assertResult(siteLayout.addressCount === 1 && !siteLayout.hasLegacySiteAddress, 'The embedded site address is repeated below the top bar.');
    assertResult(Math.abs(siteLayout.shellBottom - siteLayout.viewportBottom) <= 2, `The website does not fill the content area below the address bar: ${JSON.stringify(siteLayout)}`);
    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'https://unknown.example/path'; document.querySelector('#addressForm').requestSubmit()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden", 'An unknown external host did not request approval.');
    await cdp.evaluate("document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, "document.body.dataset.page === 'site' && document.querySelector('#websiteTabs .browser-tab.is-active .browser-tab-label span')?.textContent === 'unknown.example'", 'A manually entered website did not open in its own tab.');
    const externalAddress = await cdp.evaluate("({ address: document.querySelector('#appAddressInput').value, title: document.querySelector('#websiteTabs .browser-tab.is-active .browser-tab-label span')?.textContent, lowerText: document.querySelector('.site-page').innerText, hiddenAddress: !document.querySelector('.site-origin'), tabCount: document.querySelectorAll('#websiteTabs .browser-tab').length })");
    assertResult(externalAddress.address === 'https://unknown.example/path' && externalAddress.title === 'unknown.example' && !externalAddress.lowerText.includes('unknown.example') && externalAddress.hiddenAddress && externalAddress.tabCount === 1, `The external page tab or compact address layout is wrong: ${JSON.stringify(externalAddress)}`);

    await cdp.evaluate("document.querySelector('#newBrowserTabButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'new-tab' && document.querySelectorAll('#websiteTabs .browser-tab').length === 2", 'A blank browser tab was not created and selected.');
    const blankTabId = await cdp.evaluate("document.querySelector('#websiteTabs .browser-tab.is-active [data-close-browser-tab]').dataset.closeBrowserTab");
    assertResult(await cdp.evaluate("document.querySelector('#appAddressInput').value === '' && document.querySelector('#addressBack').disabled && document.querySelector('#addressForward').disabled && document.querySelector('#addressRefresh').disabled"), 'A new tab did not start with an editable blank address and disabled history controls.');
    const externalTabId = await cdp.evaluate("[...document.querySelectorAll('#websiteTabs [data-browser-tab]')].find((button) => button.textContent.trim() === 'unknown.example')?.dataset.browserTab");
    await cdp.evaluate(`document.querySelector('[data-browser-tab="${externalTabId}"]').click()`);
    await waitFor(cdp, "document.body.dataset.page === 'site' && document.querySelector('#appAddressInput').value === 'https://unknown.example/path'", 'Switching back to the website tab did not restore its address.');
    await cdp.evaluate(`document.querySelector('[data-close-browser-tab="${blankTabId}"]').click()`);
    await waitFor(cdp, "document.querySelectorAll('#websiteTabs .browser-tab').length === 1 && document.body.dataset.page === 'site'", 'Closing the active blank tab did not select the neighboring website tab.');

    await cdp.evaluate("Array.from({length: 11}, () => document.querySelector('#newBrowserTabButton').click())");
    await waitFor(cdp, "document.querySelectorAll('#websiteTabs .browser-tab').length === 12", 'The browser tab strip could not create more than ten tabs.');
    const manyTabs = await cdp.evaluate("(() => { const scroll = document.querySelector('#websiteTabs'); const names = [...scroll.querySelectorAll('.browser-tab-label span')].map((item) => item.textContent); const tab = scroll.querySelector('.browser-tab'); const rect = tab?.getBoundingClientRect(); const topbar = document.querySelector('.topbar').getBoundingClientRect(); return { overflowX: getComputedStyle(scroll).overflowX, scrollable: scroll.scrollWidth > scroll.clientWidth, shortest: Math.min(...names.map((name) => [...name].length)), controlsPresent: Boolean(document.querySelector('#newBrowserTabButton')), before: rect?.width, x: rect?.x + rect?.width / 2, y: topbar.y + topbar.height / 2 }; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: manyTabs.x, y: manyTabs.y });
    manyTabs.after = await cdp.evaluate("document.querySelector('#websiteTabs .browser-tab')?.getBoundingClientRect().width");
    assertResult(manyTabs.overflowX === 'auto' && manyTabs.scrollable && manyTabs.shortest <= 8 && manyTabs.controlsPresent, `Many browser tabs did not compact and scroll as needed: ${JSON.stringify(manyTabs)}`);
    assertResult(Math.abs(manyTabs.before - manyTabs.after) < 1, `A tab changed width on hover, moving its close button: ${JSON.stringify(manyTabs)}`);
    await cdp.evaluate("(async () => { while (document.querySelector('#websiteTabs [data-close-browser-tab]')) { document.querySelector('#websiteTabs [data-close-browser-tab]').click(); await new Promise((resolve) => setTimeout(resolve, 35)); } })()");
    await waitFor(cdp, "document.querySelectorAll('#websiteTabs .browser-tab').length === 0", 'The overflow test tabs could not all be closed.');
    await cdp.evaluate("document.querySelector('#newBrowserTabButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'new-tab' && document.querySelectorAll('#websiteTabs .browser-tab').length === 1", 'A fresh browser tab was unavailable after closing the overflow set.');
    const localDownloadTabId = await cdp.evaluate("document.querySelector('#websiteTabs .browser-tab.is-active [data-close-browser-tab]').dataset.closeBrowserTab");
    localSite = await startLocalDownloadSite();
    await cdp.evaluate(`document.querySelector('#appAddressInput').value = 'http://127.0.0.1:${localSite.port}/'; document.querySelector('#addressForm').requestSubmit()`);
    await waitFor(cdp, "document.body.dataset.page === 'site' && document.querySelector('#sitePlaceholder').hidden", 'The local download test page did not load in an embedded website tab.');
    await waitFor(cdp, "document.querySelector('#downloadIndicator') && !document.querySelector('#downloadIndicator').hidden", 'Starting a website download did not show active download feedback.');
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('正在下载')", 'Starting a website download did not announce its filename.');
    const downloadedFile = path.join(downloadDirectory, 'runtime-check.txt');
    await waitForFile(downloadedFile, 'The website download was not written to the selected download folder.', 16 * 1024);
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('下载完成') && document.querySelector('#downloadIndicator').hidden", 'Finishing a website download did not show completion feedback.');
    assert.equal(fs.readFileSync(downloadedFile, 'utf8'), 'A'.repeat(16 * 1024), 'The downloaded file did not contain the served content.');
    assertResult(localSite.requests.some(({ method, pathname }) => method === 'GET' && pathname === '/download'), 'The local webpage did not request its download endpoint.');
    assert.equal(await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => preferences.downloadsEnabled && preferences.downloadDirectory)") , downloadDirectory, 'The download did not use the persisted selected directory.');
    await cdp.evaluate(`document.querySelector('#appAddressInput').value = 'http://127.0.0.1:${localSite.port}/slow-download'; document.querySelector('#addressForm').requestSubmit()`);
    await waitFor(cdp, "document.querySelector('#downloadIndicator') && !document.querySelector('#downloadIndicator').hidden", 'The slow download did not start.');
    await sleep(700);
    const slowDownloadState = await cdp.evaluate("window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt') || null)");
    assertResult(slowDownloadState && slowDownloadState.received > 0 && ['started', 'progress'].includes(slowDownloadState.status), `The slow download did not report real transfer progress: ${JSON.stringify(slowDownloadState)}`);
    await cdp.evaluate("document.querySelector('#downloadFolderButton').click()");
    await waitFor(cdp, "!document.querySelector('#downloadsOverlay').hidden && document.querySelector('[data-download-action=\"pause\"]')", 'The active download did not expose a pause action.');
    const pauseState = await cdp.evaluate("({ row: document.querySelector('.download-row')?.innerText, actions: [...document.querySelectorAll('[data-download-action]')].map((button) => button.dataset.downloadAction), item: window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt')) })");
    assertResult(await cdp.evaluate("Boolean(document.querySelector('[data-download-action=\"pause\"]'))"), `The active download lost its pause action before click: ${JSON.stringify(pauseState)}`);
    await cdp.evaluate("document.querySelector('[data-download-action=\"pause\"]')?.click()");
    await waitFor(cdp, "window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt')?.status === 'paused')", 'Pausing the download did not change its actual state.');
    const pausedBytes = await cdp.evaluate("window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt')?.received)");
    await sleep(550);
    const stillPausedBytes = await cdp.evaluate("window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt')?.received)");
    assertResult(pausedBytes === stillPausedBytes, `The paused download continued receiving bytes: ${pausedBytes} -> ${stillPausedBytes}.`);
    await cdp.evaluate("document.querySelector('[data-download-action=\"resume\"]').click()");
    await waitFor(cdp, `window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt')?.received > ${stillPausedBytes})`, 'Resuming the download did not advance its received byte count.');
    await cdp.evaluate("document.querySelector('[data-download-action=\"cancel\"]').click()");
    await waitFor(cdp, "window.alleyDesktop.listDownloads().then((items) => items.find((item) => item.name === 'runtime-slow-check.txt')?.status === 'cancelled')", 'Cancelling the download did not end the actual transfer.');
    await cdp.evaluate("document.querySelector('#downloadsClose').click()");
    await cdp.evaluate("document.querySelector('#downloadFolderButton').click()");
    await waitFor(cdp, "!document.querySelector('#downloadsOverlay').hidden", 'The download history did not open over an embedded website.');
    const downloadClosePoint = await cdp.evaluate("(() => { const rect = document.querySelector('#downloadsClose').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: downloadClosePoint.x, y: downloadClosePoint.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: downloadClosePoint.x, y: downloadClosePoint.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: downloadClosePoint.x, y: downloadClosePoint.y, button: 'left', clickCount: 1 });
    await waitFor(cdp, "document.querySelector('#downloadsOverlay').hidden", 'The download history controls were blocked by the embedded website view.');
    await cdp.evaluate("document.querySelector('#newBrowserTabButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'new-tab' && document.querySelectorAll('#websiteTabs .browser-tab').length === 2", 'A webpage tab could not be added after the download completed.');
    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'https://unknown.example/path'; document.querySelector('#addressForm').requestSubmit(); document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, "document.body.dataset.page === 'site' && document.querySelector('#appAddressInput').value === 'https://unknown.example/path'", 'The webpage tab could not be restored for bookmark checks.');
    await cdp.evaluate(`document.querySelector('[data-close-browser-tab="${localDownloadTabId}"]').click()`);
    await waitFor(cdp, "document.querySelectorAll('#websiteTabs .browser-tab').length === 1", 'Closing the completed download tab did not leave the other webpage tab open.');
    await cdp.evaluate("document.querySelector('#siteBookmarkButton').click()");
    await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => preferences.webBookmarks.some((item) => item.url === 'https://unknown.example/path'))", 'The current webpage was not added to web bookmarks.');
    await cdp.evaluate("document.querySelector('#collectionBrowserTab').click()");
    await waitFor(cdp, "document.body.dataset.page === 'collection'", 'The fixed collection tab did not open.');
    await cdp.evaluate("document.querySelector('#webBookmarksModeButton').click()");
    await waitFor(cdp, "document.querySelector('#appAddressInput').value === 'rainalley://app/web-bookmarks' && document.querySelector('#featureGrid [data-bookmark-open]')", 'The webpage bookmark directory did not open.');
    const webBookmark = await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => ({ button: document.querySelector('#siteBookmarkButton').textContent.trim(), title: document.querySelector('#featureGrid .web-bookmark-envelope strong')?.textContent, url: document.querySelector('#featureGrid [data-bookmark-open]')?.dataset.bookmarkOpen, persistedCount: preferences.webBookmarks.length, envelope: document.querySelector('#featureGrid .web-bookmark-envelope .envelope-paper') !== null }))");
    assertResult(webBookmark.url === 'https://unknown.example/path' && webBookmark.title === 'unknown.example' && webBookmark.persistedCount === 1 && webBookmark.envelope, `The webpage bookmark was not rendered or persisted as an envelope: ${JSON.stringify(webBookmark)}`);
    const beforeBookmarkOpen = await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => preferences.webBookmarks[0].lastUsedAt)");
    await cdp.evaluate("document.querySelector('#featureGrid [data-bookmark-open]').click()");
    await waitFor(cdp, "document.body.dataset.page === 'site' && document.querySelector('#appAddressInput').value === 'https://unknown.example/path'", 'Opening the saved webpage did not return to its site.');
    await waitFor(cdp, `window.alleyDesktop.getState().then(({preferences}) => preferences.webBookmarks[0].lastUsedAt > ${beforeBookmarkOpen})`, 'Opening a web bookmark did not update its recent-use time.');
    await cdp.evaluate("document.querySelector('#collectionBrowserTab').click()");
    await waitFor(cdp, "document.body.dataset.page === 'collection'", 'The collection tab did not return before deleting a bookmark.');
    await cdp.evaluate("document.querySelector('#webBookmarksModeButton').click(); document.querySelector('#featureGrid [data-bookmark-delete]').click()");
    await waitFor(cdp, "!document.querySelector('#featureGrid [data-bookmark-delete]')", 'Deleting a webpage bookmark did not remove it.');
    const persistedBookmarks = JSON.parse(fs.readFileSync(path.join(base, 'user-data-interface', 'preferences.json'), 'utf8')).webBookmarks;
    assertResult(Array.isArray(persistedBookmarks) && persistedBookmarks.length === 0, 'Web bookmark changes were not saved to Electron user data.');

    await cdp.evaluate("document.querySelector('#profileBrowserTab').click()");
    try {
      await waitFor(cdp, "document.body.dataset.page === 'profile' && !document.querySelector('#profileEditor').hidden", 'The owner profile page did not open in editable mode.');
    } catch (error) {
      const diagnostic = await cdp.evaluate("({ page: document.body.dataset.page, username: document.querySelector('#headerAccount')?.textContent, ownerBadge: document.querySelector('#profileOwnerBadge')?.textContent, editorHidden: document.querySelector('#profileEditor')?.hidden, profileTitle: document.querySelector('#profileTitle')?.textContent, errorText: document.querySelector('#profileBio')?.textContent })");
      throw new Error(`${error.message} ${JSON.stringify(diagnostic)}`);
    }
    const ownProfile = await cdp.evaluate("({ address: document.querySelector('#appAddressInput').value, title: document.querySelector('#profileTitle').textContent, fact: document.querySelector('#profileFact').textContent, editor: !document.querySelector('#profileEditor').hidden })");
    assertResult(ownProfile.address === 'rainalley://app/profile/RAINTEST' && ownProfile.editor && ownProfile.fact.includes('RAINTEST'), 'The owner profile does not show account facts and edit controls.');
    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'rainalley://app/profile/OTHERUSER'; document.querySelector('#addressForm').requestSubmit()");
    await waitFor(cdp, "document.querySelector('#profileTitle').textContent === '另一位来客'", 'The visitor profile did not load.');
    assertResult(await cdp.evaluate("document.querySelector('#profileEditor').hidden"), 'A visitor was allowed to edit another player profile.');

    await cdp.evaluate("document.querySelector('#newBrowserTabButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'new-tab'", 'A website tab could not be created for cookie cleanup verification.');
    await cdp.evaluate(`document.querySelector('#appAddressInput').value = 'http://127.0.0.1:${localSite.port}/cookie-page?seed'; document.querySelector('#addressForm').requestSubmit()`);
    await waitFor(cdp, "document.body.dataset.page === 'site'", 'The cookie test page did not open.');
    const cookieDeadline = Date.now() + 5000;
    while (Date.now() < cookieDeadline && !localSite.requests.some(({ pathname, cookie }) => pathname === '/cookie-check' && cookie.includes('rainalley_test=active'))) await sleep(50);
    assertResult(localSite.requests.some(({ pathname, cookie }) => pathname === '/cookie-check' && cookie.includes('rainalley_test=active')), 'The cookie test page did not establish its website login state.');
    await cdp.evaluate("document.querySelector('#settingsButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'settings'", 'Settings page did not open.');
    assertResult(await cdp.evaluate("Boolean(document.querySelector('#clearBrowserDataButton') && document.querySelector('#clearAppDataButton'))"), 'Settings did not expose the browser and full app data clearing actions.');
    await cdp.evaluate("document.querySelector('#clearBrowserDataButton').click()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden && document.querySelector('#siteWarningTitle').textContent === '清除网页浏览数据'", 'The browser-data clearing confirmation did not open.');
    const cookieCheckCount = localSite.requests.filter(({ pathname }) => pathname === '/cookie-check').length;
    await cdp.evaluate("document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('网页登录状态和浏览数据已清除')", 'The browser-data clearing operation did not complete.');
    const clearedCookieDeadline = Date.now() + 5000;
    while (Date.now() < clearedCookieDeadline && localSite.requests.filter(({ pathname }) => pathname === '/cookie-check').length <= cookieCheckCount) await sleep(50);
    const postClearCookieChecks = localSite.requests.filter(({ pathname }) => pathname === '/cookie-check').slice(cookieCheckCount);
    assertResult(postClearCookieChecks.length > 0 && postClearCookieChecks.every(({ cookie }) => !cookie.includes('rainalley_test=active')), `The website sent its old login cookie after clearing browser data: ${JSON.stringify(postClearCookieChecks)}`);
    await cdp.evaluate("document.querySelector('#clearAppDataButton').click()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden && document.querySelector('#siteWarningTitle').textContent === '清除雨巷来信应用数据' && document.querySelector('#siteWarningText').textContent.includes('已下载文件') && document.querySelector('#siteWarningText').textContent.includes('会保留')", 'The full app-data confirmation did not explain that downloaded files are preserved.');
    await cdp.evaluate("document.querySelector('#siteWarningCancel').click()");
    await waitFor(cdp, "document.querySelector('#accountDisplayNameSetting').value === '测试来客'", 'The own display name did not load in account settings.');
    await cdp.evaluate(`(() => {
      document.querySelector('#accountDisplayNameSetting').value = '窗口检查来客';
      document.querySelector('#saveDisplayNameButton').click();
    })()`);
    await waitFor(cdp, "document.querySelector('#displayNameSaveStatus').textContent.includes('已保存')", 'The display name could not be saved.');
    await cdp.evaluate(`(() => {
      document.querySelector('#accountUsernameSetting').value = 'RAINTEST2';
      document.querySelector('#accountCurrentPasswordSetting').value = 'CurrentPassword#123';
      document.querySelector('#accountNewPasswordSetting').value = 'NewPassword#1234';
      document.querySelector('#accountConfirmPasswordSetting').value = 'NewPassword#1234';
      document.querySelector('#saveAccountButton').click();
    })()`);
    await waitFor(cdp, "document.querySelector('#accountSaveStatus').textContent.includes('已更新')", 'The account name and password change flow did not complete.');
    assertResult(await cdp.evaluate("document.querySelector('#accountUsernameSetting').value === 'RAINTEST2' && document.querySelector('#accountCurrentPasswordSetting').value === '' && document.querySelector('#accountNewPasswordSetting').value === ''"), 'Updated account fields or password clearing are incorrect.');
    await cdp.evaluate(`(() => {
      const change = (selector, value) => {
        const element = document.querySelector(selector);
        if (element.type === 'checkbox') element.checked = value; else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      change('#themeSelect', 'light');
      change('#navigationPolicySetting', 'blocklist');
      change('#allowedHostsSetting', 'pig.600318.xyz\\nexample.org');
      change('#blockedHostsSetting', 'blocked.example\\nsub.blocked.example');
      change('#downloadBaseUrlSetting', 'https://example.org/resources/');
       for (const selector of ['#allowPopupsSetting', '#downloadsEnabledSetting']) {
         const element = document.querySelector(selector);
         element.checked = true;
         element.dispatchEvent(new Event('change', { bubbles: true }));
       }
      for (const element of document.querySelectorAll('[data-site-permission]')) element.click();
    })()`);
    await waitFor(cdp, "document.querySelector('#settingsSaveStatus').textContent.includes('已即时保存')", 'Settings were not saved automatically.');
    await cdp.evaluate("document.querySelector('#closeToTraySetting').click()");
    await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => preferences.closeToTray === false && !document.querySelector('#closeToTraySetting').checked)", 'The close-to-tray setting did not persist immediately after being turned off.');
    const closeToTrayState = await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => ({ saved: preferences.closeToTray, checked: document.querySelector('#closeToTraySetting').checked, status: document.querySelector('#settingsSaveStatus').textContent }))");
    assertResult(closeToTrayState.saved === false && closeToTrayState.checked === false, `The close-to-tray setting did not persist after its own change: ${JSON.stringify(closeToTrayState)}`);
    if (await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => preferences.allowHttp)")) {
      await cdp.evaluate("document.querySelector('#allowHttpSetting').click()");
      await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => !preferences.allowHttp)", 'Disabling HTTP did not save its setting.');
    }
    await cdp.evaluate("document.querySelector('#allowHttpSetting').click()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden && document.querySelector('#siteWarningTitle').textContent.includes('开启 HTTP')", 'Enabling HTTP did not show its confirmation.');
    await cdp.evaluate("document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => preferences.allowHttp)", 'The confirmed HTTP setting was not saved immediately.');
    if (await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => preferences.allowLocalNetwork)")) {
      await cdp.evaluate("document.querySelector('#allowLocalNetworkSetting').click()");
      await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => !preferences.allowLocalNetwork)", 'Disabling local-network access did not save its setting.');
    }
    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'http://127.0.0.1/'; document.querySelector('#addressForm').requestSubmit()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden && document.querySelector('#siteWarningTitle').textContent.includes('局域网')", 'A local-network address did not show a warning.');
    await cdp.evaluate("document.querySelector('#siteWarningCancel').click()");
    await cdp.evaluate("document.querySelector('#allowLocalNetworkSetting').click()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden && document.querySelector('#siteWarningTitle').textContent.includes('本机与局域网')", 'Enabling local-network access did not show its confirmation.');
    await cdp.evaluate("document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => preferences.allowLocalNetwork)", 'The confirmed local-network setting was not saved immediately.');
    await cdp.evaluate("document.querySelector('#chooseDownloadDirectoryButton').click()");
    await waitFor(cdp, "window.alleyDesktop.getState().then(({preferences}) => preferences.downloadDirectory.includes('RAINTEST'))", 'The selected download directory was not automatically saved.');
    const settings = await cdp.evaluate("window.alleyDesktop.getState().then(({preferences}) => ({ theme: document.documentElement.dataset.theme, palette: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), fieldFont: getComputedStyle(document.querySelector('#accountUsernameSetting')).fontSize, policy: preferences.navigationPolicy, blocked: preferences.blockedHosts, allowed: preferences.allowedHosts, allowHttp: preferences.allowHttp, allowLocalNetwork: preferences.allowLocalNetwork, allowPopups: preferences.allowPopups, closeToTray: preferences.closeToTray, permissions: preferences.allowedPermissions, download: preferences.downloadBaseUrl, downloadDirectory: preferences.downloadDirectory, downloadsEnabled: preferences.downloadsEnabled, controlState: {http: document.querySelector('#allowHttpSetting').checked, local: document.querySelector('#allowLocalNetworkSetting').checked, popups: document.querySelector('#allowPopupsSetting').checked}, bg: getComputedStyle(document.querySelector('#settingsPage')).backgroundColor }))");
    assertResult(settings.theme === 'light' && settings.bg === 'rgb(255, 255, 255)', 'The light theme does not use a white page surface.');
    assertResult(settings.palette === '#ffffff' && settings.ink === '#000000', 'The light theme is not a neutral white-and-black palette.');
    assertResult(settings.fieldFont === '15px', `Settings fields remain too small: ${settings.fieldFont}.`);
    assertResult(settings.policy === 'blocklist' && settings.blocked.includes('blocked.example'), 'Editable site permission settings were not saved.');
    assertResult(settings.allowed.includes('example.org') && settings.allowHttp && settings.allowLocalNetwork && settings.allowPopups, `A site permission setting was not saved immediately: ${JSON.stringify(settings)}`);
    assertResult(settings.permissions.length === 3, 'Per-site permission checkboxes were not saved immediately.');
    assertResult(settings.download === 'https://example.org/resources/' && settings.downloadsEnabled && settings.downloadDirectory.includes('RAINTEST'), `Custom download settings were not saved immediately: ${JSON.stringify(settings)}`);

    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'https://blocked.example/'; document.querySelector('#addressForm').requestSubmit()");
    await sleep(250);
    assertResult(await cdp.evaluate("document.querySelector('#toast').textContent.includes('拦截规则禁止')"), 'A blocked HTTPS host was not stopped by the deny list.');
    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'file:///C:/Windows/win.ini'; document.querySelector('#addressForm').requestSubmit()");
    await sleep(200);
    assertResult(await cdp.evaluate("document.querySelector('#toast').textContent.includes('只支持 HTTP 或 HTTPS')"), 'A local file address was not rejected.');

    await cdp.evaluate("document.querySelector('#appAddressInput').value = 'rainalley://app/feature/street-postcard'; document.querySelector('#addressForm').requestSubmit()");
    await waitFor(cdp, "document.body.dataset.page === 'detail' && document.querySelector('#appAddressInput').value === 'rainalley://app/feature/street-postcard'", 'Feature deep link did not open its detail page.');
    await cdp.evaluate("document.querySelector('#homeBrowserTab').click()");
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'Home deep link did not return to the envelope directory.');

    await cdp.evaluate("document.querySelector('#collectionBrowserTab').click()");
    await waitFor(cdp, "document.body.dataset.page === 'collection'", 'The favorites tab did not open before netdisk UI checks.');
    await cdp.evaluate("document.querySelector('#allFeaturesModeButton').click(); document.querySelector('#featureGrid [data-feature-id=\"netdisk-links\"]')?.click()");
    await waitFor(cdp, "document.body.dataset.page === 'netdisk' && !document.querySelector('#netdiskToolPage').hidden", 'The netdisk address helper did not open inside the application.');
    const testDirectUrl = 'https://d.pcs.baidu.com/file/lesson.zip?filename=lesson.zip&sign=abc&expires=123';
    await cdp.evaluate(`document.querySelector('#netdiskInput').value = '${testDirectUrl}'; document.querySelector('#netdiskResolveButton').click()`);
    await waitFor(cdp, "document.querySelector('#netdiskResultList .netdisk-result strong')?.textContent === 'lesson.zip'", 'The netdisk interface did not render the expected test-file result.');
    const netdiskResult = await cdp.evaluate(`(() => ({ provider: document.querySelector('#netdiskProviderLabel').textContent,
      status: document.querySelector('#netdiskStatus').textContent, copyEnabled: !document.querySelector('#netdiskCopyAllButton').disabled,
      resultUrl: document.querySelector('#netdiskResultList .netdisk-result code')?.textContent,
      copyButtonCount: document.querySelectorAll('#netdiskResultList [data-netdisk-copy]').length }))()`);
    assertResult(netdiskResult.provider.includes('百度') && netdiskResult.status.includes('已识别') && netdiskResult.copyEnabled
      && netdiskResult.copyButtonCount === 1 && netdiskResult.resultUrl === testDirectUrl, `The netdisk result UI is incomplete: ${JSON.stringify(netdiskResult)}`);
    await cdp.evaluate("document.querySelector('#netdiskResultList [data-netdisk-copy]').click()");
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('下载地址已复制')", 'Copying a recognized netdisk address did not show success feedback.');
    await waitFor(cdp, `window.alleyDesktop.readRuntimeCopiedText() === '${testDirectUrl}'`, 'The netdisk copy action did not send the recognized address to Electron clipboard.');
    await cdp.evaluate("document.querySelector('#netdiskInput').value = 'https://example.com/not-a-netdisk-link'; document.querySelector('#netdiskResolveButton').click()");
    await waitFor(cdp, "document.querySelector('#netdiskStatus').classList.contains('is-error') && document.querySelector('#netdiskStatus').textContent.includes('受支持的网盘')", 'An unsupported address did not receive an inline error state.');

    const dragCheck = await cdp.evaluate(`(() => {
      const bar = document.querySelector('.topbar');
      const right = document.querySelector('.window-actions');
      const buttons = [...right.querySelectorAll('button')];
      return { bar: getComputedStyle(bar).webkitAppRegion, right: getComputedStyle(right).webkitAppRegion,
        width: Math.round(right.getBoundingClientRect().width), buttons: buttons.length,
        buttonRegions: buttons.map((button) => getComputedStyle(button).webkitAppRegion) };
    })()`);
    assertResult(dragCheck.bar === 'drag' && dragCheck.right === 'drag' && dragCheck.width >= 120 && dragCheck.buttonRegions.every((value) => value === 'no-drag'), `The right title bar region is not configured for native dragging: ${JSON.stringify(dragCheck)}`);

    await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then(({ data }) => fs.writeFileSync(path.join(base, 'home.png'), Buffer.from(data, 'base64')));

    await cdp.evaluate('window.alleyDesktop.minimizeToTaskbar()');
    await sleep(220);
    const taskbarState = await cdp.evaluate('window.alleyDesktop.getState()');
    assertResult(taskbarState.windowMinimized === true, 'Taskbar minimize did not set the native minimized state.');
    await cdp.evaluate('window.alleyDesktop.restore()');
    await sleep(180);
    await cdp.evaluate('window.alleyDesktop.minimizeToTray()');
    await sleep(220);
    const trayState = await cdp.evaluate('window.alleyDesktop.getState()');
    assertResult(trayState.windowVisible === false && trayState.windowMinimized === false, 'Tray hiding did not remain distinct from taskbar minimization.');

    const persistedPath = path.join(userData, 'preferences.json');
    const persisted = JSON.parse(fs.readFileSync(persistedPath, 'utf8'));
    assertResult(persisted.theme === 'light' && persisted.downloadBaseUrl === 'https://example.org/resources/', 'Electron user preferences were not written to the user data directory.');
    await cdp.evaluate("document.querySelector('#settingsButton').click()");
    await waitFor(cdp, "document.body.dataset.page === 'settings'", 'Settings could not be reopened for full data cleanup.');
    await cdp.evaluate("document.querySelector('#clearAppDataButton').click()");
    await waitFor(cdp, "!document.querySelector('#siteWarningOverlay').hidden && document.querySelector('#siteWarningTitle').textContent === '清除雨巷来信应用数据'", 'The final full data cleanup confirmation did not open.');
    await cdp.evaluate("document.querySelector('#siteWarningOpen').click()");
    await waitFor(cdp, "document.querySelector('#toast').textContent.includes('应用数据已清除')", 'Clearing all application data did not complete.');
    assertResult(!fs.existsSync(persistedPath), 'The full data clearing action left the application preferences file behind.');
    assertResult(fs.existsSync(downloadedFile) && fs.readFileSync(downloadedFile, 'utf8') === 'A'.repeat(16 * 1024), 'The full data clearing action removed or changed an already downloaded file.');
    console.log(`ui runtime ok: envelope ${openedEnvelopeId} physical open/favorite motion, browser tabs, netdisk helper, favorites, routes, profiles, preferences and window state.`);
    await cdp.evaluate('window.alleyDesktop.quit()').catch(() => {});
    await Promise.race([new Promise((resolve) => processRef.once('exit', resolve)), sleep(2500)]);
    if (processRef.exitCode === null) await stopProcessAndWait(processRef);
    socket.close();
  } catch (error) {
    try { socket?.close(); } catch {}
    if (processRef.exitCode === null) await stopProcessAndWait(processRef);
    throw new Error(`${error.message}\nElectron output:\n${output.slice(-4500)}`);
  } finally {
    await closeServer(localSite?.server);
  }
}

function testNativeDrag(pid) {
  const source = `
$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RainAlleyWindowProbe {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  public static List<object> Find(uint target) {
    var found = new List<object>();
    EnumWindows((hwnd, _) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if (IsWindowVisible(hwnd)) { var title = new System.Text.StringBuilder(512); GetWindowText(hwnd, title, title.Capacity); if (pid == target || title.ToString().Contains("雨巷来信")) found.Add(new { hwnd = hwnd.ToInt64(), pid, title = title.ToString() }); } return true; }, IntPtr.Zero);
    return found;
  }
}
'@
Add-Type $src
$handles = [RainAlleyWindowProbe]::Find(${pid})
$candidate = $handles | Where-Object { $_.title -like '*雨巷来信*' } | Select-Object -First 1
if (-not $candidate) { $candidate = $handles | Select-Object -First 1 }
if (-not $candidate) { [pscustomobject]@{ moved = $false; windows = $handles } | ConvertTo-Json -Compress; exit 0 }
$hwnd = [IntPtr]::new([long]$candidate.hwnd)
$before = New-Object RainAlleyWindowProbe+RECT
[RainAlleyWindowProbe]::GetWindowRect($hwnd, [ref]$before) | Out-Null
$x = [int]($before.Left + (($before.Right - $before.Left) * 0.74))
$y = [int]($before.Top + 26)
[RainAlleyWindowProbe]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 120
[RainAlleyWindowProbe]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[RainAlleyWindowProbe]::SetCursorPos($x + 42, $y + 24) | Out-Null
Start-Sleep -Milliseconds 350
[RainAlleyWindowProbe]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
$after = New-Object RainAlleyWindowProbe+RECT
[RainAlleyWindowProbe]::GetWindowRect($hwnd, [ref]$after) | Out-Null
[pscustomobject]@{ before = @($before.Left,$before.Top,$before.Right,$before.Bottom); after = @($after.Left,$after.Top,$after.Right,$after.Bottom); moved = ($before.Left -ne $after.Left -or $before.Top -ne $after.Top) } | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error(`Native window drag probe failed: ${result.stderr || result.stdout}`);
  return Promise.resolve(JSON.parse(result.stdout.trim()));
}

function stopProcess(pid) {
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

async function stopProcessAndWait(processRef) {
  if (processRef.exitCode !== null) return;
  const exited = new Promise((resolve) => processRef.once('exit', resolve));
  stopProcess(processRef.pid);
  await Promise.race([exited, sleep(3000)]);
}

async function testWindowAction(appRoot, base, action) {
  console.log(`window action check: ${action}`);
  const userData = path.join(base, `user-data-${action}`);
  const port = await freePort();
  const processRef = spawn(electron, [appRoot, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${userData}`], {
    cwd: appRoot, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: path.dirname(electron), RAIN_ALLEY_TEST_MODE: '1' },
  });
  let socket;
  try {
    const connected = await connectCdp(port, processRef);
    const { cdp } = connected; socket = connected.socket;
    await waitFor(cdp, "document.body.dataset.page === 'scene'", 'The test window did not open the home page.');
    await cdp.evaluate(`window.alleyDesktop.${action}()`);
    await sleep(250);
    const state = await cdp.evaluate('window.alleyDesktop.getState()');
    if (action === 'minimizeToTaskbar') assertResult(state.windowMinimized, 'Taskbar minimize did not minimize the window.');
    else assertResult(!state.windowVisible && !state.windowMinimized, 'Tray minimize did not hide the window separately from taskbar minimize.');
    await cdp.evaluate('window.alleyDesktop.quit()');
    await Promise.race([
      new Promise((resolve) => processRef.once('exit', resolve)),
      sleep(12000).then(() => { throw new Error(`Timed out waiting for ${action} test window to exit.`); }),
    ]);
    socket.close();
  } catch (error) {
    try { socket?.close(); } catch {}
    if (processRef.exitCode === null) stopProcess(processRef.pid);
    throw error;
  }
}

(async () => {
  assert.ok(fs.existsSync(electron), 'Electron executable is missing.');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rain-alley-ui-runtime-'));
  try {
    const appRoot = createTestApp(base);
    await testInterface(appRoot, base);
    console.log('window runtime ok: taskbar minimize and tray hide are distinct native window states.');
  } finally {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try { fs.rmSync(base, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt === 5) console.error(`Temporary runtime files remain at ${base}: ${error.message}`);
        else await sleep(150);
      }
    }
  }
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
