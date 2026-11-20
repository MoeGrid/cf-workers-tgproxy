// Worker 入口：路由分发。
//
// 根路径有三种语义：
//   1. 带 ?bridge=<签名>      -> 客户端隧道页（必须公开，客户端不会带 secret）
//   2. 普通浏览器 + 未带合法 ?secret= -> 404
//   3. 普通浏览器 + 合法 ?secret=     -> 落地看板
//
// /health、/api/v1/session、/api/v1/ws 走各自的令牌校验，不受 ?secret= 影响。

import { LIMITS } from './config.js';
import { enc } from './util/frames.js';
import { bearer, binary, hello, protos, reply } from './util/http.js';
import { authBoot, leases, mkBoot, mkCfg, mkLease, mkSess, verify } from './crypto/token.js';
import { bridge } from './http/bridge.js';
import { STATS, snapshot } from './stats.js';
import { mkSession } from './net/session.js';
import { mkDashboard } from './pages/dashboard.js';
import { mkPage } from './pages/tunnel.js';

const KNOWN_PATHS = ['/', '/health', '/api/v1/session', '/api/v1/ws'];

/** 常量时间比较访问密钥。看板与 /api/stats 共用 SECRET。 */
function keyAllowed(url, secret) {
  const given = url.searchParams.get('secret') || '';
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  fetch: (req, env) => route(req, env),
};

async function route(req, env) {
  const url = new URL(req.url);
  const { pathname: path, origin } = url;
  const { method, headers } = req;

  let cfg;
  try {
    cfg = mkCfg(env);
  } catch {
    return KNOWN_PATHS.includes(path) ? reply(null, 500) : reply();
  }

  // 1. 运行指标
  if (path === '/api/stats' && method === 'GET') {
    if (!keyAllowed(url, cfg.secret)) return reply();
    return new Response(JSON.stringify(snapshot()), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  }

  // 2. 根路径：隧道页 / 看板
  if (path === '/' && (method === 'GET' || method === 'HEAD')) {
    let host = null;
    if (method === 'GET') {
      try {
        host = await bridge(url, cfg.secret);
      } catch {}
    }

    if (host) {
      const boot = await mkBoot(cfg.boot);
      const page = mkPage(host, boot);
      return new Response(page.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': page.csp,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (method === 'HEAD') return new Response(null, { status: 200 });
    if (!keyAllowed(url, cfg.secret)) return reply();

    const html = mkDashboard({ host: url.hostname, secret: cfg.secret });
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // 3. 健康检查
  if (path === '/health') return json({ ok: true });

  // 4. 会话建立 / 注销
  if (path === '/api/v1/session') {
    const auth = bearer(headers.get('Authorization'));

    if (method === 'DELETE') {
      if (!auth || !(await verify(auth, cfg.boot, 'session'))) return reply();
      let lease = leases.get(auth);
      if (!lease) leases.set(auth, (lease = mkLease(auth)));
      lease.deleted = true;
      return reply(null, 204);
    }

    if (method !== 'POST' || !auth || !binary(req)) return reply();
    if (!(await authBoot(auth, cfg.boot))) return reply();

    try {
      const body = new Uint8Array(await req.arrayBuffer());
      hello(body);
      const token = await mkSess(cfg.boot);
      STATS.totalSessions++;
      return new Response(enc(0x11, 0), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          'X-Session-Token': token,
          'X-Carrier-Mode': 'websocket-lanes',
        },
      });
    } catch {
      return reply();
    }
  }

  // 5. lane WebSocket
  if (
    path !== '/api/v1/ws' ||
    method !== 'GET' ||
    headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
    (headers.has('Origin') && headers.get('Origin') !== origin)
  ) {
    return reply();
  }

  const offers = protos(req);
  const proto = offers.length === 1 ? offers[0] : null;
  const parts = proto?.split('.') ?? [];
  const [kind, token = '', id] = parts;
  const sid = Number(id);

  if (
    parts.length !== 3 ||
    kind !== 'relay-lane-v1' ||
    !/^[1-9][0-9]{0,7}$/.test(id) ||
    sid > 0xffffff ||
    !(await verify(token, cfg.boot, 'session'))
  ) {
    return reply();
  }

  const now = Date.now();
  for (const [key, v] of leases) if (v.expires <= now && !v.active.size) leases.delete(key);

  let lease = leases.get(token);
  if (!lease) {
    if (leases.size >= LIMITS.leases) return reply(null, 503);
    leases.set(token, (lease = mkLease(token)));
  }

  if (
    lease.deleted ||
    lease.used.has(sid) ||
    lease.active.size >= LIMITS.lanesPerSession ||
    lease.used.size >= LIMITS.usedSidsPerSession
  ) {
    return reply(null, 409);
  }

  lease.used.add(sid);
  lease.active.add(sid);
  STATS.activeConnections++;

  const sess = mkSession({
    secret: cfg.key,
    sid,
    lease,
    onClose: () => {
      STATS.activeConnections = Math.max(0, STATS.activeConnections - 1);
      lease.active.delete(sid);
    },
  });

  const { 0: client, 1: server } = new WebSocketPair();
  try {
    sess.attach(server);
  } catch {
    sess.close();
    return reply(null, 409);
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: {
      'Sec-WebSocket-Protocol': proto,
      'Sec-WebSocket-Extensions': '',
    },
  });
}
