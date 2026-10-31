// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
const PASSWORD_ITERATIONS = 100_000;
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const USERNAME_RE = /^[A-Za-z0-9_-]{4,24}$/;
const FEATURE_RE = /^[a-z0-9-]{2,40}$/;
const PROFILE_STYLE_PROPERTIES = new Set(["color", "background-color", "border-color", "border-radius", "border-width", "border-style", "padding", "margin", "font-size", "font-weight", "text-align", "line-height", "max-width", "width", "height", "min-height", "letter-spacing", "display", "flex", "flex-direction", "flex-wrap", "align-items", "justify-content", "gap", "grid-template-columns", "grid-column", "box-shadow", "text-decoration", "overflow-wrap"]);
const PROFILE_TAGS = new Set(["p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "strong", "b", "em", "i", "small", "br", "hr", "span", "div", "section", "article", "header", "footer"]);
const encoder = new TextEncoder();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      ...extraHeaders,
    },
  });
}

const error = (status, message, headers) => json({ error: message }, status, headers);
const asHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (value) => Uint8Array.from(value.match(/.{2}/g) || [], (part) => Number.parseInt(part, 16));
const randomHex = (length = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return asHex(bytes);
};

async function digest(value) {
  return asHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hashPassword(password, salt = randomHex(16), iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations },
    material,
    256,
  );
  return { salt, iterations, hash: asHex(bits) };
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifyPassword(password, account) {
  const result = await hashPassword(password, account.password_salt, account.password_iterations);
  return equalBytes(fromHex(result.hash), fromHex(account.password_hash));
}

async function readJson(request, maximum = 16_384) {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null && (!/^\d+$/.test(rawLength) || Number(rawLength) > maximum)) return null;
  if (!request.body) return null;
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseBearer(request) {
  const value = request.headers.get("authorization") || "";
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(value);
  return match?.[1] || null;
}

async function createSession(env, username) {
  const token = randomHex(32);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  const tokenHash = await digest(token);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now).run();
  await env.DB.prepare("INSERT INTO sessions (token_hash, username, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(tokenHash, username, expiresAt, now)
    .run();
  return { token, expiresAt, username };
}

async function authenticate(env, request) {
  const token = parseBearer(request);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(
    "SELECT accounts.username, accounts.role, sessions.token_hash, sessions.expires_at AS expiresAt FROM sessions JOIN accounts ON accounts.username = sessions.username WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2",
  ).bind(tokenHash, now).first();
  if (!row) return null;
  if (!equalBytes(fromHex(row.token_hash), fromHex(tokenHash))) return null;
  return { username: row.username, role: row.role || 'player', tokenHash, expiresAt: Number(row.expiresAt) };
}

async function throttle(env, scope, limit, periodSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const bucketHash = await digest(scope);
  const row = await env.DB.prepare(
    `INSERT INTO auth_throttle (bucket_hash, attempts, window_ends) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket_hash) DO UPDATE SET
       attempts = CASE WHEN window_ends <= ?3 THEN 1 ELSE attempts + 1 END,
       window_ends = CASE WHEN window_ends <= ?3 THEN ?2 ELSE window_ends END
     RETURNING attempts, window_ends`,
  ).bind(bucketHash, now + periodSeconds, now).first();
  return { allowed: Number(row?.attempts || 0) <= limit, retryAfter: Math.max(1, Number(row?.window_ends || now + periodSeconds) - now), bucketHash };
}

async function createAccount(env, username, password) {
  const passwordData = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    "INSERT INTO accounts (username, password_salt, password_hash, password_iterations, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).bind(username, passwordData.salt, passwordData.hash, passwordData.iterations, now).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function register(env, request) {
  const input = await readJson(request);
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!USERNAME_RE.test(username)) return error(400, "账号需为 4–24 位字母、数字、下划线或短横线。");
  if (password.length < 12 || password.length > 128) return error(400, "密码长度需为 12–128 位。");

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const gate = await throttle(env, `signup:${ip}`, 8, 600);
  if (!gate.allowed) return error(429, "注册请求较多，请稍后再试。", { "retry-after": String(gate.retryAfter) });

  try {
    if (!(await createAccount(env, username, password))) return error(409, "这个账号已被使用，请换一个账号名。");
  } catch (cause) {
    if (String(cause?.message || "").toLowerCase().includes("unique")) return error(409, "这个账号已被使用，请换一个账号名。");
    throw cause;
  }
  const session = await createSession(env, username);
  return json({ account: { username, createdAt: Math.floor(Date.now() / 1000) }, session }, 201);
}

async function login(env, request) {
  const input = await readJson(request);
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!USERNAME_RE.test(username) || password.length < 1 || password.length > 128) return error(400, "请输入有效账号和密码。");

  const gate = await throttle(env, `login:${username.toLowerCase()}`, 10, 600);
  const account = await env.DB.prepare(
    "SELECT username, role, password_salt, password_hash, password_iterations FROM accounts WHERE username = ?1 COLLATE NOCASE",
  ).bind(username).first();
  if (!gate.allowed && account?.role !== 'root') return error(429, '登录尝试过多，请稍后再试。', { 'retry-after': String(gate.retryAfter) });
  const valid = account ? await verifyPassword(password, account) : false;
  if (!valid) return error(401, "账号或密码不正确，请检查后重试。");

  await env.DB.prepare("DELETE FROM auth_throttle WHERE bucket_hash = ?1").bind(gate.bucketHash).run();
  const session = await createSession(env, account.username);
  return json({ account: { username: account.username, role: account.role }, session });
}

async function updateAccount(env, request) {
  const session = await authenticate(env, request);
  if (!session) return error(401, "登录已失效，请重新登录。");
  const input = await readJson(request, 16_384);
  const currentPassword = typeof input?.currentPassword === "string" ? input.currentPassword : "";
  const requestedUsername = input?.newUsername === undefined ? session.username : (typeof input.newUsername === "string" ? input.newUsername.trim() : "");
  const newPassword = input?.newPassword === undefined ? "" : (typeof input.newPassword === "string" ? input.newPassword : "");
  if (!currentPassword || !USERNAME_RE.test(requestedUsername)) return error(400, "请输入有效的当前密码和账号名称。");
  if (newPassword && (newPassword.length < 12 || newPassword.length > 128)) return error(400, "新密码长度需为 12–128 位。");
  const usernameUnchanged = requestedUsername.toLowerCase() === session.username.toLowerCase();
  if (usernameUnchanged && !newPassword) return error(400, "没有需要保存的账号变更。");
  const gate = session.role === 'root' ? { allowed: true } : await throttle(env, `account-update:${session.username}`, 8, 600);
  if (!gate.allowed) return error(429, "账号修改请求较多，请稍后再试。", { "retry-after": String(gate.retryAfter) });
  const account = await env.DB.prepare("SELECT username, role, password_salt, password_hash, password_iterations, created_at FROM accounts WHERE username = ?1").bind(session.username).first();
  if (!account || !(await verifyPassword(currentPassword, account))) return error(401, "当前密码不正确，请检查后重试。");
  const canonicalUsername = usernameUnchanged ? session.username : requestedUsername;
  const passwordData = newPassword ? await hashPassword(newPassword) : { salt: account.password_salt, hash: account.password_hash, iterations: account.password_iterations };
  const renamed = canonicalUsername !== session.username;
  try {
    if (renamed) {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE accounts SET role = 'player' WHERE username = ?1").bind(session.username),
        env.DB.prepare("INSERT INTO accounts (username, password_salt, password_hash, password_iterations, created_at, role) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
          .bind(canonicalUsername, passwordData.salt, passwordData.hash, passwordData.iterations, account.created_at, account.role),
        env.DB.prepare("UPDATE sessions SET username = ?1 WHERE username = ?2").bind(canonicalUsername, session.username),
        env.DB.prepare("UPDATE comments SET username = ?1 WHERE username = ?2").bind(canonicalUsername, session.username),
        env.DB.prepare("UPDATE profiles SET username = ?1 WHERE username = ?2").bind(canonicalUsername, session.username),
        env.DB.prepare("DELETE FROM accounts WHERE username = ?1").bind(session.username),
        env.DB.prepare("DELETE FROM sessions WHERE username = ?1 AND token_hash != ?2").bind(canonicalUsername, session.tokenHash),
      ]);
      if (Number(results?.[1]?.meta?.changes || 0) !== 1) return error(409, "这个账号名称已被使用，请换一个名称。");
    } else {
      await env.DB.prepare("UPDATE accounts SET password_salt = ?1, password_hash = ?2, password_iterations = ?3 WHERE username = ?4")
        .bind(passwordData.salt, passwordData.hash, passwordData.iterations, session.username).run();
      await env.DB.prepare("DELETE FROM sessions WHERE username = ?1 AND token_hash != ?2").bind(canonicalUsername, session.tokenHash).run();
    }
  } catch (cause) {
    if (String(cause?.message || "").toLowerCase().includes("unique")) return error(409, "这个账号名称已被使用，请换一个名称。");
    throw cause;
  }
  return json({ account: { username: canonicalUsername, role: session.role, createdAt: account.created_at }, session: { expiresAt: session.expiresAt } });
}

async function getSession(env, request) {
  const session = await authenticate(env, request);
  if (!session) return error(401, "登录已失效，请重新登录。");
  return json({ account: { username: session.username, role: session.role }, community: await communityStatus(env, session) });
}

async function logout(env, request) {
  const session = await authenticate(env, request);
  if (session) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(session.tokenHash).run();
  return json({ ok: true });
}

function validFeatureId(value) {
  return FEATURE_RE.test(value);
}

// The INSERT trigger serializes concurrent writers. Failed inserts consume no lock.
async function communityStatus(env, session) {
  if (!session) return null;
  const unlimited = session.role === 'root';
  const row = unlimited ? null : await env.DB.prepare("SELECT MAX(created_at) AS lastAt FROM comments WHERE username = ?1").bind(session.username).first();
  return { unlimited, nextAllowedAt: row?.lastAt == null ? 0 : Number(row.lastAt) + 3600, serverNow: Math.floor(Date.now() / 1000) };
}
async function listComments(env, request, featureId) {
  const session = await authenticate(env, request);
  const rows = await env.DB.prepare("SELECT id, username, body, created_at AS createdAt FROM comments WHERE feature_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 40").bind(featureId).all();
  return json({ comments: rows.results || [], community: await communityStatus(env, session) });
}
async function addComment(env, request, featureId) {
  const session = await authenticate(env, request);
  if (!session) return error(401, "登录已失效，请重新登录。");
  const input = await readJson(request);
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (!body || [...body].length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) return error(400, "评论需为 1–500 个字符。");
  let result;
  try {
    result = await env.DB.prepare("INSERT INTO comments (feature_id, username, body, created_at) VALUES (?1, ?2, ?3, ?4)").bind(featureId, session.username, body, Math.floor(Date.now() / 1000)).run();
  } catch (cause) {
    if (!String(cause?.message).includes('COMMUNITY_HOUR_LOCK')) throw cause;
    const community = await communityStatus(env, session);
    const retryAfter = Math.max(1, community.nextAllowedAt - community.serverNow);
    return json({ error: '留言与评论共用一小时等待时间，还需等待 ' + Math.ceil(retryAfter / 60) + ' 分钟。', community }, 429, { 'retry-after': String(retryAfter) });
  }
  const comment = await env.DB.prepare("SELECT id, username, body, created_at AS createdAt FROM comments WHERE id = ?1").bind(result.meta?.last_row_id).first();
  return json({ comment, community: await communityStatus(env, session) }, 201);
}

function sanitizeProfileHtml(value) {
  if (typeof value !== "string" || value.length > 12_000) return "";
  // This is a deliberately small markup language, not executable HTML. Remove
  // executable/embed/form elements and their contents before accepting the text.
  return value
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template|video|audio|button|input|textarea|select|link|meta)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template|video|audio|button|input|textarea|select|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src|srcdoc|action|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi, (whole, rawName, rawAttrs) => {
      const name = rawName.toLowerCase();
      if (!PROFILE_TAGS.has(name)) return "";
      const attrs = [...rawAttrs.matchAll(/(?:^|\s)(class|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
        .map((match) => {
          const key = match[1].toLowerCase();
          const value = (match[2] ?? match[3] ?? "").slice(0, 120).replace(/[&<>"']/g, "");
          if (key === "class" && !/^profile-[a-z0-9 _-]{0,60}$/i.test(value)) return "";
          return ` ${key}="${value}"`;
        }).join("");
      return whole.startsWith("</") ? `</${name}>` : `<${name}${attrs}${/\/>$/.test(whole) ? "/>" : ">"}`;
    });
}

function sanitizeProfileCss(value) {
  if (typeof value !== "string" || value.length > 12_000 || /[\\@]/.test(value)) return "";
  const blocks = [];
  for (const match of value.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!/^\.profile-page(?:\s+(?:h2|h3|h4|p|ul|ol|li|blockquote|strong|b|em|i|small|span|div|section|article|header|footer|hr|br|\.profile-[a-z0-9_-]+))*$/i.test(selector)) continue;
    const declarations = [];
    for (const declaration of match[2].split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 1) continue;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const setting = declaration.slice(separator + 1).trim();
      if (PROFILE_STYLE_PROPERTIES.has(property) && setting.length <= 80 && /^[#a-z0-9.,%()\s_-]+$/i.test(setting) && !/url|expression|javascript/i.test(setting)) declarations.push(`${property}:${setting}`);
    }
    if (declarations.length) blocks.push(`${selector}{${declarations.join(";")}}`);
  }
  return blocks.join("");
}

function cleanProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const displayName = typeof input.displayName === "string" ? input.displayName.trim().slice(0, 60) : "";
  const bio = typeof input.bio === "string" ? input.bio.trim().slice(0, 500) : "";
  if ([displayName, bio].some((value) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))) return null;
  const profile = { displayName, bio, html: sanitizeProfileHtml(input.html), css: sanitizeProfileCss(input.css) };
  return JSON.stringify(profile).length <= 25_000 ? profile : null;
}

async function getProfile(env, username, request) {
  const ip = env?.requestIp || "unknown";
  const session = await authenticate(env, request);
  const gate = session?.role === 'root' ? { allowed: true } : await throttle(env, `public-profile:${ip}`, 120, 600);
  if (!gate.allowed) return error(429, "个人页面访问较频繁，请稍后再试。", { "retry-after": String(gate.retryAfter) });
  const account = await env.DB.prepare("SELECT username, created_at AS createdAt FROM accounts WHERE username = ?1 COLLATE NOCASE").bind(username).first();
  if (!account) return error(404, "没有找到这位雨巷来客。");
  const row = await env.DB.prepare("SELECT profile_json AS profileJson FROM profiles WHERE username = ?1").bind(account.username).first();
  let profile = { displayName: "", bio: "", html: "", css: "" };
  if (row?.profileJson) {
    try { profile = cleanProfile(JSON.parse(row.profileJson)) || profile; } catch { /* damaged public data falls back to an empty profile */ }
  }
  return json({ account, profile });
}

async function saveProfile(env, request, username) {
  const session = await authenticate(env, request);
  if (!session) return error(401, "登录已失效，请重新登录。");
  if (session.username.toLowerCase() !== username.toLowerCase()) return error(403, "只能编辑自己的个人页面。");
  const gate = session.role === 'root' ? { allowed: true } : await throttle(env, `profile-edit:${session.username}`, 30, 600);
  if (!gate.allowed) return error(429, "个人页面保存较频繁，请稍后再试。", { "retry-after": String(gate.retryAfter) });
  const input = await readJson(request, 120_000);
  if (!input || !cleanProfile(input)) return error(400, "个人页面格式不正确或包含不支持的内容。");
  const profile = cleanProfile(input);
  const encoded = JSON.stringify(profile);
  await env.DB.prepare("INSERT INTO profiles (username, profile_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(username) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at")
    .bind(session.username, encoded, Math.floor(Date.now() / 1000)).run();
  return json({ profile });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === "/health" && request.method === "GET") return json({ ok: true, service: "rain-alley-auth" });
  if (pathname === "/api/register" && request.method === "POST") return register(env, request);
  if (pathname === "/api/login" && request.method === "POST") return login(env, request);
  if (pathname === "/api/session" && request.method === "GET") return getSession(env, request);
  if (pathname === "/api/logout" && request.method === "POST") return logout(env, request);
  if (pathname === "/api/account" && request.method === "PUT") return updateAccount(env, request);

  const profileRoute = /^\/api\/profiles\/([^/]+)$/.exec(pathname);
  if (profileRoute) {
    let username;
    try { username = decodeURIComponent(profileRoute[1]); } catch { return error(400, "账号格式不正确。"); }
    if (!USERNAME_RE.test(username)) return error(400, "账号格式不正确。");
    if (request.method === "GET") return getProfile({ ...env, requestIp: request.headers.get("cf-connecting-ip") || "unknown" }, username, request);
    if (request.method === "PUT") return saveProfile(env, request, username);
  }

  const commentRoute = /^\/api\/modules\/([^/]+)\/comments$/.exec(pathname);
  if (commentRoute) {
    let featureId;
    try { featureId = decodeURIComponent(commentRoute[1]); } catch { return error(400, "功能编号无效。"); }
    if (!validFeatureId(featureId)) return error(400, "功能编号无效。");
    if (request.method === "GET") return listComments(env, request, featureId);
    if (request.method === "POST") return addComment(env, request, featureId);
  }
  return error(404, "没有找到该接口。");
}

export { hashPassword, verifyPassword, validFeatureId, USERNAME_RE, cleanProfile, sanitizeProfileCss, sanitizeProfileHtml };

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (cause) {
      console.error(JSON.stringify({ event: "request_failed", path: new URL(request.url).pathname, error: String(cause?.message || "unknown").slice(0, 180) }));
      return error(500, "服务暂时不可用，请稍后再试。");
    }
  },
};
