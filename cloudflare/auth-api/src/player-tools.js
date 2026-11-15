import { cleanTool, TOOL_LIMITS, UNVERIFIED } from '../../../src/player-tool-schema.js';
const columns = 'id, username AS owner, name, description, length(backend)>0 AS hasBackend, revision, created_at AS createdAt, updated_at AS updatedAt';
const present = row => ({ ...row, verified: false, notice: UNVERIFIED });
export async function playerTools(request, env, { authenticate, readJson, json, error, throttle }) {
  const url = new URL(request.url);
  const match = /^\/api\/tools(?:\/([1-9][0-9]*))?$/.exec(url.pathname);
  if (!match || (match[1] && !Number.isSafeInteger(Number(match[1])))) return error(400, '工具编号无效。');
  const id = match[1] ? Number(match[1]) : null;
  const session = await authenticate(env, request);
  const read = request.method === 'GET';
  if (!read && !session) return error(401, '请登录后再发布或修改工具。');
  let quotaKey = '';
  if (!read) {
    await env.DB.prepare('INSERT OR IGNORE INTO player_tool_publishers(username,quota_key) VALUES(?1,?2)').bind(session.username,crypto.randomUUID()).run();
    quotaKey = (await env.DB.prepare('SELECT quota_key FROM player_tool_publishers WHERE username=?1').bind(session.username).first()).quota_key;
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const gate = await throttle(env, `tools:${read?'read:'+ip:'write:'+quotaKey}`, read ? 120 : 10, read ? 60 : 3600);
  if (!gate.allowed) return error(429, read ? '浏览较频繁，请稍后再试。' : '每小时最多提交 10 次，请稍后再试。', { 'retry-after': String(gate.retryAfter) });
  if (read && !id) {
    const before = url.searchParams.get('before');
    if (before && (!/^[1-9][0-9]*$/.test(before) || !Number.isSafeInteger(Number(before)))) return error(400, '分页位置无效。');
    const mine = url.searchParams.get('mine') === '1';
    if (mine && !session) return error(401, '请先登录。');
    const rows = (await env.DB.prepare(`SELECT ${columns} FROM player_tools WHERE id < ?1 ${mine?'AND username = ?2 COLLATE NOCASE':''} ORDER BY id DESC LIMIT 21`).bind(...(mine ? [Number(before || Number.MAX_SAFE_INTEGER), session.username] : [Number(before || Number.MAX_SAFE_INTEGER)])).all()).results;
    return json({ tools: rows.slice(0,20).map(present), next: rows.length > 20 ? rows[19].id : null });
  }
  if (read && id) {
    const row = await env.DB.prepare(`SELECT ${columns}, html, backend, links_json FROM player_tools WHERE id=?1`).bind(id).first();
    if (!row) return error(404, '这封工具来信已不存在。');
    const { links_json, ...tool } = row;
    return json({ tool: present({ ...tool, links: JSON.parse(links_json) }) });
  }
  if (!((!id && request.method === 'POST') || (id && ['PUT','DELETE'].includes(request.method)))) return error(405, '不支持该操作。');
  const existing = id ? await env.DB.prepare('SELECT username, revision FROM player_tools WHERE id=?1').bind(id).first() : null;
  if (id && !existing) return error(404, '工具不存在。');
  if (existing && existing.username.toLowerCase() !== session.username.toLowerCase()) return error(403, '只能编辑自己的工具。');
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM player_tools WHERE id=?1 AND username=?2 COLLATE NOCASE').bind(id,session.username).run();
    return json({ deleted: true });
  }
  const daily = await throttle(env, `tools:daily:${quotaKey}`, 30, 86400);
  if (!daily.allowed) return error(429, '每天最多提交 30 次，请明天再来。', { 'retry-after': String(daily.retryAfter) });
  const input = await readJson(request, TOOL_LIMITS.request);
  let tool;
  try { tool = cleanTool(input); } catch(cause) { return error(400, cause.message); }
  const {name,description,html,backend,links} = tool;
  const now = Math.floor(Date.now()/1000);
  if (id) {
    if (!Number.isSafeInteger(input.revision) || input.revision !== existing.revision) return error(409, '工具已更新，请重新载入后编辑。');
    const result = await env.DB.prepare('UPDATE player_tools SET name=?1,description=?2,html=?3,backend=?4,links_json=?5,updated_at=?6,revision=revision+1 WHERE id=?7 AND revision=?8').bind(name,description,html,backend,JSON.stringify(links),now,id,input.revision).run();
    if (!result.meta.changes) return error(409, '工具已更新，请重新载入后编辑。');
    return json({ id, revision: input.revision+1 });
  }
  const result = await env.DB.prepare('INSERT INTO player_tools(username,name,description,html,backend,links_json,created_at,updated_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?7 WHERE (SELECT count(*) FROM player_tools WHERE username=?1 COLLATE NOCASE)<50').bind(session.username,name,description,html,backend,JSON.stringify(links),now).run();
  if (!result.meta.changes) return error(409, '每个账号最多保留 50 个工具，可编辑已有工具。');
  return json({ id: result.meta.last_row_id, revision: 1 },201);
}
