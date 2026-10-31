import { celebrate } from './celebration.js';
import { features, featureCategory, featureCategoryName } from './features.js';
import { analyzeInput, getProvider, isSharePage, parseUrl } from './netdisk.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const desktop = window.alleyDesktop;
const authScreen = $('#authScreen');
const loginForm = $('#loginForm');
const registerForm = $('#registerForm');
const authFeedback = $('#authFeedback');
const credentialsOverlay = $('#credentialsOverlay');
const featureGrid = $('#featureGrid');
const sceneHomePage = $('#sceneHomePage');
const collectionPage = $('#collectionPage');
const detailPage = $('#detailPage');
const sitePage = $('#sitePage');
const profilePage = $('#profilePage');
const settingsPage = $('#settingsPage');
const netdiskToolPage = $('#netdiskToolPage');
const newTabPage = $('#newTabPage');
const siteBookmarkButton = $('#siteBookmarkButton');
const siteLinkSwiftButton = $('#siteLinkSwiftButton');
const siteFrameShell = $('#siteFrameShell');
const sitePlaceholder = $('#sitePlaceholder');
const catalogPagination = $('#catalogPagination');
const historyGrid = $('#historyGrid');
const siteWarningOverlay = $('#siteWarningOverlay');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const catalogPageSize = 6;
const homePageSize = 6;
const categoryData = [
  { id: 'all', label: '全部功能', tabLabel: '全部', icon: '<path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v5H4zM14 15h6v5h-6z"/>' },
  { id: 'steam', label: 'Steam 工具', tabLabel: 'Steam', icon: '<circle cx="12" cy="12" r="9"/><circle cx="16" cy="8" r="2.5"/><path d="m4.5 10 4.2 2.4m.9.5 3.8 2.2"/>' },
  { id: 'utility', label: '桌面工具', tabLabel: '桌面工具', icon: '<path d="M4 7h16v12H4zM8 7V4h8v3M12 11v4m-2-2h4"/>' },
  { id: 'website', label: '巷中站点', tabLabel: '巷中站点', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>' },
  { id: 'builtin', label: '内置页面', tabLabel: '内置页面', icon: '<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>' },
];
const iconPaths = {
  steam: '<circle cx="8" cy="12" r="2.7"/><circle cx="17.7" cy="6.5" r="3.1"/><path d="m10.3 10.5 4.8-2.6M7.4 14.4l-3.5 1.9m4.5-1 3.1 1.8a3.1 3.1 0 1 0 1.7-5.7"/>',
  utility: '<path d="M3 6h18v12H3zM6 6V4h12v2m-8 4 2 2-2 2m4 0h4"/>',
  website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  builtin: '<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>',
};
const actionIcons = {
  view: '<path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/>',
  preview: '<path d="M4 6h16v13H4zM4 10h16m-11-4v4m6-4v4M8 14h3m2 0h3m-8 3h3"/>',
  open: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  back: '<path d="m14 18-6-6 6-6"/>',
};
const iconSvg = (feature) => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[featureCategory(feature)] || iconPaths.utility}</svg>`;
const actionSvg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${actionIcons[name] || actionIcons.view}</svg>`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const typeLabel = (feature) => featureCategoryName(feature);
const state = { username: null, displayName: '', installed: new Set(['street-postcard']), selected: 'street-postcard', profileUsername: null, profile: null, preferences: { muted: true, lightweight: false, theme: 'dark', favorites: [], history: [], navigationPolicy: 'allowlist', allowedHosts: [], blockedHosts: [], allowHttp: false, allowLocalNetwork: false, allowPopups: false, downloadsEnabled: true, downloadBaseUrl: 'https://vault.600318.xyz/', downloadDirectory: '', allowedPermissions: [], closeToTray: true, webBookmarks: [] }, ready: false };
let filter = 'all';
let collectionMode = 'favorites';
let routeStack = ['rainalley://app/home'];
let routeIndex = 0;
let pendingSiteUrl = '';
let siteCurrentUrl = '';
let activeBrowserTabId = 'home';
let activePinnedBrowserTabId = 'home';
let activeSiteTabId = '';
let browserTabs = [];
let browserTabSequence = 0;
const activeDownloads = new Map();
let authBusy = false;
let previewTimer = 0;
let previewFeatureId = null;
let pendingCredentials = null;
let credentialDataUrl = null;
let lastCredentialPath = null;
let commentRequest = 0;
let boundsRaf = 0;
let catalogPage = 0;
let catalogFilteredItems = [];
let catalogLoadObserver = null;
let catalogScrollArmed = false;
let selectedCs2Directory = '';
let toastTimer = 0;
let homeVisibleCount = homePageSize;
let homeHasScrolled = false;
let homeLoadObserver = null;
let settingsSaveTimer = 0;
let settingsRevision = 0;
const envelopeAnimationTimers = new WeakMap();
document.addEventListener('visibilitychange', () => { document.documentElement.dataset.effectsPaused = String(document.hidden); });
desktop?.onSuspend?.(() => { document.documentElement.dataset.effectsPaused = 'true'; document.dispatchEvent(new Event('alley:suspend-effects')); });
desktop?.onResume?.(() => { document.documentElement.dataset.effectsPaused = 'false'; });

function celebrateMilestone(key) {
  void celebrate(key, state.preferences, desktop);
}

function toast(message, tone = 'info', duration = 2600) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = String(message || '');
  element.classList.toggle('is-error', tone === 'error');
  element.classList.toggle('is-success', tone === 'success');
  element.classList.toggle('is-warning', tone === 'warning');
  element.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), duration);
}

function renderBrowserTabs() {
  const list = $('#websiteTabs');
  if (!list) return;
  const shortAt = browserTabs.length > 10 ? 8 : browserTabs.length > 5 ? 12 : 18;
  list.innerHTML = browserTabs.map((tab) => {
    const selected = activeBrowserTabId === tab.id;
    const full = String(tab.title || tab.hostname || '新标签页');
    const points = [...full];
    const label = points.length > shortAt ? `${points.slice(0, shortAt - 1).join('')}…` : full;
    return `<div class="browser-tab${selected ? ' is-active' : ''}" role="presentation" draggable="true" data-sort-tab="${escapeHtml(tab.id)}"><button class="browser-tab-label" type="button" role="tab" data-browser-tab="${escapeHtml(tab.id)}" aria-controls="sitePage" aria-selected="${selected}" aria-label="切换到 ${escapeHtml(full)}" title="${escapeHtml(full)}"><i class="browser-tab-mark" aria-hidden="true"></i><span>${escapeHtml(label)}</span></button><button class="browser-tab-close" type="button" data-close-browser-tab="${escapeHtml(tab.id)}" aria-label="关闭标签页：${escapeHtml(full)}" title="关闭标签页">×</button></div>`;
  }).join('');
  for (const id of ['home', 'collection', 'profile']) {
    const button = $(`[data-browser-tab="${id}"]`);
    const selected = activeBrowserTabId === id;
    if (!button) continue;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  list.querySelector('[data-browser-tab].is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function createSiteTab(title = '新标签页') {
  const id = `tab-${Date.now().toString(36)}-${(++browserTabSequence).toString(36)}`;
  const tab = { id, title, url: '', loading: false, loadError: '' };
  browserTabs.push(tab);
  activeSiteTabId = id;
  activeBrowserTabId = id;
  renderBrowserTabs();
  return tab;
}

async function ensureActiveWebsiteTab(title = '新标签页') {
  let tab = browserTabs.find((item) => item.id === activeBrowserTabId);
  if (!tab) tab = createSiteTab(title);
  await desktop?.registerWebsiteTab(tab.id).catch(() => {});
  await desktop?.activateWebsiteTab(tab.id).catch(() => {});
  activeSiteTabId = tab.id;
  activeBrowserTabId = tab.id;
  return tab;
}

async function activateBrowserTab(id) {
  if (id === 'home') { showScene(); return; }
  if (id === 'collection') { showCollection(); return; }
  if (id === 'profile') { openProfile(); return; }
  const tab = browserTabs.find((item) => item.id === id);
  if (!tab) return;
  activeBrowserTabId = tab.id;
  activeSiteTabId = tab.id;
  try {
    const page = await desktop.activateWebsiteTab(tab.id);
    if (page?.url) tab.url = page.url;
    if (page?.title) tab.title = page.title;
    tab.canGoBack = page?.canGoBack === true;
    tab.canGoForward = page?.canGoForward === true;
    if (typeof page?.loading === 'boolean') tab.loading = page.loading;
  } catch { /* the new-tab surface remains available when a view is not ready yet */ }
  renderBrowserTabs();
  if (tab.url) {
    siteCurrentUrl = tab.url;
    updateAddress(tab.url, false);
    updateSiteBookmarkButton();
    updateSiteLinkSwiftButton();
    showPage('site');
    updateSitePlaceholder(tab);
  } else {
    updateAddress('', false);
    showPage('new-tab');
    requestAnimationFrame(() => $('#appAddressInput')?.focus({ preventScroll: true }));
  }
  updateNavigationButtons();
  scheduleSiteBounds();
}

async function closeBrowserTab(id) {
  const index = browserTabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  browserTabs.splice(index, 1);
  await desktop.closeWebsite(id).catch(() => {});
  if (activeBrowserTabId !== id) { renderBrowserTabs(); return; }
  const next = browserTabs[Math.min(index, browserTabs.length - 1)];
  await activateBrowserTab(next?.id || activePinnedBrowserTabId);
}

async function createBlankBrowserTab() {
  const tab = createSiteTab('新标签页');
  await desktop?.registerWebsiteTab(tab.id).catch(() => {});
  activeSiteTabId = tab.id;
  await desktop.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, null).catch(() => {});
  updateAddress('', false);
  showPage('new-tab');
  $('#appAddressInput')?.focus({ preventScroll: true });
  return tab;
}

function setMaximizedButton(button, maximized) {
  if (!button) return;
  const state = Boolean(maximized);
  button.setAttribute('aria-label', state ? '还原窗口' : '最大化窗口');
  button.setAttribute('title', state ? '还原窗口' : '最大化窗口');
  button.setAttribute('aria-pressed', String(state));
}

function applyTheme(theme) {
  document.documentElement.dataset.lightweight = String(Boolean(state.preferences.lightweight));
  if (state.preferences.lightweight) document.dispatchEvent(new Event('alley:suspend-effects'));
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#ffffff' : '#000000');
  const light = next === 'light';
  return next;
}

async function toggleTheme() {
  const next = applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  state.preferences.theme = next;
  try { await desktop?.saveState({ theme: next }); } catch { /* theme stays available for this session */ }
}

function savePreferences(input) {
  state.preferences = { ...state.preferences, ...input };
  return desktop?.saveState(input);
}

function favoriteIds() { return Array.isArray(state.preferences.favorites) ? state.preferences.favorites : []; }
function historyIds() { return Array.isArray(state.preferences.history) ? state.preferences.history : []; }
function isFavorite(id) { return favoriteIds().includes(id); }
function historyWith(id) { return [id, ...historyIds().filter((value) => value !== id)].slice(0, 300); }
function webBookmarks() { return Array.isArray(state.preferences.webBookmarks) ? state.preferences.webBookmarks : []; }
function normalizeWebBookmarkUrl(value) {
  try { const url = new URL(String(value || '')); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHost(url.hostname)) return null; return url.toString(); } catch { return null; }
}
function findWebBookmark(value) { const normalized = normalizeWebBookmarkUrl(value); return normalized ? webBookmarks().find((item) => item.url === normalized) || null : null; }
function updateSiteBookmarkButton() {
  if (!siteBookmarkButton) return;
  const current = sitePage.hidden ? null : normalizeWebBookmarkUrl(siteCurrentUrl);
  const active = Boolean(current && findWebBookmark(current));
  siteBookmarkButton.disabled = !current;
  siteBookmarkButton.classList.toggle('is-bookmarked', active);
  siteBookmarkButton.setAttribute('aria-pressed', String(active));
  siteBookmarkButton.setAttribute('aria-label', active ? '取消收藏当前网页' : '收藏当前网页');
  siteBookmarkButton.title = active ? '取消收藏当前网页' : '收藏当前网页';
  const label = siteBookmarkButton.querySelector('span'); if (label) label.textContent = active ? '已收藏' : '收藏网页';
}
async function toggleWebBookmark(value = siteCurrentUrl, title = '') {
  const url = normalizeWebBookmarkUrl(value);
  if (!url) { toast('当前页面不是可收藏的 HTTP 或 HTTPS 网页。'); return; }
  const current = webBookmarks();
  const existing = current.find((item) => item.url === url);
  const pageTitle = browserTabs.find((tab) => tab.id === activeSiteTabId)?.title;
  const next = existing ? current.filter((item) => item.url !== url) : [{ url, hostname: new URL(url).hostname, title: String(title || pageTitle || new URL(url).hostname).trim().slice(0, 160) || new URL(url).hostname, createdAt: Date.now(), lastUsedAt: Date.now() }, ...current].slice(0, 300);
  try { await savePreferences({ webBookmarks: next }); } catch { toast('网页收藏保存失败，请检查本机磁盘空间。'); return; }
  updateSiteBookmarkButton();
  if (collectionMode === 'web') renderFeatures();
  toast(existing ? '已取消网页收藏。' : '网页已收进收藏。');
}

function updateNavigationButtons() {
  const siteTab = browserTabs.find((tab) => tab.id === activeSiteTabId);
  const showingWebsite = !sitePage.hidden && Boolean(siteTab);
  const showingBlankTab = !newTabPage.hidden;
  $('#addressBack').disabled = showingWebsite ? siteTab.canGoBack !== true : showingBlankTab || routeIndex <= 0;
  $('#addressForward').disabled = showingWebsite ? siteTab.canGoForward !== true : showingBlankTab || routeIndex >= routeStack.length - 1;
  $('#addressRefresh').disabled = showingBlankTab;
  $('#addressRefresh').setAttribute('aria-label', showingWebsite ? '刷新网页' : '重新打开当前页面');
  $('#addressRefresh').title = showingWebsite ? '刷新网页' : '重新打开当前页面';
}

function updateSitePlaceholder(tab) {
  if (!tab) return;
  if (tab.loading) {
    $('#sitePlaceholderTitle').textContent = '正在打开网页';
    $('#sitePlaceholderText').textContent = '页面正在载入，连接较慢时请稍候。';
    sitePlaceholder.hidden = false;
  } else if (tab.loadError) {
    $('#sitePlaceholderTitle').textContent = '网页加载失败';
    $('#sitePlaceholderText').textContent = tab.loadError;
    sitePlaceholder.hidden = false;
  } else {
    sitePlaceholder.hidden = true;
  }
}

function updateDownloadIndicator(details = null) {
  const button = $('#downloadFolderButton');
  const indicator = $('#downloadIndicator');
  const label = $('#downloadActivityLabel');
  if (!button || !indicator || !label) return;
  if (details?.id) {
    if (['started', 'progress', 'paused', 'interrupted'].includes(details.status)) activeDownloads.set(details.id, { ...activeDownloads.get(details.id), ...details });
    else activeDownloads.delete(details.id);
    if (details.status === 'started') toast(`正在下载：${details.name || '文件'}`, 'info', 5000);
    else if (details.status === 'completed') toast(`下载完成：${details.name || '文件'}`, 'success', 4200);
    else if (details.status === 'failed') toast(`下载失败：${details.name || '文件'}`, 'error', 4200);
    else if (details.status === 'interrupted') toast(`下载中断：${details.name || '文件'}`, 'warning', 4200);
    else if (details.status === 'progress' && details.total > 0) {
      const percent = Math.max(0, Math.min(100, Math.floor(details.received / details.total * 100)));
      const active = activeDownloads.get(details.id);
      if (percent >= (active?.lastAnnouncedPercent || 10) + 10) {
        active.lastAnnouncedPercent = percent;
        activeDownloads.set(details.id, active);
        toast(`正在下载 ${percent}%：${details.name || '文件'}`, 'info', 3200);
      }
    }
  }
  const count = activeDownloads.size;
  indicator.hidden = count === 0;
  button.classList.toggle('is-downloading', count > 0);
  button.title = count ? `正在下载 ${count} 个文件；打开下载文件夹` : '打开下载文件夹';
  button.setAttribute('aria-label', count ? `正在下载 ${count} 个文件；打开下载文件夹` : '打开下载文件夹');
  label.textContent = count ? `正在下载 ${count} 个文件` : '';
}

function renderDownloads(items) {
  const list = $('#downloadsList');
  if (!list) return;
  const merged = new Map(items.map((item) => [item.id, item]));
  for (const [id, item] of activeDownloads) merged.set(id, item);
  const rows = [...merged.values()];
  if (!rows.length) { list.innerHTML = '<p class="downloads-empty">暂时没有下载记录。</p>'; return; }
  list.innerHTML = rows.map((item) => {
    const percent = item.total > 0 ? Math.min(100, Math.floor(item.received / item.total * 100)) : 0;
    const status = item.status === 'completed' ? '已完成' : item.status === 'failed' ? '下载失败' : item.status === 'cancelled' ? '已取消' : item.status === 'paused' ? '已暂停' : item.status === 'interrupted' ? '已中断' : `正在下载${item.total > 0 ? ` · ${percent}%` : ''}`;
    const controls = ['started', 'progress'].includes(item.status) ? `<button data-download-action="pause" data-download-id="${escapeHtml(item.id)}">暂停</button><button data-download-action="cancel" data-download-id="${escapeHtml(item.id)}">取消</button>` : item.status === 'paused' || item.status === 'interrupted' ? `<button data-download-action="resume" data-download-id="${escapeHtml(item.id)}">继续</button><button data-download-action="cancel" data-download-id="${escapeHtml(item.id)}">取消</button>` : item.status === 'completed' ? `<button data-download-open="${escapeHtml(item.id)}">打开文件</button>` : '';
    return `<article class="download-row"><div class="download-row-copy"><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span>${status}</span></div>${['started', 'progress', 'paused', 'interrupted'].includes(item.status) ? `<progress max="100" value="${percent}" aria-label="${status}"></progress>` : ''}<div class="download-row-actions">${controls}</div></article>`;
  }).join('');
}

async function showDownloads() {
  if (!sitePage.hidden) await desktop.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, activeSiteTabId).catch(() => {});
  $('#downloadsOverlay').hidden = false;
  renderDownloads(await desktop.listDownloads().catch(() => []));
}

async function openWebBookmark(value) {
  const item = webBookmarks().find((entry) => entry.url === value);
  if (!item) return;
  item.lastUsedAt = Date.now();
  await savePreferences({ webBookmarks: webBookmarks() });
  await navigateAddress(item.url, true);
}
function animateHomeEnvelope(id) {
  const card = $(`#sceneFeatureRail [data-envelope-id="${CSS.escape(id)}"]`);
  if (!card) return Promise.resolve();
  const previousAnimation = envelopeAnimationTimers.get(card);
  if (previousAnimation) previousAnimation.resolve();
  card.classList.remove('is-opening');
  if (reduceMotion.matches) return Promise.resolve();
  void card.offsetWidth;
  card.classList.add('is-opening');
  // Navigation waits for the card animation so the letter remains visible throughout the reveal.
  return new Promise((resolve) => {
    let timer;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      card.removeEventListener('animationend', handleAnimationEnd);
      card.classList.remove('is-opening');
      envelopeAnimationTimers.delete(card);
      resolve();
    };
    const handleAnimationEnd = (event) => {
      if (event.target === card && event.animationName === 'envelope-open-card') finish();
    };
    card.addEventListener('animationend', handleAnimationEnd);
    timer = window.setTimeout(finish, 1400);
    envelopeAnimationTimers.set(card, { resolve: finish });
  });
}
let openingEnvelopeId = null;
async function openEnvelopeFeature(id) {
  if (openingEnvelopeId) return;
  openingEnvelopeId = id;
  await animateHomeEnvelope(id);
  openingEnvelopeId = null;
  await openFeature(id);
}
async function toggleFavorite(id, { animateHome = false } = {}) {
  const previousFavorites = favoriteIds();
  const previousHistory = historyIds();
  const next = isFavorite(id) ? favoriteIds().filter((value) => value !== id) : [id, ...favoriteIds()].slice(0, 200);
  try { await savePreferences({ favorites: next, history: historyWith(id) }); }
  catch {
    state.preferences.favorites = previousFavorites;
    state.preferences.history = previousHistory;
    renderFeatures(); renderHeroHighlights();
    if (animateHome) requestAnimationFrame(() => { void animateHomeEnvelope(id); });
    toast('收藏没有保存成功，请检查本机磁盘空间。', 'error');
    return;
  }
  renderFeatures(); renderHeroHighlights();
  if (animateHome) requestAnimationFrame(() => { void animateHomeEnvelope(id); });
  toast(next.includes(id) ? '已收进我的收藏。' : '已从收藏中移除。');
}

function collectionAddress() {
  if (collectionMode === 'history') return 'rainalley://app/history';
  if (collectionMode === 'all') return `rainalley://app/catalog${filter === 'all' ? '' : `?category=${encodeURIComponent(filter)}`}`;
  if (collectionMode === 'web') return 'rainalley://app/web-bookmarks';
  return 'rainalley://app/favorites';
}

function setFilter(next) {
  filter = next;
  collectionMode = 'all';
  catalogPage = 0;
  for (const button of $$('[data-filter]')) {
    const selected = button.dataset.filter === next;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  renderFeatures();
  if (document.body.dataset.page === 'collection') updateAddress(collectionAddress(), !replayingRoute);
}

function featureCard(feature) {
  const installed = state.installed.has(feature.id);
  const available = feature.availability === 'ready';
  const stateText = installed ? '已安装' : available ? (feature.kind === 'website' ? '站点可用' : '可以使用') : '尚未上架';
  const categoryClass = installed ? 'is-installed' : available ? 'is-available' : 'is-coming';
  return `<article class="feature-card${installed ? ' is-installed' : ''}${state.selected === feature.id ? ' is-selected' : ''}" data-category="${escapeHtml(featureCategory(feature))}" data-envelope-id="${escapeHtml(feature.id)}" data-feature-card="${escapeHtml(feature.id)}" tabindex="0" aria-label="${escapeHtml(feature.name)}，${escapeHtml(stateText)}，打开功能详情">
    <span class="envelope-paper" aria-hidden="true"><i class="envelope-flap"></i><i class="envelope-fold envelope-fold-left"></i><i class="envelope-fold envelope-fold-right"></i><i class="envelope-seal">${isFavorite(feature.id) ? '★' : '·'}</i></span>
    <button class="feature-open" type="button" data-feature-id="${escapeHtml(feature.id)}" aria-label="${escapeHtml(feature.name)}，${escapeHtml(stateText)}，打开详情"><span class="feature-icon icon-${escapeHtml(featureCategory(feature))}">${iconSvg(feature)}</span><span class="feature-copy"><strong title="${escapeHtml(feature.name)}">${escapeHtml(feature.name)}</strong><small title="${escapeHtml(feature.summary)}">${escapeHtml(feature.summary)}</small></span><svg class="feature-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg><span class="feature-state ${categoryClass}"><i></i>${escapeHtml(stateText)}<small>${escapeHtml(typeLabel(feature))}</small></span></button>
    <button class="favorite-toggle${isFavorite(feature.id) ? ' is-favorite' : ''}" type="button" data-favorite-id="${escapeHtml(feature.id)}" aria-label="${isFavorite(feature.id) ? '取消收藏' : '收藏'} ${escapeHtml(feature.name)}" title="${isFavorite(feature.id) ? '取消收藏' : '收藏'}">${isFavorite(feature.id) ? '★' : '☆'}</button>
  </article>`;
}

function renderWebBookmark(item, index) {
  const title = item.title || item.hostname;
  let host = item.hostname;
  try { host = new URL(item.url).hostname; } catch { /* saved data is rendered as plain text */ }
  const indexLabel = String(index + 1).padStart(2, '0');
  return `<article class="feature-card web-bookmark-envelope" data-category="website" data-envelope-id="web-${index}" data-bookmark-index="${index}" data-bookmark-card="${escapeHtml(item.url)}" tabindex="0" aria-label="打开网页收藏：${escapeHtml(title)}">
    <span class="envelope-paper" aria-hidden="true"><i class="envelope-flap"></i><i class="envelope-fold envelope-fold-left"></i><i class="envelope-fold envelope-fold-right"></i><i class="envelope-seal">${indexLabel}</i></span>
    <button class="feature-open web-bookmark-open" type="button" data-bookmark-open="${escapeHtml(item.url)}" aria-label="打开网页：${escapeHtml(title)}"><span class="feature-icon icon-website"><svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths.website}</svg></span><span class="feature-copy"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><small title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</small></span><svg class="feature-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg><span class="feature-state is-available"><i></i>网页收藏<small>${escapeHtml(host)}</small></span></button>
    <button class="favorite-toggle" type="button" data-bookmark-delete="${escapeHtml(item.url)}" aria-label="删除网页收藏：${escapeHtml(title)}" title="删除收藏">×</button>
  </article>`;
}

function observeCatalogLoad() {
  catalogLoadObserver?.disconnect();
  catalogLoadObserver = null;
  const sentinel = $('#catalogLoadSentinel');
  if (!sentinel || !('IntersectionObserver' in window)) return;
  catalogLoadObserver = new IntersectionObserver((entries) => {
    if (catalogScrollArmed && entries.some((entry) => entry.isIntersecting)) appendCatalogBatch();
  }, { root: featureGrid, rootMargin: '0px' });
  catalogLoadObserver.observe(sentinel);
}

function appendCatalogBatch() {
  const start = catalogPage * catalogPageSize;
  const batch = catalogFilteredItems.slice(start, start + catalogPageSize);
  if (!batch.length) return;
  const fragment = document.createDocumentFragment();
  for (const item of batch) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = collectionMode === 'web' ? renderWebBookmark(item, start) : featureCard(item);
    fragment.append(wrapper.firstElementChild);
  }
  $('#catalogLoadSentinel')?.remove();
  featureGrid.append(fragment);
  catalogPage += 1;
  if (start + batch.length < catalogFilteredItems.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'catalogLoadSentinel'; sentinel.className = 'catalog-load-sentinel';
    sentinel.setAttribute('role', 'status'); sentinel.textContent = '继续向下，展开更多信件';
    featureGrid.append(sentinel);
    observeCatalogLoad();
  } else catalogLoadObserver?.disconnect();
  if (catalogPagination) {
    catalogPagination.hidden = start + batch.length >= catalogFilteredItems.length;
    catalogPagination.innerHTML = catalogPagination.hidden ? '' : '<button type="button" data-catalog-page="1">继续显示</button>';
  }
}

function renderFeatures() {
  if (!featureGrid) return;
  catalogLoadObserver?.disconnect();
  catalogLoadObserver = null;
  catalogScrollArmed = false;
  catalogPage = 0;
  if (collectionMode === 'web') {
    catalogFilteredItems = webBookmarks();
    featureGrid.innerHTML = catalogFilteredItems.length ? '' : '<div class="empty-results"><strong>还没有网页收藏</strong><small>打开一个网站后，点工具栏的“收藏网页”，就能留在这里下次继续浏览。</small></div>';
    if (catalogFilteredItems.length) appendCatalogBatch();
    renderHistoryPreview();
    for (const [id, active] of [['favoritesModeButton', false], ['historyModeButton', false], ['allFeaturesModeButton', false], ['webBookmarksModeButton', true]]) { const button = $(`#${id}`); button?.classList.toggle('is-active', active); button?.setAttribute('aria-pressed', String(active)); }
    $('.catalog-tabs').hidden = true;
    return;
  }
  const sourceIds = collectionMode === 'history' ? historyIds() : favoriteIds();
  const source = collectionMode === 'history'
    ? sourceIds.map((id) => features.find((feature) => feature.id === id)).filter(Boolean)
    : collectionMode === 'all' ? features : features.filter((feature) => sourceIds.includes(feature.id));
  const filtered = source.filter((feature) => {
    const categoryMatch = filter === 'all' || featureCategory(feature) === filter;
    return categoryMatch;
  });
  catalogFilteredItems = filtered;
  featureGrid.innerHTML = filtered.length
    ? ''
    : collectionMode === 'favorites'
      ? '<div class="empty-results"><strong>还没有收藏的功能信</strong><small>回到主页，点开信封右上角的星标，把常用功能收进来。</small></div>'
      : '<div class="empty-results"><strong>还没有浏览历史</strong><small>你打开、阅读或收藏过的功能信，会在这里去重显示。</small></div>';
  if (filtered.length) appendCatalogBatch();
  renderHistoryPreview();
  for (const [id, active] of [['favoritesModeButton', collectionMode === 'favorites'], ['historyModeButton', collectionMode === 'history'], ['allFeaturesModeButton', collectionMode === 'all'], ['webBookmarksModeButton', false]]) {
    const button = $(`#${id}`); button?.classList.toggle('is-active', active); button?.setAttribute('aria-pressed', String(active));
  }
  $('.catalog-tabs').hidden = collectionMode !== 'all';
}

function renderHistoryPreview() {
  if (!historyGrid) return;
  if (collectionMode !== 'favorites') { $('#historyPreview').hidden = true; return; }
  const history = historyIds().map((id) => features.find((feature) => feature.id === id)).filter(Boolean).slice(0, 8);
  $('#historyPreview').hidden = false;
  historyGrid.innerHTML = history.length ? history.map(featureCard).join('') : '<div class="history-empty">打开过的功能会在这里留下去重记录。</div>';
}

function updateFeatureCounts() {
  const counts = { all: features.length, steam: 0, utility: 0, website: 0, builtin: 0 };
  for (const feature of features) counts[featureCategory(feature)] += 1;
  const featureCount = $('#featureCount');
  if (featureCount) featureCount.textContent = String(features.length).padStart(2, '0');
  const tabs = $('.catalog-tabs');
  if (tabs) {
    tabs.innerHTML = categoryData.map(({ id, tabLabel }) => {
      const selected = filter === id;
      return `<button class="catalog-tab${selected ? ' is-active' : ''}" type="button" data-filter="${id}" aria-pressed="${selected}">${tabLabel} <span class="tab-count">${String(counts[id]).padStart(2, '0')}</span></button>`;
    }).join('');
  }
}

function renderHeroHighlights() {
  const rail = $('#sceneFeatureRail');
  if (!rail) return;
  const visible = features.slice(0, homeVisibleCount);
  $('#heroFeatureCount')?.replaceChildren(document.createTextNode(`${String(visible.length).padStart(2, '0')} / ${String(features.length).padStart(2, '0')}`));
  rail.innerHTML = visible.map((feature, index) => `<article class="home-envelope${state.selected === feature.id ? ' is-selected' : ''}" data-category="${escapeHtml(featureCategory(feature))}" data-envelope-id="${escapeHtml(feature.id)}">
    <button class="home-envelope-open" type="button" data-feature-id="${escapeHtml(feature.id)}" aria-label="打开工具：${escapeHtml(feature.name)}">
      <span class="home-envelope-index">${String(index + 1).padStart(2, '0')}</span>
    <span class="home-envelope-art" aria-hidden="true"><i class="envelope-back"></i><i class="envelope-letter"><b></b><b></b><b></b></i><i class="envelope-fold envelope-fold-left"></i><i class="envelope-fold envelope-fold-right"></i><i class="envelope-pocket"></i><i class="envelope-flap"></i><i class="envelope-seal">${isFavorite(feature.id) ? '★' : '·'}</i></span>
      <span class="home-envelope-copy"><strong title="${escapeHtml(feature.name)}">${escapeHtml(feature.name)}</strong><small title="${escapeHtml(feature.summary)}">${escapeHtml(feature.summary)}</small></span>
      <span class="hero-feature-status"><i></i>${feature.availability === 'ready' ? '可用' : '待上架'}</span>
      <span class="home-envelope-read">打开工具 <span aria-hidden="true">›</span></span>
    </button>
    <button class="home-envelope-favorite${isFavorite(feature.id) ? ' is-favorite' : ''}" type="button" data-favorite-id="${escapeHtml(feature.id)}" aria-pressed="${isFavorite(feature.id)}" aria-label="${isFavorite(feature.id) ? '取消收藏' : '收藏'} ${escapeHtml(feature.name)}" title="${isFavorite(feature.id) ? '取消收藏' : '收藏'}">${isFavorite(feature.id) ? '★' : '☆'}</button>
  </article>`).join('');
  const hasMore = visible.length < features.length;
  const loadButton = $('#homeLoadMore');
  if (loadButton) {
    loadButton.hidden = !hasMore;
    loadButton.textContent = hasMore ? '继续显示工具' : '已显示全部工具';
  }
  $('#homeLoadStatus').textContent = hasMore ? `已显示 ${visible.length} 个工具，还有 ${features.length - visible.length} 个。` : `已显示全部 ${features.length} 个工具。`;
}

function loadMoreHomeFeatures() {
  if (homeVisibleCount >= features.length) return;
  homeVisibleCount = Math.min(features.length, homeVisibleCount + homePageSize);
  renderHeroHighlights();
}

function updateInstallationSummary() {
  const count = features.filter((feature) => state.installed.has(feature.id)).length;
  const activeCount = $('#activeCount');
  const readyCount = $('#readyCount');
  if (activeCount) activeCount.textContent = String(count).padStart(2, '0');
  if (readyCount) readyCount.textContent = String(features.filter((feature) => feature.availability === 'ready').length).padStart(2, '0');
}

function showPage(page) {
  sceneHomePage.hidden = page !== 'scene';
  collectionPage.hidden = page !== 'collection';
  detailPage.hidden = page !== 'detail';
  sitePage.hidden = page !== 'site';
  profilePage.hidden = page !== 'profile';
  settingsPage.hidden = page !== 'settings';
  netdiskToolPage.hidden = page !== 'netdisk';
  newTabPage.hidden = page !== 'new-tab';
  const isScene = page === 'scene';
  const isCollection = page === 'collection';
  if (page === 'scene') activePinnedBrowserTabId = activeBrowserTabId = 'home';
  else if (page === 'collection') activePinnedBrowserTabId = activeBrowserTabId = 'collection';
  else if (page === 'profile') activePinnedBrowserTabId = activeBrowserTabId = 'profile';
  else if (!['site', 'new-tab'].includes(page)) activeBrowserTabId = activePinnedBrowserTabId;
  document.body.dataset.page = page;
  document.documentElement.dataset.page = page;
  const appShell = $('#appShell');
  appShell?.classList.toggle('is-scene', isScene);
  appShell?.classList.toggle('is-collection', isCollection);
  appShell?.classList.toggle('is-subpage', !['scene', 'collection'].includes(page));
  for (const button of $$('[data-page]')) {
    const selected = button.dataset.page === page || (button.dataset.page === 'collection' && page === 'detail');
    button.classList.toggle('is-active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  const route = page === 'scene' ? 'rainalley://app/home'
    : page === 'collection' ? collectionAddress()
      : page === 'settings' ? 'rainalley://app/settings'
        : page === 'profile' ? `rainalley://app/profile/${encodeURIComponent(state.profileUsername || state.username || '')}`
          : page === 'detail' ? `rainalley://app/feature/${encodeURIComponent(state.selected || '')}`
            : page === 'site' ? siteCurrentUrl
          : page === 'netdisk' ? 'rainalley://app/netdisk' : '';
  if (route) updateAddress(route, page !== 'site' && !replayingRoute);
  updateSiteBookmarkButton();
  updateSiteLinkSwiftButton();
  renderBrowserTabs();
  updateNavigationButtons();
  scheduleSiteBounds();
}

let replayingRoute = false;
function updateAddress(address, record = true) {
  const input = $('#appAddressInput');
  if (input) input.value = address || '';
  if (!address) {
    $('#addressSecure').title = '新标签页';
    $('#addressSecure').classList.remove('is-insecure');
    updateNavigationButtons();
    return;
  }
  $('#addressSecure').title = address.startsWith('https:') || address.startsWith('rainalley:') ? '安全连接' : 'HTTP 明文连接';
  $('#addressSecure').classList.toggle('is-insecure', address.startsWith('http:'));
  if (record && routeStack[routeIndex] !== address) {
    routeStack = routeStack.slice(0, routeIndex + 1);
    routeStack.push(address);
    routeIndex = routeStack.length - 1;
  }
  updateNavigationButtons();
}

async function navigateAddress(rawAddress, approved = false, fromHistory = false) {
  let address = String(rawAddress || '').trim();
  if (!address) return;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(address)) address = `https://${address}`;
  if (address.startsWith('rainalley://app/')) {
    let url; try { url = new URL(address); } catch { toast('应用内地址格式有误。'); return; }
    let segments; try { segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part)); } catch { toast('雨巷页面地址格式有误。'); return; }
    replayingRoute = fromHistory;
    if (segments[0] === 'home' || segments.length === 0) showScene();
    else if (segments[0] === 'favorites') { setCollectionMode('favorites'); showCollection({ focus: false }); }
    else if (segments[0] === 'history') { setCollectionMode('history'); showCollection({ focus: false }); }
    else if (segments[0] === 'web-bookmarks') { setCollectionMode('web'); showCollection({ focus: false }); }
    else if (segments[0] === 'netdisk') showNetdiskTool();
    else if (segments[0] === 'catalog') {
      const category = url.searchParams.get('category');
      filter = categoryData.some((item) => item.id === category) ? category : 'all';
      setCollectionMode('all'); showCollection({ focus: false }); setFilter(filter);
    }
    else if (segments[0] === 'settings') showSettings();
    else if (segments[0] === 'profile' && segments[1]) openProfile(segments[1]);
    else if (segments[0] === 'feature' && segments[1] && features.some((feature) => feature.id === segments[1])) openFeature(segments[1]);
    else toast('这个雨巷页面地址不存在。');
    replayingRoute = false;
    return;
  }
  let url;
  try { url = new URL(address); } catch { toast('请输入完整网址，例如 https://example.com/'); return; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { toast('只支持 HTTP 或 HTTPS 网页，其他地址类型不允许打开。'); return; }
  const settings = state.preferences;
  if (isPrivateHost(url.hostname) && !settings.allowLocalNetwork) { showLocalNetworkWarning(url.toString()); return; }
  const blocked = settings.blockedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  const knownHost = settings.allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  const policyAllows = settings.navigationPolicy === 'allow-all' || settings.navigationPolicy === 'blocklist' || (settings.navigationPolicy === 'allowlist' && knownHost);
  if (settings.navigationPolicy === 'deny-all' || blocked) { toast('这个站点被当前拦截规则禁止。可在设置里修改站点权限。'); return; }
  if (url.protocol === 'http:' && !settings.allowHttp) { showHttpWarning(url.toString()); return; }
  if (!policyAllows && !approved) { showSiteWarning(url.toString()); return; }
  if (approved && settings.navigationPolicy === 'allowlist' && !knownHost) {
    settings.allowedHosts = [...new Set([...settings.allowedHosts, url.hostname])];
    await savePreferences({ allowedHosts: settings.allowedHosts });
  }
  const appFeature = features.find((feature) => feature.siteUrl && new URL(feature.siteUrl).hostname === url.hostname);
  // The editable URL lives in the top address bar. Keep the page heading
  // descriptive instead of repeating the same host name underneath it.
  await openSiteUrl(url.toString(), appFeature?.name || url.hostname, approved || !policyAllows);
}

function showSiteWarning(url) {
  const target = new URL(url);
  if (isPrivateHost(target.hostname) && !state.preferences.allowLocalNetwork) { toast('本机和局域网地址默认禁止访问。可在设置里明确开启。'); return; }
  desktop?.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, activeSiteTabId || null).catch(() => {});
  siteWarningOverlay.dataset.kind = 'site';
  pendingSiteUrl = url;
  $('#siteWarningTitle').textContent = '即将打开外部网页';
  $('#siteWarningText').textContent = '请确认你信任这个地址。页面会在独立的应用内网页中打开，不会把雨巷账号令牌交给网站。';
  $('#siteWarningOpen').textContent = '确认打开';
  $('#siteWarningUrl').textContent = url;
  siteWarningOverlay.hidden = false;
  $('#siteWarningOpen').focus({ preventScroll: true });
}

function showDataClearConfirmation(kind) {
  siteWarningOverlay.dataset.kind = kind;
  pendingSiteUrl = '';
  $('#siteWarningTitle').textContent = kind === 'clear-browser-data' ? '清除网页浏览数据' : '清除雨巷来信应用数据';
  $('#siteWarningText').textContent = kind === 'clear-browser-data'
    ? '将清除应用内网站的 Cookie、缓存和本地存储。你会从这些网站退出登录；已下载文件和雨巷账号不会受影响。'
    : '将退出雨巷账号，并删除应用设置、收藏、浏览历史、网页收藏和站点数据。已下载文件和独立保存的主理人恢复凭据会保留。此操作无法撤销。';
  $('#siteWarningUrl').textContent = '';
  $('#siteWarningOpen').textContent = kind === 'clear-browser-data' ? '清除网页数据' : '清除全部应用数据';
  siteWarningOverlay.hidden = false;
}

let pendingHttpUrl = '';
function isPrivateHost(host) {
  const normalized = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const octets = /^\d+\.\d+\.\d+\.\d+$/.test(normalized) ? normalized.split('.').map(Number) : [];
  if (['localhost', 'home.arpa'].includes(normalized) || ['.localhost', '.local', '.internal', '.lan'].some((suffix) => normalized.endsWith(suffix))) return true;
  if (octets.length === 4) return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
  if (!normalized.includes(':')) return false;
  const parts = normalized.split('::');
  if (parts.length > 2) return false;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const words = parts.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  const nums = words.map((part) => Number.parseInt(part, 16));
  if (nums.length !== 8 || nums.some((value) => !Number.isFinite(value))) return false;
  const mapped = nums.slice(0, 5).every((value) => value === 0) && nums[5] === 0xffff;
  const compatible = nums.slice(0, 6).every((value) => value === 0);
  const nat64 = nums[0] === 0x64 && nums[1] === 0xff9b && nums.slice(2, 6).every((value) => value === 0);
  if (mapped || compatible || nat64) {
    const ipv4 = `${nums[6] >> 8}.${nums[6] & 255}.${nums[7] >> 8}.${nums[7] & 255}`;
    const octets = ipv4.split('.').map(Number);
    if (octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) return true;
  }
  return nums.every((value) => value === 0) || (nums.slice(0, 7).every((value) => value === 0) && nums[7] === 1) || (nums[0] & 0xfe00) === 0xfc00 || (nums[0] & 0xffc0) === 0xfe80 || (nums[0] & 0xff00) === 0xff00 || nums[0] === 0x2002;
}
function showHttpWarning(url) {
  pendingHttpUrl = url;
  siteWarningOverlay.dataset.kind = 'http';
  $('#siteWarningTitle').textContent = '此网页使用未加密的 HTTP';
  $('#siteWarningText').textContent = 'HTTP 站点不会加密传输内容。只有你确认后，才会为当前地址启用 HTTP，并把域名加入许可列表。';
  $('#siteWarningUrl').textContent = url;
  $('#siteWarningOpen').textContent = '启用并打开';
  siteWarningOverlay.hidden = false;
  $('#siteWarningOpen').focus({ preventScroll: true });
}

function showLocalNetworkWarning(url) {
  pendingSiteUrl = url;
  siteWarningOverlay.dataset.kind = 'local-network';
  $('#siteWarningTitle').textContent = '此地址位于本机或局域网';
  $('#siteWarningText').textContent = '本地网络页面可能访问路由器或其他设备，默认禁止。只有你确认信任这些地址后，才会启用局域网访问。';
  $('#siteWarningUrl').textContent = url;
  $('#siteWarningOpen').textContent = '启用局域网并打开';
  siteWarningOverlay.hidden = false;
  $('#siteWarningOpen').focus({ preventScroll: true });
}

async function openPendingSite() {
  if (siteWarningOverlay.dataset.kind === 'clear-browser-data' || siteWarningOverlay.dataset.kind === 'clear-app-data') {
    const kind = siteWarningOverlay.dataset.kind;
    siteWarningOverlay.hidden = true;
    try {
      if (kind === 'clear-browser-data') {
        await desktop.clearBrowserData();
        toast('网页登录状态和浏览数据已清除。', 'success');
      } else {
        const result = await desktop.clearAppData();
        state.preferences = {};
        state.username = null;
        state.installed = new Set(['street-postcard']);
        showAuth();
        toast(result?.downloadsPreserved ? '应用数据已清除，下载文件已保留。' : '应用数据已清除。', 'success');
      }
    } catch (cause) { toast(cause?.message || '数据清理没有完成。', 'error'); }
    return;
  }
  if (siteWarningOverlay.dataset.kind === 'http') {
    const url = pendingHttpUrl;
    pendingHttpUrl = '';
    siteWarningOverlay.hidden = true;
    state.preferences.allowHttp = true;
    const host = new URL(url).hostname;
    if (state.preferences.navigationPolicy === 'allowlist' && !state.preferences.allowedHosts.includes(host)) state.preferences.allowedHosts.push(host);
    await savePreferences({ allowHttp: true, allowedHosts: state.preferences.allowedHosts });
    await navigateAddress(url, true);
    return;
  }
  if (siteWarningOverlay.dataset.kind === 'local-network') {
    const url = pendingSiteUrl;
    pendingSiteUrl = '';
    siteWarningOverlay.hidden = true;
    state.preferences.allowLocalNetwork = true;
    await savePreferences({ allowLocalNetwork: true });
    await navigateAddress(url, true);
    return;
  }
  if (siteWarningOverlay.dataset.kind === 'http-setting') {
    siteWarningOverlay.hidden = true;
    $('#allowHttpSetting').checked = true;
    await saveSettings();
    return;
  }
  if (siteWarningOverlay.dataset.kind === 'local-setting') {
    siteWarningOverlay.hidden = true;
    $('#allowLocalNetworkSetting').checked = true;
    await saveSettings();
    return;
  }
  const target = pendingSiteUrl;
  pendingSiteUrl = '';
  siteWarningOverlay.hidden = true;
  if (target) await navigateAddress(target, true);
}

function showScene() {
  stopPreview();
  sceneHomePage.scrollTop = 0;
  homeHasScrolled = false;
  showPage('scene');
  renderHeroHighlights();
  loadOwnDisplayName();
}

function showCollection({ focus = true } = {}) {
  stopPreview();
  showPage('collection');
  renderFeatures();
}

function showNetdiskTool() {
  stopPreview();
  closeSiteAndHide();
  showPage('netdisk');
  $('#netdiskInput')?.focus({ preventScroll: true });
}

let pendingNetdiskShare = null;
function setNetdiskStatus(message, kind = '') {
  const status = $('#netdiskStatus');
  if (!status) return;
  status.textContent = String(message || '');
  status.classList.toggle('is-error', kind === 'error');
  status.classList.toggle('is-ready', kind === 'ready');
}

function renderNetdiskResult(result) {
  const list = $('#netdiskResultList');
  const provider = result?.provider;
  $('#netdiskProviderLabel').textContent = provider?.name || (result?.status === 'invalid' ? '尚未识别网盘' : '未识别平台');
  const links = Array.isArray(result?.links) ? result.links : Array.isArray(result?.directLinks) ? result.directLinks : [];
  list.innerHTML = links.length ? links.map((item, index) => `<article class="netdisk-result"><div><strong title="${escapeHtml(item.filename || item.name || `文件 ${index + 1}`)}">${escapeHtml(item.filename || item.name || `文件 ${index + 1}`)}</strong><code title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</code></div><button type="button" data-netdisk-copy="${index}">复制地址</button></article>`).join('') : '<div class="netdisk-empty">没有发现可直接复制的地址。需要账户会话时，请在分享页中启用助手。</div>';
  $('#netdiskCopyAllButton').disabled = !links.length;
  $('#netdiskCopyAllButton').dataset.count = String(links.length);
  pendingNetdiskShare = result?.status === 'needs-page' && result.url && provider ? { url: result.url, provider: provider.name } : null;
  $('#netdiskOpenButton').disabled = !pendingNetdiskShare;
  return links;
}

let currentNetdiskLinks = [];
async function resolveNetdisk() {
  const input = $('#netdiskInput').value.trim();
  if (!input) { setNetdiskStatus('先粘贴网盘分享页或已经取得的下载地址。', 'error'); $('#netdiskInput').focus(); return; }
  const button = $('#netdiskResolveButton');
  button.disabled = true;
  $('#netdiskProviderLabel').textContent = '正在识别…';
  setNetdiskStatus('正在检查地址和公开的分享页内容…');
  $('#netdiskResultList').innerHTML = '<div class="netdisk-empty">正在识别，请稍候。</div>';
  try {
    const result = await desktop.resolveNetdisk(input);
    currentNetdiskLinks = renderNetdiskResult(result);
    setNetdiskStatus(result.message || '识别完成。', result.status === 'ready' ? 'ready' : result.status === 'invalid' || result.status === 'blocked' ? 'error' : '');
  } catch (cause) {
    currentNetdiskLinks = renderNetdiskResult({ status: 'invalid' });
    setNetdiskStatus(cause?.message || '网盘地址识别失败，请稍后重试。', 'error');
  } finally { button.disabled = false; }
}

async function openNetdiskShare() {
  const share = pendingNetdiskShare;
  if (!share) return;
  let parsed;
  try { parsed = parseUrl(share.url); } catch { parsed = null; }
  const provider = parsed && isSharePage(parsed) ? getProvider(parsed) : null;
  if (!provider || parsed.protocol !== 'https:') { setNetdiskStatus('分享页地址没有通过 HTTPS 网盘校验。', 'error'); return; }
  const button = $('#netdiskOpenButton');
  button.disabled = true;
  button.textContent = '正在打开分享页…';
  try {
    await navigateAddress(parsed.toString(), true);
    if (document.body.dataset.page === 'site') {
      try {
        await desktop.injectLinkSwift(activeSiteTabId);
        toast(`${provider.name}分享页已启用 LinkSwift。`);
      } catch (cause) { setNetdiskStatus(cause?.message || '页面已经打开，但助手暂时没有启用。页面载入后可再试一次。', 'error'); }
    }
  } finally { button.disabled = false; button.textContent = '打开分享页并启用助手'; }
}

async function enableLinkSwift() {
  try {
    const result = await desktop.injectLinkSwift(activeSiteTabId);
    toast(`${result.provider || '网盘'}页面已启用 LinkSwift 1.1.3。`);
  } catch (cause) { toast(cause?.message || '当前页面无法启用 LinkSwift。'); }
}

function updateSiteLinkSwiftButton() {
  if (!siteLinkSwiftButton) return;
  const provider = !sitePage.hidden && isSharePage(siteCurrentUrl) ? getProvider(siteCurrentUrl) : null;
  siteLinkSwiftButton.hidden = !provider;
  siteLinkSwiftButton.setAttribute('aria-label', provider ? `启用 ${provider.name} LinkSwift 助手` : '启用 LinkSwift 网盘助手');
  siteLinkSwiftButton.title = provider ? `启用 ${provider.name} LinkSwift 助手` : '启用 LinkSwift 网盘助手';
}

function renderBookmarkCurrentTitle(url, title) {
  const current = normalizeWebBookmarkUrl(url);
  if (!current || typeof title !== 'string' || !title.trim()) return;
  const existing = webBookmarks().find((item) => item.url === current);
  if (!existing || existing.title === title.trim()) return;
  const next = webBookmarks().map((item) => item.url === current ? { ...item, title: title.trim().slice(0, 160) } : item);
  savePreferences({ webBookmarks: next }).then(() => { if (collectionMode === 'web') renderFeatures(); }).catch(() => {});
}

function deliveryLabel(feature) {
  if (feature.builtin) return '随桌面程序安装';
  if (feature.kind === 'website') return '应用内网页';
  if (featureCategory(feature) === 'steam') return '从 Steam 启动 CS2';
  return '桌面工具';
}

async function openFeature(featureId) {
  const feature = features.find((item) => item.id === featureId);
  if (!feature) return;
  stopPreview();
  state.selected = feature.id;
  renderFeatures();
  try {
    state.preferences.selectedFeature = feature.id;
    await savePreferences({ selectedFeature: feature.id, history: historyWith(feature.id) });
  } catch { /* opening a feature is still available if its local preference cannot be saved */ }

  if (feature.id === 'netdisk-links') {
    showNetdiskTool();
    return;
  }

  if (feature.kind === 'website') {
    if (!feature.siteUrl || feature.availability !== 'ready') {
      showPage('detail');
      renderDetail(feature);
      return;
    }
    showSite(feature);
    return;
  }
  closeSiteAndHide();
  showPage('detail');
  renderDetail(feature);
}

function renderDetail(feature) {
  const installed = state.installed.has(feature.id);
  $('#detailIcon').innerHTML = iconSvg(feature);
  $('#detailKind').textContent = typeLabel(feature);
  $('#detailTitle').textContent = feature.name;
  $('#detailSummary').textContent = feature.summary;
  $('#detailType').textContent = typeLabel(feature);
  $('#detailState').textContent = installed ? '已安装' : feature.availability === 'ready' ? '可以使用' : '尚未上架';
  $('#detailDelivery').textContent = deliveryLabel(feature);
  $('#detailExplainer').textContent = feature.detail;
  const status = $('#detailStatus');
  status.textContent = installed ? '已安装' : feature.availability === 'ready' ? '可以使用' : '尚未上架';
  status.classList.toggle('is-installed', installed);
  status.classList.toggle('is-coming', !installed && feature.availability !== 'ready');
  status.classList.toggle('is-installing', false);
  const actions = $('#detailActions');
  $('#cs2ShareComment').hidden = feature.id !== 'cs2-bots';
  if (feature.id === 'cs2-bots') {
    actions.innerHTML = `<p class="cs2-download-note">一键安装会从官方 Release 获取并校验插件包。安装前可确认清理其他插件，并选择是否保留备份。</p><button class="action-secondary" id="downloadCs2Package" type="button">${actionSvg('open')}查看官方分享与下载说明</button><button class="action-secondary" id="netdiskCs2Package" type="button">${actionSvg('open')}用网盘工具获取下载地址</button><div class="cs2-install-controls"><label>CS2 游戏目录<input id="cs2Directory" type="text" readonly placeholder="自动识别或选择 CS2 安装目录" /></label><button class="action-secondary" id="chooseCs2Directory" type="button">选择目录</button><label>官方 ZIP 文件（可选）<input id="cs2Archive" type="text" readonly placeholder="留空时自动从官方 Release 下载" /></label><button class="action-secondary" id="chooseCs2Archive" type="button">选择 ZIP</button><p class="cs2-download-note" id="cs2ArchiveHint" role="status">选择后会自动记住，下次无需重复查找。</p><button class="action-primary" id="installCs2Package" type="button">${actionSvg('check')}一键安装并打开 Panel</button><button class="action-secondary" id="openCs2Panel" type="button">打开 Panel</button><div class="cs2-uninstall-section"><div><strong>卸下人机增强</strong><p>按官方清单移除插件文件，保留其他内容。卸载前会预览范围，并自动保存恢复备份。</p></div><button class="action-secondary cs2-danger" id="uninstallCs2Package" type="button">卸载插件…</button><p id="cs2UninstallResult" role="status" hidden></p></div></div><a class="detail-inline-note" href="${escapeHtml(feature.source)}" target="_blank" rel="noreferrer">官方源码与发布说明 · ed0ard/CS2-Bot-Improver v1.4.7</a>`;
  } else if (feature.id === 'netdisk-links') {
    actions.innerHTML = `<button class="action-primary" id="openNetdiskToolButton" type="button">${actionSvg('open')}打开网盘地址工具</button><a class="detail-inline-note" href="${escapeHtml(feature.source)}" target="_blank" rel="noreferrer">查看 LinkSwift 上游项目</a>`;
  } else if (feature.builtin) {
    actions.innerHTML = `<button class="action-primary" id="viewStreetButton" type="button">${actionSvg('view')}打开雨巷主页</button>`;
  } else if (installed) {
    actions.innerHTML = `<span class="action-disabled">${actionSvg('check')}已安装</span>${featureCategory(feature) === 'steam' ? '<span class="detail-inline-note">从 Steam 启动 CS2 后自动生效</span>' : ''}`;
  } else if (feature.availability === 'coming') {
    actions.innerHTML = `<button class="action-primary" id="previewInstallButton" type="button">${actionSvg('preview')}预览信封装入</button><span class="action-disabled" aria-disabled="true">安装包尚未上架</span>`;
  } else {
    actions.innerHTML = `<span class="action-disabled">暂时没有可用的安装包</span>`;
  }
  $('#previewProgress').hidden = true;
  $('#commentsPanel').hidden = feature.kind === 'website';
  if (feature.kind !== 'website') loadComments(feature.id);
  $('#viewStreetButton')?.addEventListener('click', showScene);
  $('#openNetdiskToolButton')?.addEventListener('click', showNetdiskTool);
  $('#downloadCs2Package')?.addEventListener('click', () => navigateAddress(feature.quarkUrl, true).catch((cause) => toast(cause?.message || '夸克分享页暂时无法打开。', 'error')));
  $('#cs2QuarkCommentLink')?.addEventListener('click', (event) => { event.preventDefault(); navigateAddress(feature.quarkUrl, true).catch((cause) => toast(cause?.message || '夸克分享页暂时无法打开。', 'error')); });
  $('#netdiskCs2Package')?.addEventListener('click', () => { showNetdiskTool(); $('#netdiskInput').value = feature.quarkUrl; void resolveNetdisk(); });
  $('#chooseCs2Directory')?.addEventListener('click', async () => { const value = await desktop.chooseCs2Directory().catch((cause) => { toast(cause?.message || '无法选择游戏目录。', 'error'); return null; }); if (value) { selectedCs2Directory = value; $('#cs2Directory').value = value; } });
  $('#chooseCs2Archive')?.addEventListener('click', async () => { const value = await desktop.chooseCs2Archive().catch((cause) => { toast(cause?.message || '无法选择 ZIP 文件。', 'error'); return null; }); if (value && $('#cs2Archive')) { $('#cs2Archive').value = value; $('#cs2Archive').dataset.chosen = 'true'; $('#cs2ArchiveHint').textContent = '已记住这个 ZIP，下次会自动选好。'; } });
  const archiveInput = $('#cs2Archive');
  void desktop.getCs2Archive?.().then((saved) => {
    if (!archiveInput?.isConnected || archiveInput.dataset.chosen) return;
    archiveInput.value = saved?.path || '';
    $('#cs2ArchiveHint').textContent = saved?.path ? (saved.available ? '已自动选好上次的 ZIP。' : '上次的 ZIP 已移动或删除，请重新选择。') : '选择后会自动记住，下次无需重复查找。';
  }).catch(() => {});
  void desktop.findCs2Directory?.().then((value) => { if (value && $('#cs2Directory')) { selectedCs2Directory = value; $('#cs2Directory').value = value; } }).catch(() => {});
  $('#installCs2Package')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!$('#cs2Directory').value) { toast('先选择 CS2 游戏目录。', 'warning'); return; }
    button.disabled = true;
    const originalLabel = button.innerHTML;
    button.textContent = $('#cs2Archive').value ? '正在校验并安装…' : '正在获取官方插件并安装…';
    try {
      const cleanOtherPlugins = await cs2InstallChoice('清理其他 CS2 插件？', '安装人机增强插件前，需要移除 addons 文件夹内未包含在官方安装包中的插件。选择“否”将取消一键安装。', [{ label: '否，取消安装', value: false }, { label: '是，继续安装', value: true, primary: true }]);
      if (!cleanOtherPlugins) { toast('安装已取消，游戏目录没有更改。'); return; }
      const keepBackup = await cs2InstallChoice('保留文件备份？', '备份会保存在 CS2 游戏目录下的雨巷来信备份文件夹。', [{ label: '取消安装', value: null }, { label: '不保留备份', value: false }, { label: '保留备份', value: true, primary: true }]);
      if (keepBackup === null) { toast('安装已取消，游戏目录没有更改。'); return; }
      const result = await desktop.installCs2BotImprover($('#cs2Directory').value, $('#cs2Archive').value, { cleanOtherPlugins, keepBackup });
      if (result?.cancelled) { toast('安装已取消，游戏目录没有更改。'); return; } selectedCs2Directory = result.directory || $('#cs2Directory').value; $('#cs2Directory').value = selectedCs2Directory; state.installed.add('cs2-bots'); await desktop.saveState({ installedFeatures: [...state.installed] }); $('#detailStatus').textContent = '已安装'; $('#detailStatus').classList.add('is-installed'); $('#detailState').textContent = '已安装'; updateInstallationSummary(); celebrateMilestone('cs2-installed'); const backup = result?.backup ? `备份位置：${result.backup}` : ''; toast(result?.panelOpened ? `插件已安装并打开 Panel。${backup}` : `插件已安装，但 Panel 未能启动。${backup}`, result?.panelOpened ? 'success' : 'warning', 5500); if (result?.cleanupPending?.length) setTimeout(() => toast('插件已安装。部分临时文件仍被系统占用，稍后可清理。', 'warning', 6000), 5600);
    }
    catch (cause) { toast(cause?.message || '安装未完成，请检查官方 ZIP 和游戏目录。', 'error', 5000); }
    finally { button.disabled = false; button.innerHTML = originalLabel; }
  });
  $('#openCs2Panel')?.addEventListener('click', () => { const directory = $('#cs2Directory').value; if (!directory) { toast('请先选择 CS2 游戏目录。', 'warning'); return; } desktop.openCs2Panel(directory).catch((cause) => toast(cause?.message || '未找到 Panel，请先完成安装。', 'error')); });
  $('#uninstallCs2Package')?.addEventListener('click', async (event) => {
    const directory = $('#cs2Directory').value;
    if (!directory) { toast('请先选择 CS2 游戏目录。', 'warning'); return; }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const keepConfig = await cs2InstallChoice('保留人机配置？', '保留配置方便以后重新安装；选择一并移除时，配置会随插件移入恢复备份。玩家自己添加且不在官方清单中的文件始终保留。', [{ label: '取消卸载', value: null }, { label: '一并移除配置', value: false }, { label: '保留配置', value: true, primary: true }]);
      if (keepConfig === null) return;
      const removeShared = await cs2InstallChoice('如何处理共享运行库？', 'CounterStrikeSharp 和 Metamod 可能被其他插件使用。默认保留它们；仅在确认不再使用其他插件时选择一并移除。', [{ label: '取消卸载', value: null }, { label: '一并移除运行库', value: true }, { label: '保留运行库', value: false, primary: true }]);
      if (removeShared === null) return;
      button.textContent = '正在扫描文件…';
      const plan = await desktop.inspectCs2Uninstall(directory, removeShared, keepConfig);
      if (!plan.files.length && !plan.editGameinfo) { toast('没有找到可卸载的 v1.4.7 插件文件。'); return; }
      const detail = `游戏目录：${directory}\n\n将移除 ${plan.files.length} 个官方清单文件，其中 ${plan.changed} 个内容已改变。保留 ${plan.retainedShared} 个共享文件、${plan.retainedConfig} 个配置文件。${plan.editGameinfo ? '同时移除对应的 gameinfo.gi 加载入口，保留其他游戏设置。' : ''}\n所有移除的文件都会保存在游戏目录下的恢复备份。请先关闭 CS2 和 Panel。`;
      const confirmed = await cs2InstallChoice('确认卸载人机增强？', detail, [{ label: '取消卸载', value: false }, { label: '确认卸载', value: true, danger: true }]);
      if (!confirmed) return;
      button.textContent = '正在卸载并保存备份…';
      const result = await desktop.uninstallCs2BotImprover(directory, { removeShared, keepConfig, confirmed: true, fingerprint: plan.fingerprint });
      if (result.cancelled) return;
      state.installed.delete('cs2-bots');
      $('#detailStatus').textContent = '已卸载'; $('#detailStatus').classList.remove('is-installed'); $('#detailState').textContent = '已卸载';
      updateInstallationSummary();
      const message = `已移除 ${result.removed} 个插件文件。${result.backup ? `恢复备份：${result.backup}` : ''} 如需恢复 Steam 原版游戏文件，请在 Steam 中验证游戏文件完整性。`;
      const status = $('#cs2UninstallResult'); if (status) { status.hidden = false; status.textContent = message; }
      toast('人机增强已卸载，恢复备份已保留。', 'success', 5000);
      await desktop.saveState({ installedFeatures: [...state.installed] }).catch(() => toast('卸载已完成，界面状态暂未保存。', 'warning'));
    } catch (cause) { toast(cause?.message || '卸载未完成，请检查游戏目录。', 'error', 7000); }
    finally { button.disabled = false; button.textContent = '卸载插件…'; }
  });
  $('#previewInstallButton')?.addEventListener('click', () => startPreview(feature));
}

function cs2InstallChoice(title, message, choices) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'cs2-modal-overlay';
    overlay.setAttribute('role', 'presentation');
    const dialog = document.createElement('section');
    dialog.className = 'cs2-modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cs2ModalTitle');
    const heading = document.createElement('h2'); heading.id = 'cs2ModalTitle'; heading.textContent = title;
    const copy = document.createElement('p'); copy.id = 'cs2ModalDescription'; copy.textContent = message;
    dialog.setAttribute('aria-describedby', copy.id);
    const finish = value => { overlay.remove(); previousFocus?.focus(); resolve(value); };
    const actions = document.createElement('div'); actions.className = 'cs2-modal-actions';
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label;
      button.className = choice.primary ? 'action-primary' : `action-secondary${choice.danger ? ' cs2-danger' : ''}`;
      button.addEventListener('click', () => finish(choice.value));
      actions.append(button);
    }
    dialog.append(heading, copy, actions); overlay.append(dialog); document.body.append(overlay);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); finish(choices[0].value); }
      if (event.key === 'Tab') {
        const buttons = [...actions.querySelectorAll('button')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    });
    actions.querySelector('button')?.focus();
  });
}

document.querySelector('#openSourceNoticesButton')?.addEventListener('click', async () => {
  try { await cs2InstallChoice('开源许可与致谢', await desktop.getOpenSourceNotices(), [{ label: '关闭', value: null }]); }
  catch (cause) { toast(cause?.message || '暂时无法读取许可说明。', 'error'); }
});

function goHome() {
  showScene();
}

function goCollection() {
  showCollection();
}

function scheduleSiteBounds() {
  if (boundsRaf) cancelAnimationFrame(boundsRaf);
  boundsRaf = requestAnimationFrame(() => {
    boundsRaf = 0;
    if (!siteFrameShell || sitePage.hidden || document.visibilityState === 'hidden') {
      desktop?.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }).catch(() => {});
      return;
    }
    const rect = siteFrameShell.getBoundingClientRect();
    const bottom = Math.min(rect.bottom, innerHeight);
    const height = bottom - rect.top;
    const visible = rect.width > 0 && height > 0 && bottom > 0 && rect.right > 0 && rect.top < innerHeight;
    desktop?.setWebsiteBounds(visible ? { x: rect.left, y: rect.top, width: rect.width, height } : { x: 0, y: 0, width: 0, height: 0 }).catch(() => {});
  });
}

async function showSite(feature) {
  return openSiteUrl(feature.siteUrl, feature.name, feature.approvedByUser === true);
}

async function openSiteUrl(url, title, approvedByUser = false) {
  const tab = await ensureActiveWebsiteTab(title || '新标签页');
  tab.title = String(title || (() => { try { return new URL(url).hostname; } catch { return '新标签页'; } })()).slice(0, 160);
  tab.url = url;
  tab.loading = true;
  tab.loadError = '';
  siteCurrentUrl = url;
  await desktop?.activateWebsiteTab(tab.id).catch(() => {});
  updateSitePlaceholder(tab);
  showPage('site');
  updateSiteBookmarkButton();
  updateSiteLinkSwiftButton();
  renderBrowserTabs();
  try {
    const result = await desktop.openWebsite(url, approvedByUser, tab.id);
    if (result?.url) tab.url = result.url;
    if (result?.title) tab.title = result.title;
    if (typeof result?.canGoBack === 'boolean') tab.canGoBack = result.canGoBack;
    if (typeof result?.canGoForward === 'boolean') tab.canGoForward = result.canGoForward;
    // The load event can settle the tab before this IPC result is processed.
    // Keep its completed state when a stale loading snapshot arrives later.
    if (typeof result?.loading === 'boolean' && tab.loading) tab.loading = result.loading;
    if (activeSiteTabId === tab.id && !sitePage.hidden) updateSitePlaceholder(tab);
    updateNavigationButtons();
    renderBrowserTabs();
    scheduleSiteBounds();
  } catch (cause) {
    tab.loading = false;
    tab.loadError = cause?.message || '请检查网络后重试，或返回功能目录。';
    await desktop?.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, tab.id).catch(() => {});
    if (activeSiteTabId === tab.id && !sitePage.hidden) updateSitePlaceholder(tab);
  }
}

function closeSiteAndHide() {
  desktop?.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, activeSiteTabId || null).catch(() => {});
}

async function moveAddressHistory(delta) {
  if (!sitePage.hidden) {
    const moved = delta < 0 ? await desktop.goBackWebsite(activeSiteTabId).catch(() => false) : await desktop.goForwardWebsite(activeSiteTabId).catch(() => false);
    if (moved) return;
    return;
  }
  const next = Math.max(0, Math.min(routeStack.length - 1, routeIndex + delta));
  if (next === routeIndex) return;
  routeIndex = next;
  await navigateAddress(routeStack[routeIndex], false, true);
  updateAddress(routeStack[routeIndex], false);
}

function closeSiteAndHome() {
  showCollection();
}

function setCollectionMode(mode) {
  collectionMode = ['favorites', 'history', 'all', 'web'].includes(mode) ? mode : 'favorites';
  if (collectionMode !== 'all') {
    filter = 'all';
    for (const button of $$('[data-filter]')) {
      const selected = button.dataset.filter === 'all';
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
  catalogPage = 0;
  renderFeatures();
  if (document.body.dataset.page === 'collection') updateAddress(collectionAddress(), !replayingRoute);
}

function openProfile(username = state.username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{4,24}$/.test(username)) { toast('个人页面地址无效。'); return; }
  state.profileUsername = username;
  state.profile = null;
  const own = username.toLowerCase() === String(state.username || '').toLowerCase();
  $('#profileOwnerBadge').textContent = own ? '这是你的页面' : '只读个人页面';
  $('#profileTitle').textContent = username;
  $('#profileBio').textContent = '正在读取公开资料…';
  $('#profileAvatar').textContent = username.slice(0, 1).toUpperCase();
  $('#profileEditor').hidden = !own;
  $('#profileCustom').replaceChildren();
  showPage('profile');
  desktop.getPublicProfile(username).then((result) => {
    if (state.profileUsername !== username) return;
    state.profile = result.profile || { displayName: '', bio: '', html: '', css: '' };
    const displayName = state.profile.displayName || result.account.username;
    $('#profileTitle').textContent = displayName;
    $('#profileBio').textContent = state.profile.bio || '这位雨巷来客还没有写个人介绍。';
    $('#profileFact').textContent = `真实账号 ${result.account.username} · 注册于 ${new Date(Number(result.account.createdAt) * 1000).toLocaleDateString('zh-CN')}`;
    $('#profileAvatar').textContent = [...displayName][0] || '雨';
    if (own) {
      state.displayName = state.profile.displayName || '';
      updateAccountPresentation();
      $('#accountDisplayNameSetting').value = state.displayName;
    }
    const iframe = document.createElement('iframe');
    iframe.className = 'profile-code-frame';
    iframe.title = `${displayName}的个人页面内容`;
    iframe.setAttribute('sandbox', '');
    const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'";
    const profileColors = document.documentElement.dataset.theme === 'light'
      ? { surface: '#ffffff', ink: '#000000', muted: '#353535', line: '#cccccc', accent: '#087f99' }
      : { surface: '#080808', ink: '#ffffff', muted: '#c8c8c8', line: '#333333', accent: '#70d9df' };
    iframe.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:${profileColors.surface};color:${profileColors.ink};font:14px/1.7 'Microsoft YaHei UI',sans-serif} .profile-page{padding:14px;overflow-wrap:anywhere} .profile-page h2{font-size:20px;line-height:1.4;margin:0 0 12px}.profile-page h3{font-size:16px;margin:16px 0 8px}.profile-page p{margin:8px 0}.profile-page blockquote{border-left:3px solid ${profileColors.accent};margin:12px 0;padding:4px 12px;color:${profileColors.muted}} .profile-page hr{border:0;border-top:1px solid ${profileColors.line};margin:14px 0}${state.profile.css || ''}</style></head><body><main class="profile-page">${state.profile.html || '<p>这位雨巷来客还没有添加自定义内容。</p>'}</main></body></html>`;
    $('#profileCustom').replaceChildren(iframe);
    if (own) {
      $('#profileNameInput').value = state.profile.displayName || '';
      $('#profileBioInput').value = state.profile.bio || '';
      $('#profileHtmlInput').value = state.profile.html || '';
      $('#profileCssInput').value = state.profile.css || '';
    }
  }).catch((cause) => { $('#profileBio').textContent = cause?.message || '暂时无法读取公开资料。'; });
}

function profilePayload() { return { displayName: $('#profileNameInput').value.trim(), bio: $('#profileBioInput').value.trim(), html: $('#profileHtmlInput').value, css: $('#profileCssInput').value }; }

function requestMoreCatalog() {
  if (catalogPage * catalogPageSize >= catalogFilteredItems.length) return;
  catalogScrollArmed = true;
  appendCatalogBatch();
  catalogScrollArmed = false;
}

function updateAccountPresentation() {
  const displayName = state.displayName || state.username || '雨巷来客';
  $('#accountName').textContent = displayName;
  $('#accountAvatar').textContent = [...displayName][0] || '雨';
  $('.account-copy small').textContent = state.username ? `账号 ${state.username}` : '雨巷来信账号';
}

async function loadOwnDisplayName() {
  const username = state.username;
  if (!username) return;
  $('#accountUsernameSetting').value = username;
  try {
    const result = await desktop.getPublicProfile(username);
    if (state.username !== username) return;
    state.profile = result.profile || { displayName: '', bio: '', html: '', css: '' };
    state.displayName = state.profile.displayName || '';
    updateAccountPresentation();
    $('#accountDisplayNameSetting').value = state.displayName;
  } catch { /* account settings remain usable if the public profile service is offline */ }
}

async function saveDisplayName() {
  const status = $('#displayNameSaveStatus');
  const button = $('#saveDisplayNameButton');
  if (!state.username) { status.textContent = '请先登录后再编辑展示名称。'; return; }
  if (!state.profile) {
    try { const result = await desktop.getPublicProfile(state.username); state.profile = result.profile || { displayName: '', bio: '', html: '', css: '' }; }
    catch (cause) { status.textContent = cause?.message || '暂时无法读取个人资料。'; return; }
  }
  button.disabled = true;
  status.textContent = '正在保存展示名称…';
  try {
    const result = await desktop.savePublicProfile({ ...state.profile, displayName: $('#accountDisplayNameSetting').value.trim() });
    state.profile = result.profile;
    state.displayName = state.profile.displayName || '';
    updateAccountPresentation();
    status.textContent = '展示名称已保存并公开。';
  } catch (cause) { status.textContent = cause?.message || '展示名称保存失败，请稍后重试。'; }
  finally { button.disabled = false; }
}

async function saveAccountChanges() {
  const button = $('#saveAccountButton');
  const status = $('#accountSaveStatus');
  const currentPassword = $('#accountCurrentPasswordSetting').value;
  const requestedUsername = $('#accountUsernameSetting').value.trim();
  const newPassword = $('#accountNewPasswordSetting').value;
  const confirmation = $('#accountConfirmPasswordSetting').value;
  const usernameChanged = requestedUsername.toLowerCase() !== String(state.username || '').toLowerCase();
  if (!usernameChanged && !newPassword) { status.textContent = '没有需要保存的账号名称或密码变更。'; return; }
  if (!currentPassword) { status.textContent = '请先输入当前密码，确认这是你的账号。'; $('#accountCurrentPasswordSetting').focus(); return; }
  if (usernameChanged && !/^[A-Za-z0-9_-]{4,24}$/.test(requestedUsername)) { status.textContent = '账号名称需为 4–24 位字母、数字、下划线或短横线。'; $('#accountUsernameSetting').focus(); return; }
  if (newPassword && (newPassword.length < 12 || newPassword.length > 128)) { status.textContent = '新密码长度需为 12–128 位。'; $('#accountNewPasswordSetting').focus(); return; }
  if (newPassword && newPassword !== confirmation) { status.textContent = '两次输入的新密码不一致。'; $('#accountConfirmPasswordSetting').focus(); return; }
  button.disabled = true;
  status.textContent = '正在安全更新账号…';
  try {
    const result = await desktop.updateAccount({ currentPassword, ...(usernameChanged ? { newUsername: requestedUsername } : {}), ...(newPassword ? { newPassword } : {}) });
    state.username = result.username;
    state.role = result.role || 'player';
    state.profileUsername = result.username;
    $('#accountUsernameSetting').value = result.username;
    $('#accountCurrentPasswordSetting').value = '';
    $('#accountNewPasswordSetting').value = '';
    $('#accountConfirmPasswordSetting').value = '';
    updateAccountPresentation();
    status.textContent = result.recoveryWarning || '账号资料已更新。其他已登录设备需要重新登录。';
    toast('账号名称或密码已更新。');
  } catch (cause) { status.textContent = cause?.message || '账号资料更新失败，请稍后重试。'; }
  finally { button.disabled = false; }
}

async function saveProfile() {
  const button = $('#profileSaveButton');
  const status = $('#profileSaveStatus');
  button.disabled = true; status.textContent = '正在保存公开资料…';
  try {
    const result = await desktop.savePublicProfile(profilePayload());
    state.profile = result.profile;
    state.displayName = state.profile.displayName || '';
    updateAccountPresentation();
    $('#accountDisplayNameSetting').value = state.displayName;
    status.textContent = '已保存，其他玩家现在可以查看。';
    openProfile(state.username);
  } catch (cause) { status.textContent = cause?.message || '保存失败，请稍后再试。'; }
  finally { button.disabled = false; }
}

function populateSettings() {
  const prefs = state.preferences;
  $('#accountUsernameSetting').value = state.username || '';
  $('#accountDisplayNameSetting').value = state.displayName || '';
  $('#accountCurrentPasswordSetting').value = '';
  $('#accountNewPasswordSetting').value = '';
  $('#accountConfirmPasswordSetting').value = '';
  $('#themeSelect').value = prefs.theme || 'dark';
  $('#navigationPolicySetting').value = prefs.navigationPolicy || 'allowlist';
  $('#allowedHostsSetting').value = (prefs.allowedHosts || []).join('\n');
  $('#blockedHostsSetting').value = (prefs.blockedHosts || []).join('\n');
  $('#allowHttpSetting').checked = prefs.allowHttp === true;
  $('#allowLocalNetworkSetting').checked = prefs.allowLocalNetwork === true;
  $('#allowPopupsSetting').checked = prefs.allowPopups === true;
  $('#downloadsEnabledSetting').checked = prefs.downloadsEnabled === true;
  $('#downloadBaseUrlSetting').value = prefs.downloadBaseUrl || '';
  $('#downloadDirectorySetting').value = prefs.downloadDirectory || '';
  $('#closeToTraySetting').checked = prefs.closeToTray !== false;
  $$('[data-site-permission]').forEach((checkbox) => { checkbox.checked = (prefs.allowedPermissions || []).includes(checkbox.dataset.sitePermission); });
}

function showSettings() {
  stopPreview();
  closeSiteAndHide();
  populateSettings();
  showPage('settings');
  loadOwnDisplayName();
  $('#settingsTitle').focus({ preventScroll: true });
}

function parseHostLines(value) { return [...new Set(value.split(/[\n,;\s]+/).map((host) => host.trim().toLowerCase()).filter(Boolean))]; }
async function saveSettings({ quiet = false } = {}) {
  const allowedHosts = parseHostLines($('#allowedHostsSetting').value);
  const blockedHosts = parseHostLines($('#blockedHostsSetting').value);
  const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if ([...allowedHosts, ...blockedHosts].some((host) => !hostnamePattern.test(host))) { $('#settingsSaveStatus').textContent = '站点列表包含无效域名，请检查后重试。'; return; }
  let downloadBaseUrl;
  try { downloadBaseUrl = new URL($('#downloadBaseUrlSetting').value).toString(); if (!downloadBaseUrl.startsWith('https:')) throw new Error(); }
  catch { $('#settingsSaveStatus').textContent = '下载地址必须是完整 HTTPS 地址。'; return; }
  const downloadUrl = new URL(downloadBaseUrl);
  if (downloadBaseUrl.length > 600 || downloadUrl.username || downloadUrl.password) { $('#settingsSaveStatus').textContent = '下载地址不能包含账号密码，且长度不能超过 600 个字符。'; return; }
  const allowHttp = $('#allowHttpSetting').checked;
  const allowedPermissions = $$('[data-site-permission]:checked').map((checkbox) => checkbox.dataset.sitePermission);
  const next = {
    theme: $('#themeSelect').value, closeToTray: $('#closeToTraySetting').checked,
    navigationPolicy: $('#navigationPolicySetting').value, allowedHosts, blockedHosts,
    allowHttp, allowLocalNetwork: $('#allowLocalNetworkSetting').checked, allowPopups: $('#allowPopupsSetting').checked,
    downloadBaseUrl, downloadsEnabled: $('#downloadsEnabledSetting').checked,
    downloadDirectory: state.preferences.downloadDirectory || '', allowedPermissions,
  };
  const previous = { ...state.preferences };
  try {
    await savePreferences(next);
    applyTheme(next.theme);
    $('#settingsSaveStatus').textContent = '设置已即时保存到本机。';
    if (!quiet) toast('设置已即时保存。');
  } catch { state.preferences = previous; applyTheme(previous.theme); populateSettings(); $('#settingsSaveStatus').textContent = '无法保存设置，请检查本机磁盘空间后重试。'; }
}

function queueSettingsSave() {
  clearTimeout(settingsSaveTimer);
  const revision = ++settingsRevision;
  settingsSaveTimer = window.setTimeout(async () => {
    if (revision !== settingsRevision || document.body.dataset.page !== 'settings') return;
    await saveSettings({ quiet: true });
  }, 180);
}

function startPreview(feature) {
  stopPreview();
  if (state.installed.has(feature.id)) return;
  previewFeatureId = feature.id;
  $('#previewProgress').hidden = false;
  $('#detailStatus').textContent = '安装预览';
  $('#detailStatus').classList.add('is-installing');
  let progress = 0;
  const update = () => {
    $('#progressValue').textContent = `${progress}%`;
    $('#progressLabel').textContent = progress < 100 ? `界面预览 · ${progress}%` : '预览完成 · 实际状态仍为未安装';
    $('#progressBar').style.width = `${progress}%`;
  };
  update();
  previewTimer = window.setInterval(() => {
    progress = Math.min(100, progress + 17);
    update();
    if (progress >= 100) {
      clearInterval(previewTimer);
      previewTimer = window.setTimeout(() => {
        previewTimer = 0;
        previewFeatureId = null;
        $('#detailStatus').textContent = '尚未上架';
        $('#detailStatus').classList.remove('is-installing');
        $('#progressLabel').textContent = '预览结束 · 没有修改本机安装状态';
        toast('这是动画预览，功能仍未安装。');
      }, 1450);
    }
  }, reduceMotion.matches ? 35 : 420);
}

function stopPreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = 0;
  const previousId = previewFeatureId;
  previewFeatureId = null;
  const status = $('#detailStatus');
  if (status?.classList.contains('is-installing')) {
    status.textContent = state.installed.has(state.selected) ? '已安装' : '尚未上架';
    status.classList.remove('is-installing');
    $('#previewProgress').hidden = true;
  }
}

function renderComments(comments) {
  const list = $('#commentList');
  $('#commentCount').textContent = `${comments.length} 条`;
  list.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement('p');
    empty.className = 'comment-empty'; empty.textContent = '还没有留言。来说第一句吧。'; list.append(empty); return;
  }
  for (const comment of comments) {
    const item = document.createElement('article'); item.className = 'comment-item';
    const heading = document.createElement('div');
    const author = document.createElement('strong'); author.textContent = String(comment.username || '雨巷来客');
    const date = document.createElement('time');
    const seconds = Number(comment.createdAt);
    date.dateTime = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : '';
    date.textContent = Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleDateString('zh-CN') : '';
    const body = document.createElement('p'); body.textContent = String(comment.body || '');
    heading.append(author, date); item.append(heading, body); list.append(item);
  }
}

let communityUntil = 0;
let communityBusy = false;
let communityUnlimited = false;
let communityTimer;
function setCommunityStatus(value) {
  if (!value) return;
  communityUnlimited = value.unlimited === true;
  communityUntil = communityUnlimited ? 0 : Date.now() + Math.max(0, (value.nextAllowedAt - value.serverNow) * 1000);
  renderCommunityStatus();
}
function renderCommunityStatus() {
  clearTimeout(communityTimer);
  const button = $('#commentSubmit');
  if (!button) return;
  const remaining = Math.max(0, Math.ceil((communityUntil - Date.now()) / 1000));
  button.disabled = communityBusy || remaining > 0;
  button.textContent = communityBusy ? '正在寄出…' : remaining ? `等待 ${String(Math.floor(remaining / 3600)).padStart(2,'0')}:${String(Math.floor(remaining % 3600 / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}` : '寄出留言';
  const hint = $('#communityLockHint');
  if (hint) hint.textContent = communityUnlimited ? '雨巷主理人 · 留言与评论不限频次' : remaining ? '留言与评论共用一小时等待时间，其他功能仍可正常使用。' : '留言与评论共用一小时等待时间，成功寄出后开始计时。';
  if (remaining) communityTimer = setTimeout(renderCommunityStatus, 1000);
}
async function loadComments(featureId) {
  const request = ++commentRequest;
  try {
    const result = await desktop.getComments(featureId);
    if (request !== commentRequest || state.selected !== featureId) return;
    setCommunityStatus(result?.community);
    renderComments(Array.isArray(result?.comments) ? result.comments : []);
  } catch (cause) {
    if (request !== commentRequest) return;
    $('#commentList').innerHTML = `<p class="comment-empty">${escapeHtml(cause?.message || '留言暂时无法载入。')}</p>`;
  }
}

function setAuthMessage(message, success = false) {
  authFeedback.textContent = message;
  authFeedback.classList.toggle('is-success', success);
}

function setAuthMode(mode) {
  const register = mode === 'register';
  registerForm.hidden = !register;
  loginForm.hidden = register;
  $('#authTitle').innerHTML = register ? '实用工具，<br /><span>从这里开始。</span>' : '欢迎回来，<br /><span>雨巷来信。</span>';
  $('.auth-lede').innerHTML = register ? '登录后即可使用桌面功能、网页收藏与工具集合。<br />也可以一键创建账号并保存本机凭据。' : '带上账号图片里的账号和密码，<br />继续使用你的工具集合。';
  setAuthMessage('');
  (register ? $('#registerSubmit') : $('#loginUsername')).focus({ preventScroll: true });
}

function credentialImage(username, password) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 680;
  const ctx = canvas.getContext('2d', { alpha: false });
  const gradient = ctx.createLinearGradient(0, 0, 1200, 680);
  gradient.addColorStop(0, '#111111'); gradient.addColorStop(.54, '#050505'); gradient.addColorStop(1, '#1b1b1b');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
  for (let x = 22; x < 1200; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 180, 680); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,.48)'; ctx.lineWidth = 2; ctx.strokeRect(36, 36, 1128, 608);
  ctx.fillStyle = '#70d9df'; ctx.font = '600 22px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; ctx.fillText('雨巷来信  ·  私密账号卡', 86, 104);
  ctx.fillStyle = '#ffffff'; ctx.font = '600 42px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; ctx.fillText('请把这张图片收好', 86, 184);
  ctx.fillStyle = '#c8c8c8'; ctx.font = '22px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; ctx.fillText('密码以明文保存在图片中。请勿公开分享或上传到公共网盘。', 86, 228);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(72, 272, 1056, 268);
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.strokeRect(72, 272, 1056, 268);
  ctx.fillStyle = '#c8c8c8'; ctx.font = '20px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; ctx.fillText('登录账号', 110, 330);
  ctx.fillStyle = '#ffffff'; ctx.font = '600 37px "Cascadia Mono", Consolas, monospace'; ctx.fillText(username, 110, 378);
  ctx.fillStyle = '#c8c8c8'; ctx.font = '20px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; ctx.fillText('明文密码', 110, 442);
  ctx.fillStyle = '#70d9df'; ctx.font = '600 29px "Cascadia Mono", Consolas, monospace'; ctx.fillText(password, 110, 490, 980);
  ctx.fillStyle = '#a6a6a6'; ctx.font = '16px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; ctx.fillText(`生成时间  ${new Date().toLocaleString('zh-CN')}`, 86, 602);
  return canvas.toDataURL('image/png');
}

function openCredentialDialog(dataUrl, savedPath, saveError = '') {
  credentialDataUrl = dataUrl || credentialDataUrl;
  $('#credentialsImage').src = credentialDataUrl;
  $('#credentialsPath').textContent = savedPath || saveError || '账号已登录；请立即重试保存账号图片。';
  $('#credentialRetryButton').hidden = !saveError;
  $('#credentialOpenButton').hidden = !savedPath;
  credentialsOverlay.hidden = false;
  $('#credentialDoneButton').focus({ preventScroll: true });
}

async function savePendingCredentials() {
  if (!pendingCredentials) return;
  try {
    const result = await desktop.saveCredentialImage(pendingCredentials.dataUrl, pendingCredentials.username);
    lastCredentialPath = result.path;
    $('#credentialsPath').textContent = result.path;
    $('#credentialRetryButton').hidden = true;
    $('#credentialOpenButton').hidden = false;
    pendingCredentials = null;
    credentialsOverlay.dataset.celebrate = 'true';
    setAuthMessage('新账号已经登录，账号图片已保存到本机图片文件夹。', true);
  } catch (cause) {
    $('#credentialsPath').textContent = `保存失败：${cause?.message || '请检查图片文件夹权限后重试。'}`;
    $('#credentialRetryButton').hidden = false;
    $('#credentialOpenButton').hidden = true;
  }
}

function enterHome(profile) {
  state.username = profile.username;
  state.role = profile.role || 'player';
  setCommunityStatus(profile.community || { unlimited: state.role === 'root', nextAllowedAt: 0, serverNow: Date.now() / 1000 });
  state.displayName = profile.displayName || state.displayName || '';
  state.installed = new Set(Array.isArray(profile.installedFeatures) ? profile.installedFeatures : ['street-postcard']);
  state.installed.add('street-postcard');
  if (profile.preferences) state.preferences = { ...state.preferences, ...profile.preferences };
  applyTheme(state.preferences.theme);
  state.selected = state.preferences.selectedFeature || 'street-postcard';
  if (!features.some((feature) => feature.id === state.selected)) state.selected = 'street-postcard';
  state.preferences.selectedFeature = state.selected;
  updateAccountPresentation();
  authScreen.hidden = true;
  updateInstallationSummary();
  renderFeatures();
  renderHeroHighlights();
  showPage('scene');
  renderHeroHighlights();
}

async function submitLogin(event) {
  event.preventDefault();
  if (authBusy) return;
  authBusy = true; $('#loginSubmit').disabled = true; setAuthMessage('正在验证账号…');
  try {
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    const profile = await desktop.login({ username, password });
    $('#loginPassword').value = '';
    enterHome(profile);
    toast(profile.recoveryWarning || '欢迎回到雨巷来信。');
  } catch (cause) { setAuthMessage(cause?.message || '登录暂时没有完成，请稍后重试。'); }
  finally { authBusy = false; $('#loginSubmit').disabled = false; }
}

async function submitRegister(event) {
  event.preventDefault();
  if (authBusy) return;
  authBusy = true; $('#registerSubmit').disabled = true; $('#registerSubmit span').textContent = '正在为你准备账号…'; setAuthMessage('正在创建账号并安全登录…');
  try {
    const credentials = await desktop.registerAccount();
    enterHome(credentials.profile);
    const dataUrl = credentialImage(credentials.username, credentials.password);
    pendingCredentials = { username: credentials.username, password: credentials.password, dataUrl };
    openCredentialDialog(dataUrl, '正在保存账号图片…');
    await savePendingCredentials();
  } catch (cause) { setAuthMessage(cause?.message || '注册暂时没有完成，请稍后重试。'); }
  finally { authBusy = false; $('#registerSubmit').disabled = false; $('#registerSubmit span').textContent = '一键注册并进入主页'; }
}

function showAuth() {
  desktop?.developerAvailable?.().then(available => { $('#developerLoginButton').hidden = !available; }).catch(() => {});
  credentialsOverlay.hidden = true;
  showPage('none');
  authScreen.hidden = false;
  setAuthMode('register');
}

async function boot() {
  const settingsGrid = settingsPage?.querySelector('.settings-grid');
  if (settingsGrid && !$('#privacyToolsCard')) {
    settingsGrid.insertAdjacentHTML('beforeend', '<section class="settings-card privacy-tools-card" id="privacyToolsCard"><h2>隐私与本机数据</h2><p>清除站点数据可退出网页登录状态；清除应用数据会退出雨巷账号并重置本机偏好。</p><div class="privacy-tools-actions"><button type="button" id="clearBrowserDataButton">清除网页浏览数据</button><button type="button" id="clearAppDataButton">清除全部应用数据</button></div></section>');
  }
  featureGrid.addEventListener('wheel', (event) => { if (event.deltaY > 0) requestMoreCatalog(); }, { passive: true });
  featureGrid.addEventListener('touchstart', (event) => { featureGrid.dataset.touchY = String(event.touches[0]?.clientY || 0); }, { passive: true });
  featureGrid.addEventListener('touchend', (event) => {
    const start = Number(featureGrid.dataset.touchY || 0);
    const end = Number(event.changedTouches[0]?.clientY || start);
    if (start - end > 24) requestMoreCatalog();
  }, { passive: true });
  featureGrid.addEventListener('click', (event) => {
    const bookmarkDelete = event.target.closest('[data-bookmark-delete]');
    if (bookmarkDelete) {
      const next = webBookmarks().filter((item) => item.url !== bookmarkDelete.dataset.bookmarkDelete);
      savePreferences({ webBookmarks: next }).then(() => { renderFeatures(); toast('已删除网页收藏。'); }).catch(() => toast('无法保存网页收藏变更。'));
      return;
    }
    const bookmarkOpen = event.target.closest('[data-bookmark-open]');
    if (bookmarkOpen) { openWebBookmark(bookmarkOpen.dataset.bookmarkOpen).catch((cause) => toast(cause?.message || '网页暂时无法打开。')); return; }
    const favorite = event.target.closest('[data-favorite-id]');
    if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favoriteId); return; }
    const card = event.target.closest('[data-feature-id]');
    if (card) openFeature(card.dataset.featureId);
  });
  const handleEnvelopeAction = (event) => {
    const favorite = event.target.closest('[data-favorite-id]');
    if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favoriteId, { animateHome: true }); return; }
    const card = event.target.closest('[data-feature-id]');
    if (card) openEnvelopeFeature(card.dataset.featureId);
  };
  $('#sceneFeatureRail')?.addEventListener('click', handleEnvelopeAction);
  $('#homeLoadMore')?.addEventListener('click', loadMoreHomeFeatures);
  sceneHomePage?.addEventListener('scroll', () => {
    if (sceneHomePage.scrollTop > 24) homeHasScrolled = true;
    if (homeHasScrolled && sceneHomePage.scrollTop + sceneHomePage.clientHeight >= sceneHomePage.scrollHeight - 220) loadMoreHomeFeatures();
  }, { passive: true });
  if ('IntersectionObserver' in window && $('#homeLoadMore')) {
    homeLoadObserver = new IntersectionObserver((entries) => {
      if (homeHasScrolled && entries.some((entry) => entry.isIntersecting)) loadMoreHomeFeatures();
    }, { root: sceneHomePage, rootMargin: '0px 0px 72px', threshold: 0 });
    homeLoadObserver.observe($('#homeLoadMore'));
  }
  historyGrid?.addEventListener('click', handleEnvelopeAction);
  const activateCollectionCard = (event) => {
    if (event.target.closest('button, a')) return;
    const featureCard = event.target.closest('[data-feature-card]');
    if (featureCard) { openFeature(featureCard.dataset.featureCard); return; }
    const bookmarkCard = event.target.closest('[data-bookmark-card]');
    if (bookmarkCard) openWebBookmark(bookmarkCard.dataset.bookmarkCard).catch((cause) => toast(cause?.message || '网页暂时无法打开。'));
  };
  featureGrid?.addEventListener('click', activateCollectionCard);
  historyGrid?.addEventListener('click', activateCollectionCard);
  const activateWithKeyboard = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-feature-card], [data-bookmark-card]');
    if (!card || event.target !== card) return;
    event.preventDefault();
    if (card.dataset.featureCard) openFeature(card.dataset.featureCard);
    else openWebBookmark(card.dataset.bookmarkCard).catch((cause) => toast(cause?.message || '网页暂时无法打开。'));
  };
  featureGrid?.addEventListener('keydown', activateWithKeyboard);
  historyGrid?.addEventListener('keydown', activateWithKeyboard);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    showCollection({ focus: false });
    setFilter(button.dataset.filter);
  });
  $('#sceneNavButton')?.addEventListener('click', showScene);
  $('#collectionNavButton')?.addEventListener('click', () => showCollection());
  $('#profileNavButton')?.addEventListener('click', () => openProfile());
  $('#newBrowserTabButton')?.addEventListener('click', () => createBlankBrowserTab().catch(() => toast('新标签页暂时无法创建。', 'error')));
  $('#browserTabs')?.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-browser-tab]');
    if (close) { closeBrowserTab(close.dataset.closeBrowserTab).catch(() => {}); return; }
    const tab = event.target.closest('[data-browser-tab]');
    if (tab) activateBrowserTab(tab.dataset.browserTab).catch(() => {});
  });
  let draggedTabId = '';
  $('#websiteTabs')?.addEventListener('dragstart', (event) => {
    const tab = event.target.closest('[data-sort-tab]');
    if (!tab) return;
    draggedTabId = tab.dataset.sortTab;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedTabId);
    tab.classList.add('is-dragging');
  });
  $('#websiteTabs')?.addEventListener('dragend', () => { draggedTabId = ''; $$('.browser-tab').forEach((tab) => tab.classList.remove('is-dragging', 'drop-before', 'drop-after')); });
  $('#websiteTabs')?.addEventListener('dragover', (event) => {
    const target = event.target.closest('[data-sort-tab]');
    if (!draggedTabId || !target || target.dataset.sortTab === draggedTabId) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    target.classList.toggle('drop-before', event.clientX < rect.left + rect.width / 2);
    target.classList.toggle('drop-after', event.clientX >= rect.left + rect.width / 2);
  });
  $('#websiteTabs')?.addEventListener('drop', (event) => {
    const target = event.target.closest('[data-sort-tab]');
    if (!draggedTabId || !target || target.dataset.sortTab === draggedTabId) return;
    event.preventDefault();
    const from = browserTabs.findIndex((tab) => tab.id === draggedTabId);
    const to = browserTabs.findIndex((tab) => tab.id === target.dataset.sortTab);
    if (from < 0 || to < 0) return;
    const [moved] = browserTabs.splice(from, 1);
    browserTabs.splice(to + (event.clientX >= target.getBoundingClientRect().left + target.offsetWidth / 2 ? 1 : 0), 0, moved);
    renderBrowserTabs();
  });
  $('#favoritesModeButton')?.addEventListener('click', () => setCollectionMode('favorites'));
  $('#historyModeButton')?.addEventListener('click', () => setCollectionMode('history'));
  $('#allFeaturesModeButton')?.addEventListener('click', () => setCollectionMode('all'));
  $('#webBookmarksModeButton')?.addEventListener('click', () => setCollectionMode('web'));
  $('#openHistoryButton')?.addEventListener('click', () => { setCollectionMode('history'); $('#historyModeButton')?.focus({ preventScroll: true }); });
  $('#settingsButton')?.addEventListener('click', showSettings);
  $$('[data-page="scene"]').forEach((button) => button.addEventListener('click', showScene));
  $('#profileSaveButton')?.addEventListener('click', saveProfile);
  $('#saveDisplayNameButton')?.addEventListener('click', saveDisplayName);
  $('#saveAccountButton')?.addEventListener('click', saveAccountChanges);
  $('#saveSettingsButton')?.addEventListener('click', saveSettings);
  $('#themeSelect')?.addEventListener('change', (event) => applyTheme(event.currentTarget.value));
  settingsPage?.addEventListener('input', (event) => {
    if (event.target.closest('.account-settings-card')) return;
    queueSettingsSave();
  });
  settingsPage?.addEventListener('change', (event) => {
    if (event.target.closest('.account-settings-card')) return;
    if (event.target.id === 'themeSelect') applyTheme(event.target.value);
    queueSettingsSave();
  });
  $('#chooseDownloadDirectoryButton')?.addEventListener('click', async () => {
    try {
      const directory = await desktop.chooseDownloadDirectory();
      if (directory) {
        const previous = state.preferences.downloadDirectory;
        state.preferences.downloadDirectory = directory;
        $('#downloadDirectorySetting').value = directory;
        try { await savePreferences({ downloadDirectory: directory }); $('#settingsSaveStatus').textContent = '下载文件夹已更新。'; }
        catch { state.preferences.downloadDirectory = previous; $('#downloadDirectorySetting').value = previous; $('#settingsSaveStatus').textContent = '无法保存下载文件夹，请检查本机磁盘空间。'; }
      }
    } catch (cause) { $('#settingsSaveStatus').textContent = cause?.message || '无法选择网页下载文件夹。'; }
  });
  $('#openDownloadBaseUrlButton')?.addEventListener('click', () => navigateAddress($('#downloadBaseUrlSetting').value));
  $('#addressForm')?.addEventListener('submit', (event) => { event.preventDefault(); navigateAddress($('#appAddressInput').value); });
  $('#appAddressInput')?.addEventListener('keydown', (event) => { if (event.key === 'Escape') { updateAddress(routeStack[routeIndex], false); event.currentTarget.blur(); } });
  $('#addressBack')?.addEventListener('click', () => moveAddressHistory(-1));
  $('#addressForward')?.addEventListener('click', () => moveAddressHistory(1));
  $('#addressRefresh')?.addEventListener('click', () => !sitePage.hidden ? desktop.reloadWebsite(activeSiteTabId).catch(() => {}) : navigateAddress(routeStack[routeIndex], false, true));
  $('#siteWarningOpen')?.addEventListener('click', openPendingSite);
  $('#siteWarningCancel')?.addEventListener('click', () => {
    if (siteWarningOverlay.dataset.kind === 'http') $('#allowHttpSetting').checked = false;
    if (siteWarningOverlay.dataset.kind === 'local-network') $('#allowLocalNetworkSetting').checked = false;
    pendingSiteUrl = ''; pendingHttpUrl = ''; siteWarningOverlay.hidden = true; scheduleSiteBounds();
  });
  $('#allowHttpSetting')?.addEventListener('change', (event) => {
    if (event.currentTarget.checked && !state.preferences.allowHttp) {
      event.currentTarget.checked = false;
      pendingHttpUrl = '';
      siteWarningOverlay.dataset.kind = 'http-setting';
      $('#siteWarningTitle').textContent = '开启 HTTP 明文网页';
      $('#siteWarningText').textContent = 'HTTP 站点不会加密传输内容。启用后会允许你访问明确许可的 HTTP 域名。';
      $('#siteWarningUrl').textContent = '仅使用你信任的地址';
      $('#siteWarningOpen').textContent = '确认开启 HTTP';
      siteWarningOverlay.hidden = false;
    }
  });
  $('#allowLocalNetworkSetting')?.addEventListener('change', (event) => {
    if (event.currentTarget.checked && !state.preferences.allowLocalNetwork) {
      event.currentTarget.checked = false;
      siteWarningOverlay.dataset.kind = 'local-setting';
      $('#siteWarningTitle').textContent = '开启本机与局域网访问';
      $('#siteWarningText').textContent = '本机和局域网网页可能访问路由器与附近设备。只在你信任相关地址时启用。';
      $('#siteWarningUrl').textContent = '仅应用于 HTTP / HTTPS 地址';
      $('#siteWarningOpen').textContent = '确认开启局域网';
      siteWarningOverlay.hidden = false;
    }
  });
  catalogPagination?.addEventListener('click', appendCatalogBatch);
  $('#openCollectionButton')?.addEventListener('click', () => showCollection());
  $('#heroCollectionButton')?.addEventListener('click', () => showCollection());
  $$('[data-hero-jump]').forEach((button) => button.addEventListener('click', () => {
    const next = button.dataset.heroJump || 'all';
    setFilter(next);
    showCollection({ focus: false });
  }));
  $('#sceneResetButton')?.addEventListener('click', showScene);
  $('#detailBack').addEventListener('click', goCollection);
  siteBookmarkButton?.addEventListener('click', () => toggleWebBookmark());
  siteLinkSwiftButton?.addEventListener('click', enableLinkSwift);
  $('#netdiskBack')?.addEventListener('click', goCollection);
  $('#netdiskResolveButton')?.addEventListener('click', resolveNetdisk);
  $('#netdiskOpenButton')?.addEventListener('click', openNetdiskShare);
  $('#netdiskClearButton')?.addEventListener('click', () => { $('#netdiskInput').value = ''; currentNetdiskLinks = []; pendingNetdiskShare = null; $('#netdiskProviderLabel').textContent = '等待粘贴链接'; $('#netdiskResultList').innerHTML = '<div class="netdisk-empty">识别出的下载地址会显示在这里。</div>'; $('#netdiskCopyAllButton').disabled = true; $('#netdiskOpenButton').disabled = true; setNetdiskStatus('输入已清空。'); $('#netdiskInput').focus(); });
  $('#netdiskResultList')?.addEventListener('click', async (event) => { const button = event.target.closest('[data-netdisk-copy]'); if (!button) return; const item = currentNetdiskLinks[Number(button.dataset.netdiskCopy)]; if (!item?.url) return; try { await desktop.copyText(item.url); toast('下载地址已复制。'); } catch { toast('复制失败，请手动选择地址。'); } });
  $('#netdiskCopyAllButton')?.addEventListener('click', async () => { if (!currentNetdiskLinks.length) return; try { await desktop.copyText(currentNetdiskLinks.map((item) => item.url).join('\n')); toast(`已复制 ${currentNetdiskLinks.length} 个地址。`); } catch { toast('复制失败，请手动选择地址。'); } });
  $('#siteGoBack')?.addEventListener('click', () => desktop.goBackWebsite(activeSiteTabId).catch(() => {}));
  $('#siteGoForward')?.addEventListener('click', () => desktop.goForwardWebsite(activeSiteTabId).catch(() => {}));
  $('#siteReload')?.addEventListener('click', async () => {
    sitePlaceholder.hidden = false; $('#sitePlaceholderTitle').textContent = '正在重新载入';
    try { await desktop.reloadWebsite(activeSiteTabId); }
    catch (cause) { $('#sitePlaceholderTitle').textContent = '暂时无法载入'; $('#sitePlaceholderText').textContent = cause?.message || '请稍后重试。'; }
  });
  $('#minimizeButton').addEventListener('click', () => desktop?.minimize());
  $('#trayButton')?.addEventListener('click', () => desktop?.minimizeToTray());
  $('#maximizeButton')?.addEventListener('click', async (event) => {
    const maximized = await desktop?.maximize();
    setMaximizedButton(event.currentTarget, maximized);
  });
  $('#exitButton')?.addEventListener('click', () => desktop?.quit());
  $('#closeButton')?.addEventListener('click', () => desktop?.closeToTray());
  $('#downloadFolderButton')?.addEventListener('click', () => showDownloads().catch((cause) => toast(cause?.message || '无法读取下载记录。', 'error')));
  const closeDownloads = () => { $('#downloadsOverlay').hidden = true; if (!sitePage.hidden) scheduleSiteBounds(); };
  $('#downloadsClose')?.addEventListener('click', closeDownloads);
  $('#downloadsOverlay')?.addEventListener('click', (event) => { if (event.target.id === 'downloadsOverlay') closeDownloads(); });
  $('#downloadsFolderOpen')?.addEventListener('click', async () => { try { await desktop.openDownloadDirectory(); } catch (cause) { toast(cause?.message || '下载文件夹不可用，请在设置中重新选择。', 'error'); } });
  $('#downloadsList')?.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-download-action]');
    const open = event.target.closest('[data-download-open]');
    try {
      if (action) await desktop.controlDownload(action.dataset.downloadId, action.dataset.downloadAction);
      if (open) await desktop.openDownloadedFile(open.dataset.downloadOpen);
      renderDownloads(await desktop.listDownloads().catch(() => []));
    } catch (cause) { toast(cause?.message || '下载操作未完成。', 'error'); }
  });
  $('#clearBrowserDataButton')?.addEventListener('click', () => showDataClearConfirmation('clear-browser-data'));
  $('#clearAppDataButton')?.addEventListener('click', () => showDataClearConfirmation('clear-app-data'));
  $('#openDownloadDirectorySettingButton')?.addEventListener('click', async () => {
    try { await desktop.openDownloadDirectory(); }
    catch (cause) { $('#settingsSaveStatus').textContent = cause?.message || '下载文件夹不可用，请重新选择。'; }
  });
  $('#authMinimizeButton').addEventListener('click', () => desktop?.minimize());
  $('#authTrayButton')?.addEventListener('click', () => desktop?.minimizeToTray());
  $('#authExitButton')?.addEventListener('click', () => desktop?.quit());
  loginForm.addEventListener('submit', submitLogin);
  const developerButton = $('#developerLoginButton');
  desktop?.developerAvailable?.().then(available => { developerButton.hidden = !available; }).catch(() => {});
  developerButton.addEventListener('click', async () => {
    if (authBusy) return;
    authBusy = true; developerButton.disabled = true; setAuthMessage('正在使用本机保存的主理人账号…');
    try { enterHome(await desktop.developerLogin()); toast('欢迎回来，雨巷主理人。'); }
    catch (cause) { setAuthMessage(cause?.message || '主理人登录未完成，请稍后重试。'); }
    finally { authBusy = false; developerButton.disabled = false; }
  });
  registerForm.addEventListener('submit', submitRegister);
  $$('[data-auth-view]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authView)));
  $('#credentialRetryButton').addEventListener('click', savePendingCredentials);
  $('#credentialDoneButton').addEventListener('click', () => {
    credentialsOverlay.hidden = true;
    if (credentialsOverlay.dataset.celebrate) { delete credentialsOverlay.dataset.celebrate; celebrateMilestone('account-created'); }
    pendingCredentials = null;
    credentialDataUrl = null;
    $('#credentialsImage').removeAttribute('src');
    $('#openCollectionButton')?.focus({ preventScroll: true });
  });
  $('#credentialOpenButton').addEventListener('click', async () => {
    try { if (lastCredentialPath) await desktop.showCredentialImage(lastCredentialPath); }
    catch (cause) { $('#credentialsPath').textContent = cause?.message || '无法打开账号图片所在文件夹。'; }
  });
  $('#accountMenuButton').addEventListener('click', () => {
    const popover = $('#accountPopover'); popover.hidden = !popover.hidden;
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#accountCard')) $('#accountPopover').hidden = true;
  });
  $('#openCredentialsButton').addEventListener('click', async () => {
    $('#accountPopover').hidden = true;
    try {
      const latest = await desktop.latestCredentialImage();
      if (!latest) { toast('还没有找到账号图片。'); return; }
      lastCredentialPath = latest;
      await desktop.showCredentialImage(latest);
    } catch (cause) { toast(cause?.message || '无法打开账号图片。'); }
  });
  $('#logoutButton').addEventListener('click', async () => {
    $('#accountPopover').hidden = true;
    try { await desktop.logout(); state.username = null; showAuth(); }
    catch (cause) { toast(cause?.message || '切换账号暂时没有完成。'); }
  });
  $('#commentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const feature = features.find((item) => item.id === state.selected);
    const body = $('#commentInput').value.trim();
    if (!feature || !body || communityBusy || communityUntil > Date.now()) return;
    communityBusy = true;
    const submit = $('#commentSubmit'); submit.disabled = true; submit.textContent = '正在寄出…';
    try {
      const result = await desktop.addComment(feature.id, body);
      setCommunityStatus(result?.community);
      $('#commentInput').value = '';
      await loadComments(feature.id);
      if (result?.comment && !$('#commentList .comment-item')) renderComments([result.comment]);
      toast('留言已经寄出。');
    } catch (cause) { toast(cause?.message || '留言暂时没有寄出，请稍后再试。'); await loadComments(feature.id); }
    finally { communityBusy = false; renderCommunityStatus(); }
  });
  new ResizeObserver(scheduleSiteBounds).observe(siteFrameShell);
  window.addEventListener('resize', scheduleSiteBounds);
  window.addEventListener('scroll', scheduleSiteBounds, true);
  document.addEventListener('visibilitychange', scheduleSiteBounds);
  desktop?.onSiteFailed((details) => {
    const tab = browserTabs.find((item) => item.id === details?.tabId);
    if (!tab) return;
    tab.loading = false;
    tab.loadError = details?.description || '检查网络后可重新载入，或者返回功能目录。';
    renderBrowserTabs();
    if (sitePage.hidden || details?.tabId !== activeSiteTabId) return;
    desktop.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, activeSiteTabId).catch(() => {});
    updateSitePlaceholder(tab);
  });
  desktop?.onSiteLoaded((details) => {
    const tab = browserTabs.find((item) => item.id === details?.tabId);
    if (!tab) return;
    tab.loading = false;
    tab.loadError = '';
    if (details?.url) tab.url = details.url;
    renderBrowserTabs();
    if (sitePage.hidden || details?.tabId !== activeSiteTabId) return;
    updateSitePlaceholder(tab);
    updateNavigationButtons();
  });
  desktop?.onSiteTitle((details) => {
    const tab = browserTabs.find((item) => item.id === details?.tabId);
    if (!tab) return;
    if (details.title) tab.title = details.title;
    if (details.url) tab.url = details.url;
    if (details.tabId === activeSiteTabId) { siteCurrentUrl = details.url || tab.url; updateAddress(siteCurrentUrl, false); updateSiteBookmarkButton(); updateSiteLinkSwiftButton(); }
    renderBookmarkCurrentTitle(details.url, details.title);
    renderBrowserTabs();
  });
  desktop?.onSiteBlocked((details) => {
    const tab = browserTabs.find((item) => item.id === details?.tabId);
    if (tab && details.url) tab.url = details.url;
    if (sitePage.hidden || details?.tabId !== activeSiteTabId) return;
    desktop.setWebsiteBounds({ x: 0, y: 0, width: 0, height: 0 }, activeSiteTabId).catch(() => {});
    sitePlaceholder.hidden = false; $('#sitePlaceholderTitle').textContent = '站点地址未通过校验'; $('#sitePlaceholderText').textContent = '为保护账号与本机环境，这次页面跳转已拦截。';
  });
  desktop?.onSiteNavigationRequested((request) => {
    if (!sitePage.hidden && request?.tabId === activeSiteTabId && request?.url) showSiteWarning(request.url);
  });
  desktop?.onSiteNavigated((details) => {
    const tab = browserTabs.find((item) => item.id === details?.tabId);
    if (!tab || typeof details?.url !== 'string') return;
    tab.url = details.url;
    tab.canGoBack = details.canGoBack === true;
    tab.canGoForward = details.canGoForward === true;
    if (details.tabId === activeSiteTabId) {
      siteCurrentUrl = details.url;
      updateAddress(details.url, false);
      updateSiteBookmarkButton();
      updateSiteLinkSwiftButton();
      updateNavigationButtons();
    }
    renderBrowserTabs();
  });
  desktop?.onLinkSwiftAuthFailed(() => toast('百度授权页暂时无法载入 LinkSwift 助手，请重新打开分享页后再试。'));
  desktop?.onDownloadBlocked(() => toast('网页下载已被拦截。可在设置中重新开启。', 'warning'));
  desktop?.onDownloadFolderMissing(() => toast('下载文件夹不可用，请在设置中重新选择。', 'error'));
  desktop?.onDownloadUpdate((details) => { updateDownloadIndicator(details); if (!$('#downloadsOverlay').hidden) desktop.listDownloads().then(renderDownloads).catch(() => {}); });
  desktop?.onShowHome(() => {
    document.documentElement.dataset.effectsPaused = 'false';
    credentialsOverlay.hidden = true;
    showScene();
  });
  desktop?.onWindowState((maximized) => {
    setMaximizedButton($('#maximizeButton'), maximized);
  });
  desktop?.isMaximized().then((maximized) => setMaximizedButton($('#maximizeButton'), maximized)).catch(() => {});
  $('.topbar')?.addEventListener('dblclick', (event) => {
    if (event.target.closest('button, a, input, .browser-tab, .window-actions')) return;
    desktop?.maximize().then((maximized) => setMaximizedButton($('#maximizeButton'), maximized)).catch(() => {});
  });
  $('#sitePlaceholder').hidden = false;
  showPage('none');
  renderFeatures();
  updateFeatureCounts();
  renderHeroHighlights();
  let savedState = {};
  try {
    savedState = await desktop?.getState() || {};
    if (savedState.preferences) state.preferences = { ...state.preferences, ...savedState.preferences };
  } catch { /* the UI can still start with its default dark palette */ }
  applyTheme(state.preferences.theme);
  updateInstallationSummary();
  try {
    const profile = await desktop.resumeAccount();
    if (profile) {
      enterHome({ ...savedState, ...profile, preferences: savedState.preferences });
      return;
    }
  } catch (cause) {
    setAuthMessage(cause?.message || '暂时无法连接账号服务。请检查网络后重试。');
  }
  authScreen.hidden = false;
  setAuthMode('register');
}

function goBack() {
  if (!credentialsOverlay.hidden) { $('#credentialDoneButton').click(); return; }
  if (!authScreen.hidden) return;
  if (!sitePage.hidden) { closeSiteAndHome(); return; }
  if (!detailPage.hidden) { goCollection(); return; }
  $('#accountPopover').hidden = true;
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') goBack();
});
if (reduceMotion.matches) document.documentElement.classList.add('reduced-motion');
boot().catch((cause) => {
  authScreen.hidden = false;
  setAuthMessage(cause?.message || '页面初始化遇到问题，请重启应用后重试。');
});
