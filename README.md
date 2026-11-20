# edge-ws-relay

Cloudflare Workers 上的 WebSocket 中继。客户端在隔离页面里发起多条 WebSocket lane，Worker 按流复用、处理传输层封装后转发到上游 WSS 服务，并内置一个轻量的运行状态看板。

单文件旧版保留在 [`legacy/`](./legacy/telegram_webproxy.js) 仅作对照，部署请使用 `src/`。

> **部署提示**：Cloudflare 服务条款对中继类用途有明确限制。本项目不改变流量特征，是否部署、部署在哪个账号下，请自行评估风险。

## 目录结构

```text
src/
├── index.js              入口：路由分发
├── config.js             运行参数与配额
├── stats.js              实例内存指标
├── crypto/
│   ├── aes.js            AES-CTR 流式加解密
│   ├── obfuscation.js    传输层头解析与重签
│   └── token.js          HMAC 令牌、密钥派生、租约
├── http/
│   └── bridge.js         ?bridge= 能力签名
├── net/
│   ├── wire.js           上游 WebSocket 与合包读取
│   ├── packet.js         MTProto 传输包切分
│   ├── stream.js         单 lane 的加解密与转发
│   └── session.js        会话、多 lane、窗口背压
├── pages/
│   ├── dashboard.js      落地看板
│   └── tunnel.js         客户端隧道页
└── util/
    ├── bytes.js          字节与 base64url
    ├── frames.js         lane 帧编解码
    └── http.js           请求头与主机名校验
test/core.test.js         纯函数单元测试
```

## 快速开始

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 SECRET / BOOT
npm run dev                      # 默认 http://127.0.0.1:8787
npm test                         # 11 项单元测试
```

生成密钥：

```bash
openssl rand -hex 16    # SECRET（32 位 hex）
openssl rand -hex 24    # BOOT
```

## 部署

```bash
npx wrangler login
npx wrangler secret put SECRET
npx wrangler secret put BOOT
# 可选：保护看板
npx wrangler secret put ADMIN
npm run deploy
```

部署后先验证 `https://<worker>.workers.dev/health` 返回 `{"ok":true}`。若返回 500，通常是 `SECRET` 格式不合法或变量缺失。

## 环境变量

| 绑定 | 必需 | 说明 |
| --- | --- | --- |
| `SECRET` | 是 | 访问密钥。32 位 hex，或 `dd`/`ee`/`ef` + 32 位 hex（34 位） |
| `BOOT` | 是 | 令牌签名种子，任意非空随机串，建议 ≥16 字符 |
| `ADMIN` | 否 | 设置后，看板与 `/api/stats` 必须带 `?admin=<值>`，否则 404 |

## 路由

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/` | GET/HEAD | 带合法 `?bridge=` 签名 → 隧道页；否则 → 看板（受 `ADMIN` 保护） |
| `/api/stats` | GET | 实例指标 JSON（受 `ADMIN` 保护） |
| `/health` | GET | 健康检查 |
| `/api/v1/session` | POST | 建立会话，返回 session token |
| `/api/v1/session` | DELETE | 注销会话 |
| `/api/v1/ws` | GET | lane WebSocket（子协议 `relay-lane-v1.<token>.<sid>`） |

## 安全模型

- `SECRET` 就是使用权：拿到它即可生成合法 `?bridge=` 签名并使用中继。默认看板会明文展示它。
- 生产环境建议设置 `ADMIN`：看板和 `/api/stats` 会被 404 拦住，只有带 `?admin=` 的请求可见。`?bridge=` 和 lane 不受影响，客户端仍能正常连接。
- Worker 只处理传输层封装（64 字节头重签）。内层载荷由客户端端到端加密，Worker 不接触、也不做该层加解密。
- `/api/stats` 是**单 isolate 内存值**，不是全局聚合，仅用于观察趋势。

## 说明

- `compatibility_date` 设为 `2026-11-20`，如需更早的运行时可自行下调。
- 开源协议：[GPL-3.0](./LICENSE)
