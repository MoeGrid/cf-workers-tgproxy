// 出站 WebSocket：连接上游、做有界排队与合包读取。
//
// 上游域名由 DC 序号决定，media 决定是否走 -1 通道；主域名失败会自动重试另一个。

import { CFG } from '../config.js';
import { u8 } from '../util/bytes.js';

const hosts = (dc, media) => [
  `kws${dc}${media ? '-1' : ''}.web.telegram.org`,
  `kws${dc}${media ? '' : '-1'}.web.telegram.org`,
];

/**
 * 包装一条上游 WebSocket。
 * - write(): 直接发送，背压由调用方控制
 * - readPack(): 按 dnPack / dnMs 把连续小消息合成一个包
 */
export function mkWire(ws, ms, signal) {
  const q = [];
  const wait = [];
  let h = 0;
  let qBytes = 0;
  let closed = false;
  let dead = false;
  let up = false;
  let fault = null;
  let pWake = null;
  let pNeed;
  let openTimer;
  let readyOk;
  let readyBad;

  const ready = new Promise((ok, bad) => {
    readyOk = ok;
    readyBad = bad;
  });

  const end = (err = null) => {
    if (closed) return;
    closed = true;
    fault = err;
    clearTimeout(openTimer);
    signal?.removeEventListener('abort', onAbort);
    if (!up) readyBad(err || Error());
    pWake?.();
    for (const waiter of wait.splice(0)) err ? waiter.reject(err) : waiter.resolve(null);
  };

  const close = () => {
    if (dead) return;
    dead = true;
    if (!closed) end();
    q.length = h = qBytes = 0;
    try {
      ws.close(1000);
    } catch {}
  };

  const onAbort = () => {
    end(Error());
    close();
  };

  const onOpen = () => {
    if (closed) return;
    if (ws.protocol !== 'binary') {
      end(Error());
      close();
      return;
    }
    up = true;
    clearTimeout(openTimer);
    readyOk(api);
  };

  const onData = (v) => {
    if (closed) return;
    const b = v instanceof Uint8Array ? v : new Uint8Array(v);
    if (!b.byteLength) return;
    const waiter = wait.shift();
    if (waiter) waiter.resolve(b);
    else {
      q.push(b);
      qBytes += b.byteLength;
      if (pWake && (qBytes >= pNeed || b.byteLength >= CFG.dnPack)) pWake();
    }
  };

  const write = async (v) => {
    await ready;
    if (closed) throw fault || Error();
    ws.send(u8(v));
  };

  const trim = () => {
    if (h === q.length) {
      q.length = 0;
      h = 0;
    } else if (h >= 256 && h * 2 >= q.length) {
      q.splice(0, h);
      h = 0;
    }
  };

  const take = async () => {
    await ready;
    if (h < q.length) {
      const msg = q[h];
      q[h++] = null;
      qBytes -= msg.byteLength;
      trim();
      return msg;
    }
    if (fault) throw fault;
    if (closed) return null;
    return new Promise((ok, bad) => wait.push({ resolve: ok, reject: bad }));
  };

  const pack = async () => {
    const first = await take();
    if (dead) return null;
    if (!first || first.byteLength >= CFG.dnPack) return first;

    // 不足一个包时，开一个 1ms 的静默窗口等后续小包。
    if (!closed && qBytes < CFG.dnPack - first.byteLength) {
      await new Promise((ok) => {
        pNeed = CFG.dnPack - first.byteLength;
        const timer = setTimeout(() => pWake?.(), CFG.dnMs);
        pWake = () => {
          clearTimeout(timer);
          pWake = null;
          ok();
        };
      });
    }
    if (dead) return null;

    let n = first.byteLength;
    let stop = h;
    while (stop < q.length && n + q[stop].byteLength <= CFG.dnPack) n += q[stop++].byteLength;
    if (stop === h) return first;

    const b = new Uint8Array(n);
    b.set(first);
    let o = first.byteLength;
    while (h < stop) {
      const part = q[h];
      q[h++] = null;
      b.set(part, o);
      o += part.byteLength;
      qBytes -= part.byteLength;
    }
    trim();
    return b;
  };

  const api = { ready, write, readPack: pack, close, get closed() { return closed; } };

  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', (e) => onData(e.data));
  ws.addEventListener('error', () => end(Error()));
  ws.addEventListener('close', (e) => end(e?.code && e.code !== 1000 ? Error() : null));
  openTimer = setTimeout(() => {
    end(Error());
    close();
  }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return api;
}

/** 依次尝试主/备上游，返回第一个握手成功的连接。 */
export async function dial({ target, media, signal }) {
  for (const host of hosts(target + 1, media)) {
    if (signal?.aborted) throw Error();
    const url = `wss://${host}/apiws`;
    let kws;
    try {
      kws = mkWire(new WebSocket(url, 'binary'), 7500, signal);
      await kws.ready;
      if (signal?.aborted) throw Error();
      return kws;
    } catch (err) {
      kws?.close();
      if (signal?.aborted) throw err;
    }
  }
  throw Error();
}
