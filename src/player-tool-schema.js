export const TOOL_LIMITS = Object.freeze({ html: 196608, backend: 98304, request: 327680, name: 60, description: 2000, links: 12 });
export const UNVERIFIED = '未经检验，请擦亮眼睛选择合适的那一个';
export function driveUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && /(^|\.)(pan\.quark\.cn|pan\.baidu\.com|yun\.baidu\.com|alipan\.com|aliyundrive\.com|lanzou[a-z]\.com|123pan\.com|123pan\.cn|123684\.com|123865\.com|cloud\.189\.cn|pan\.xunlei\.com|yun\.139\.com|drive\.uc\.cn|pan\.uc\.cn)$/i.test(u.hostname);
  } catch { return false; }
}
export function cleanTool(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具格式不正确。');
  for (const key of Object.keys(input)) if (!['name','description','html','backend','links','revision','id'].includes(key)) throw new Error('只接收工具页面、后端代码和网盘链接，不接收资源包。');
  const text = (key, max, required = true) => {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if ((required && !value) || new TextEncoder().encode(value).length > max || /\u0000/.test(value)) throw new Error(`${{ name:'工具名称',description:'工具介绍',html:'HTML 页面',backend:'后端代码' }[key]}为空或超过大小上限。`);
    return value;
  };
  const name = text('name', 240), description = text('description', 8000);
  if (name.length > 60 || description.length > 2000) throw new Error('名称最多 60 字，介绍最多 2000 字。');
  const html = text('html', TOOL_LIMITS.html), backend = text('backend', TOOL_LIMITS.backend, false);
  if (!/<[a-z][\s\S]*>/i.test(html) || !html.replace(/<!--[\s\S]*?-->/g, '').trim()) throw new Error('至少需要一个 HTML 页面，不能仅提交后端。');
  if (/data:application\/(?:zip|x-zip-compressed|octet-stream|x-7z-compressed|x-rar-compressed)[^\s"']*;base64|UEsDB[A-Za-z0-9+/]{40}/i.test(html + backend)) throw new Error('请用网盘链接提供资源包，不要把资源包编码嵌入代码。');
  const links = input.links ?? [];
  if (!Array.isArray(links) || links.length > TOOL_LIMITS.links || links.some(x => typeof x !== 'string' || x.length > 2048 || !driveUrl(x))) throw new Error('资源链接请填写 HTTPS 网盘分享地址，最多 12 条；没有资源可以留空。');
  return { name, description, html, backend, links: [...new Set(links)] };
}
