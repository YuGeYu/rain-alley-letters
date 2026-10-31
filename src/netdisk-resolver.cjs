const PROVIDERS = [
  // `pageHosts` are the pages users open. `match` also covers the provider's
  // API/CDN subdomains that LinkSwift returns in a direct-link response.
  { id: 'baidu', name: '百度网盘', pageHosts: ['pan.baidu.com', 'yun.baidu.com'], hosts: ['pan.baidu.com', 'yun.baidu.com', 'baidupcs.com', 'pcs.baidu.com', 'openapi.baidu.com'], match: /(^|\.)baidu\.com$|(^|\.)baidupcs\.com$/i },
  { id: 'aliyun', name: '阿里云盘', pageHosts: ['www.aliyundrive.com', 'aliyundrive.com', 'www.alipan.com', 'alipan.com'], hosts: ['www.aliyundrive.com', 'www.alipan.com', 'alipan.com', 'aliyundrive.com', 'aliyundrive.net', 'api.aliyundrive.com', 'alicloudccp.com', 'aliyundrive.cloud'], match: /(^|\.)((aliyundrive|alipan)\.(com|net|cloud)|alicloudccp\.com)$/i },
  { id: 'mcloud', name: '中国移动云盘', pageHosts: ['yun.139.com', 'caiyun.139.com'], hosts: ['yun.139.com', 'caiyun.139.com', 'cmecloud.cn', 'personal-kd-njs.yun.139.com'], match: /(^|\.)(139\.com|cmecloud\.cn)$/i },
  { id: 'tianyi', name: '天翼云盘', pageHosts: ['cloud.189.cn'], hosts: ['cloud.189.cn', '189.cn', 'api.cloud.189.cn'], match: /(^|\.)189\.cn$/i },
  { id: 'xunlei', name: '迅雷云盘', pageHosts: ['pan.xunlei.com'], hosts: ['pan.xunlei.com', 'xunlei.com', 'api-pan.xunlei.com'], match: /(^|\.)xunlei\.com$/i },
  { id: 'quark', name: '夸克网盘', pageHosts: ['pan.quark.cn'], hosts: ['pan.quark.cn', 'quark.cn', 'drive-pc.quark.cn'], match: /(^|\.)quark\.cn$/i },
  { id: 'uc', name: 'UC 网盘', pageHosts: ['drive.uc.cn'], hosts: ['drive.uc.cn', 'uc.cn', 'pc-api.uc.cn'], match: /(^|\.)uc\.cn$/i },
  { id: '123pan', name: '123 云盘', pageHosts: ['www.123pan.com', '123pan.com', '123pan.cn', '123684.com', '123865.com', '123952.com', '123912.com'], hosts: ['www.123pan.com', '123pan.com', '123pan.cn', '123684.com', '123865.com', '123952.com', '123912.com', 'login.123pan.com', 'cjjd19.com'], match: /(^|\.)((123pan\.(com|cn))|123(684|865|952|912)\.com|cjjd19\.com)$/i },
];
const PROVIDER_HOSTS = new Set(PROVIDERS.flatMap((item) => item.hosts));
const LINKSWIFT_BAIDU_CLIENT_ID = 'omiOnr2tYnN9vSyDErcVFWpPU2mZA7YO';

function normalizeInput(value) { return String(value || '').trim().replace(/[\u0000-\u001f]/g, ''); }
function parseUrl(value) {
  try { const candidate = normalizeInput(value); return new URL(/^[a-z][a-z\d+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`); } catch { return null; }
}
function providerFor(url) {
  if (!url || !['http:', 'https:'].includes(url.protocol)) return null;
  return PROVIDERS.find((item) => item.match.test(url.hostname.toLowerCase())) || null;
}
function isSharePageUrl(url) {
  if (!url || !['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  return PROVIDERS.some((item) => item.pageHosts.includes(host));
}
function isLinkSwiftAuthorizeUrl(value) {
  let url;
  try { url = value instanceof URL ? value : new URL(String(value || '')); } catch { return false; }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'openapi.baidu.com' || url.username || url.password || url.hash || url.pathname !== '/oauth/2.0/authorize') return false;
  const allowedKeys = new Set(['response_type', 'scope', 'client_id', 'redirect_uri', 'confirm_login']);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) return false;
  for (const key of ['response_type', 'scope', 'client_id', 'redirect_uri']) if (url.searchParams.getAll(key).length !== 1) return false;
  if (url.searchParams.getAll('confirm_login').length > 1 || (url.searchParams.has('confirm_login') && url.searchParams.get('confirm_login') !== '0')) return false;
  const scopes = String(url.searchParams.get('scope') || '').split(/[,+\s]+/).filter(Boolean).sort();
  return url.searchParams.get('response_type') === 'token'
    && scopes.length === 2 && scopes[0] === 'basic' && scopes[1] === 'netdisk'
    && url.searchParams.get('client_id') === LINKSWIFT_BAIDU_CLIENT_ID
    && url.searchParams.get('redirect_uri') === 'oob';
}
function isLinkSwiftOAuthPageUrl(value) {
  let url;
  try { url = value instanceof URL ? value : new URL(String(value || '')); } catch { return false; }
  return url.protocol === 'https:' && url.hostname.toLowerCase() === 'openapi.baidu.com' && !url.username && !url.password
    && ['/oauth/2.0/authorize', '/oauth/2.0/login_success'].includes(url.pathname);
}
function decodeCandidate(value) {
  let result = String(value || '');
  for (let index = 0; index < 2; index += 1) { try { const decoded = decodeURIComponent(result); if (decoded === result) break; result = decoded; } catch { break; } }
  return result;
}
function collectUrls(value) {
  const source = normalizeInput(value);
  const candidates = [source, decodeCandidate(source), ...[...source.matchAll(/https?:\/\/[^\s<>"'，。；]+/gi)].map((match) => match[0])];
  const urls = [];
  for (const candidate of candidates) { const url = parseUrl(candidate.replace(/[),.;!?。，；）】]+$/g, '')); if (url && !urls.some((item) => item.toString() === url.toString())) urls.push(url); }
  return urls;
}
function isProviderHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return PROVIDERS.some((item) => item.match.test(host));
}
function isDirect(url) {
  if (!url || !providerFor(url)) return false;
  if (['pan.baidu.com', 'yun.baidu.com'].includes(url.hostname.toLowerCase()) && /^\/rest\/2\.0\//i.test(url.pathname)) return false;
  return /download|dlink|file|link|stream|clouddrive|openapi/.test(url.pathname.toLowerCase()) || /download|dlink|url=|link=|params=|sign=|token=|fid=|fileid=/.test(url.search.toLowerCase());
}
function directLinks(value) {
  const links = [];
  for (const url of collectUrls(value)) if (isDirect(url)) links.push({ url: url.toString(), filename: decodeCandidate(url.searchParams.get('filename') || url.searchParams.get('name') || '') || '网盘文件' });
  return links.filter((item, index) => links.findIndex((other) => other.url === item.url) === index);
}
function htmlTitle(text) {
  const match = String(text || '').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || String(text || '').match(/<title[^>]*>([^<]+)/i);
  return match ? match[1].trim().slice(0, 160) : '';
}
function extractEmbeddedLinks(text) {
  const matches = String(text || '').match(/https?:\\?\/\\?\/[^"'<>\s\\]+/gi) || [];
  return directLinks(matches.map((item) => item.replace(/\\\//g, '/')).join('\n'));
}

async function fetchSharePage(url) {
  let current = new URL(url);
  if (current.protocol !== 'https:' || !isSharePageUrl(current)) throw new Error('分享页域名不受支持。');
  let response;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetch(current.toString(), { redirect: 'manual', headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'RainAlley-LinkSwift/1.1.3' }, signal: AbortSignal.timeout(15000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 5) throw new Error('分享页跳转次数超出限制。');
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || !isSharePageUrl(next)) throw new Error('分享页尝试跳转到未许可域名。');
    current = next;
  }
  if (!response) throw new Error('网盘分享页无响应。');
  const chunks = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) { await reader.cancel(); throw new Error('分享页内容过大。'); }
      chunks.push(Buffer.from(value));
    }
  }
  return { response, body: Buffer.concat(chunks).toString('utf8') };
}

async function resolveNetdiskInput(input) {
  const raw = normalizeInput(input?.value ?? input);
  const direct = directLinks(raw);
  const firstUrl = collectUrls(raw)[0] || null;
  const provider = providerFor(firstUrl);
  if (direct.length) return { status: 'ready', provider, links: direct, url: firstUrl?.toString() || direct[0].url, message: `已识别 ${direct.length} 个可复制的下载地址。` };
  if (!provider || !firstUrl || !['https:', 'http:'].includes(firstUrl.protocol) || !isSharePageUrl(firstUrl)) return { status: 'invalid', provider: null, links: [], url: null, message: '请粘贴受支持的网盘分享页，或粘贴已经取得的下载地址。' };
  if (firstUrl.protocol !== 'https:') return { status: 'blocked', provider, links: [], url: firstUrl.toString(), message: '网盘工具只接受 HTTPS 分享页，明文 HTTP 地址已拦截。' };
  try {
    const { response, body } = await fetchSharePage(firstUrl);
    const embedded = extractEmbeddedLinks(body);
    if (embedded.length) return { status: 'ready', provider, links: embedded, url: response.url || firstUrl.toString(), title: htmlTitle(body), message: `已从 ${provider.name} 分享页识别 ${embedded.length} 个地址。` };
    return { status: 'needs-page', provider, links: [], url: response.url || firstUrl.toString(), title: htmlTitle(body), message: `${provider.name} 分享页已连通，但平台需要在已登录的分享页中由 LinkSwift 调用公开 API。点击“打开并启用助手”继续。` };
  } catch (cause) {
    return { status: 'needs-page', provider, links: [], url: firstUrl.toString(), message: `${provider.name} 分享页暂时无法由后台读取（${cause?.name === 'TimeoutError' ? '连接超时' : '跨域或网络限制'}）。请打开分享页并启用助手。` };
  }
}

module.exports = { PROVIDERS, PROVIDER_HOSTS, providerFor, isProviderHost, isSharePageUrl, isLinkSwiftAuthorizeUrl, isLinkSwiftOAuthPageUrl, resolveNetdiskInput };

