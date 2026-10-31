const providerDefinitions = [
  { id: 'baidu', name: '百度网盘', pageHosts: ['pan.baidu.com', 'yun.baidu.com'], hosts: ['pan.baidu.com', 'yun.baidu.com', 'baidupcs.com', 'pcs.baidu.com', 'openapi.baidu.com'], match: /(^|\.)baidu\.com$|(^|\.)baidupcs\.com$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: 'aliyun', name: '阿里云盘', pageHosts: ['www.aliyundrive.com', 'aliyundrive.com', 'www.alipan.com', 'alipan.com'], hosts: ['www.aliyundrive.com', 'www.alipan.com', 'alipan.com', 'aliyundrive.com', 'aliyundrive.net', 'api.aliyundrive.com', 'alicloudccp.com', 'aliyundrive.cloud'], match: /(^|\.)((aliyundrive|alipan)\.(com|net|cloud)|alicloudccp\.com)$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: 'mcloud', name: '中国移动云盘', pageHosts: ['yun.139.com', 'caiyun.139.com'], hosts: ['yun.139.com', 'caiyun.139.com', 'cmecloud.cn', 'personal-kd-njs.yun.139.com'], match: /(^|\.)(139\.com|cmecloud\.cn)$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: 'tianyi', name: '天翼云盘', pageHosts: ['cloud.189.cn'], hosts: ['cloud.189.cn', '189.cn', 'api.cloud.189.cn'], match: /(^|\.)189\.cn$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: 'xunlei', name: '迅雷云盘', pageHosts: ['pan.xunlei.com'], hosts: ['pan.xunlei.com', 'xunlei.com', 'api-pan.xunlei.com'], match: /(^|\.)xunlei\.com$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: 'quark', name: '夸克网盘', pageHosts: ['pan.quark.cn'], hosts: ['pan.quark.cn', 'quark.cn', 'drive-pc.quark.cn'], match: /(^|\.)quark\.cn$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: 'uc', name: 'UC 网盘', pageHosts: ['drive.uc.cn'], hosts: ['drive.uc.cn', 'uc.cn', 'pc-api.uc.cn'], match: /(^|\.)uc\.cn$/i, api: '分享页 / LinkSwift 公共 API' },
  { id: '123pan', name: '123 云盘', pageHosts: ['www.123pan.com', '123pan.com', '123pan.cn', '123684.com', '123865.com', '123952.com', '123912.com'], hosts: ['www.123pan.com', '123pan.com', '123pan.cn', '123684.com', '123865.com', '123952.com', '123912.com', 'login.123pan.com', 'cjjd19.com'], match: /(^|\.)((123pan\.(com|cn))|123(684|865|952|912)\.com|cjjd19\.com)$/i, api: '分享页 / LinkSwift 公共 API' },
];

export const NETDISK_PROVIDERS = Object.freeze(providerDefinitions.map((item) => Object.freeze({ ...item })));
const providerById = new Map(NETDISK_PROVIDERS.map((item) => [item.id, item]));
const providerHosts = new Set(NETDISK_PROVIDERS.flatMap((item) => item.hosts));

export function normalizeInput(value) {
  return String(value || '').trim().replace(/[\u0000-\u001f]/g, '');
}

export function parseUrl(value) {
  try {
    const candidate = normalizeInput(value);
    if (!candidate) return null;
    return new URL(/^[a-z][a-z\d+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }
}

export function getProvider(value) {
  const url = value instanceof URL ? value : parseUrl(value);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  return NETDISK_PROVIDERS.find((item) => item.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) || null;
}

export function isSharePage(value) {
  const url = value instanceof URL ? value : parseUrl(value);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return false;
  return NETDISK_PROVIDERS.some((item) => item.pageHosts.includes(url.hostname.toLowerCase()));
}

export function isProviderHost(value) {
  const host = String(value || '').toLowerCase().replace(/^www\./, 'www.');
  return NETDISK_PROVIDERS.some((item) => item.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)));
}

function decodeCandidate(value) {
  let result = String(value || '');
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(result);
      if (decoded === result) break;
      result = decoded;
    } catch { break; }
  }
  return result;
}

export function collectUrls(value) {
  const source = normalizeInput(value);
  const candidates = [source, decodeCandidate(source)];
  for (const match of source.matchAll(/https?:\/\/[^\s<>"'，。；]+/gi)) candidates.push(match[0]);
  const urls = [];
  for (const candidate of candidates) {
    const url = parseUrl(candidate.replace(/[),.;!?。，；）】]+$/g, ''));
    if (url && !urls.some((item) => item.toString() === url.toString())) urls.push(url);
  }
  return urls;
}

export function isLikelyDirectUrl(url) {
  if (!(url instanceof URL) || !['http:', 'https:'].includes(url.protocol) || !isProviderHost(url.hostname)) return false;
  const path = url.pathname.toLowerCase();
  const query = url.search.toLowerCase();
  const host = url.hostname.toLowerCase();
  if (['pan.baidu.com', 'yun.baidu.com'].includes(host) && /^\/rest\/2\.0\//.test(path)) return false;
  return /download|dlink|file|link|stream|clouddrive|openapi/.test(path) || /download|dlink|url=|link=|params=|sign=|token=|fid=|fileid=/.test(query);
}

export function extractDirectLinks(value) {
  const results = [];
  for (const url of collectUrls(value)) {
    if (!isLikelyDirectUrl(url)) continue;
    const href = url.toString();
    if (!results.some((item) => item.url === href)) results.push({ url: href, filename: decodeCandidate(url.searchParams.get('filename') || url.searchParams.get('name') || '') || '网盘文件' });
  }
  return results;
}

export function analyzeInput(value) {
  const raw = normalizeInput(value);
  const directLinks = extractDirectLinks(raw);
  const url = collectUrls(raw)[0] || null;
  const provider = getProvider(url);
  if (!provider && !directLinks.length) return { status: 'invalid', provider: null, directLinks: [], url: null, message: '请粘贴受支持的网盘分享页，或粘贴已经取得的下载地址。' };
  if (directLinks.length) return { status: 'ready', provider, directLinks, url: url?.toString() || directLinks[0].url, message: `已识别 ${directLinks.length} 个可复制的下载地址。` };
  if (!provider) return { status: 'invalid', provider: null, directLinks: [], url: url?.toString() || null, message: '这不是受支持的网盘地址。' };
  return { status: 'needs-page', provider, directLinks: [], url: url.toString(), message: `已识别为 ${provider.name}，请打开分享页并在隔离网页内使用 LinkSwift。` };
}

export function providerByIdentifier(id) {
  return providerById.get(id) || null;
}

