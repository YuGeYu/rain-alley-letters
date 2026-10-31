# 雨巷来信账号与评论 Worker

Cloudflare Worker `rain-alley-auth` 通过 D1 数据库 `rain-alley-accounts` 提供账号注册/登录、会话验证、注销和功能评论。桌面端主进程通过 HTTPS 调用 Worker，令牌不暴露给网页渲染层。

桌面端固定使用 `https://auth.600318.xyz`。`cloudflare.config.ts` 中声明了 Worker 自定义域名，由部署流程自动绑定域名并配置 HTTPS；同时保留 workers.dev 与 Preview 地址用于诊断。不要把 `workers.dev` 地址重新写回桌面端配置：某些网络会把该域名解析到错误地址，导致 HTTPS 连接超时。

## 接口

- `GET /health`
- `POST /api/register`：`{ "username": "...", "password": "..." }`
- `POST /api/login`：同上
- `GET /api/session`：`Authorization: Bearer <opaque token>`
- `POST /api/logout`：同上
- `GET /api/modules/:featureId/comments`
- `POST /api/modules/:featureId/comments`：`{ "body": "..." }`，需登录

密码使用 PBKDF2-HMAC-SHA-256、每用户随机 salt 与 100,000 次迭代；该值符合 Cloudflare Workers Web Crypto 的上限，服务端只存储摘要。会话是 32 字节随机不透明令牌，D1 中只保存 SHA-256 摘要，默认有效期 30 天。账号、登录、评论和请求字段有长度校验及频率限制。评论以纯文本保存。

账号恢复方式：一键注册时桌面端把用户可见的账号和明文密码写入一张本机 PNG；云端不保存明文密码。忘记图片时目前没有邮箱找回流程。

## 本地验证与部署

```powershell
npm install
node --test src/security.test.mjs
cf d1 migrations list rain-alley-accounts
cf d1 migrations apply rain-alley-accounts
cf deploy --dry-run
cf deploy
```

CLI 通过 `cf` 登录，项目不使用 Wrangler。不要把 API token、生成账号、用户密码或 Worker 会话令牌写进仓库或日志。
