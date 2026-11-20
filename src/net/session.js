// 一条 WebSocket 会话：处理多 lane 帧、窗口背压与生命周期。

import { enc, frames, check } from '../util/frames.js';
import { nil, wake } from '../util/bytes.js';
import { STATS } from '../stats.js';
import { mkStream } from './stream.js';

const LANE_ITEMS = 16384;
const MAX_FRAME_MSG = 2 * 1024 * 1024;
const DOWN_CHUNK = 64 * 1024;

export function mkSession({ secret, sid, onClose, lease }) {
  let sock = null;
  let closed = false;
  let tx = Promise.resolve();
  let cur = null;

  const attach = (ws) => {
    if (sock || closed) throw Error();
    sock = ws;
    ws.accept({ allowHalfOpen: true });
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (e) => {
      if (closed) return;
      try {
        onData(e.data);
      } catch {
        close(1008);
      }
    });
    ws.addEventListener('close', () => close());
    ws.addEventListener('error', () => close());
  };

  const onData = (v) => {
    if (closed) return;
    if (lease?.deleted) return close(1000);
    if (typeof v === 'string') throw Error();

    const b = v instanceof Uint8Array ? v : new Uint8Array(v);
    if (!b.byteLength || b.byteLength > MAX_FRAME_MSG) throw Error();

    for (const frame of frames(b)) {
      if (closed) return;
      const delta = check(frame);
      if (frame.sid !== sid) throw Error();
      if (!cur && frame.type !== 1) throw Error();
      if (frame.type !== 1 && cur?.closed) continue;
      if (frame.type === 1) open();
      else if (frame.type === 2) write(frame.payload);
      else if (frame.type === 4) grant(delta);
      else if (frame.type === 3) end(false);
      else throw Error();
    }
  };

  const send = (type, data = nil) => {
    const out = enc(type, sid, data);
    const st = type === 2 || type === 4 ? cur : null;
    tx = tx.then(() => {
      if (closed) throw Error();
      if ((type === 2 || type === 4) && (!st || st.closed)) return;
      sock.send(out);
    });
    return tx;
  };

  const open = () => {
    if (closed) return;
    if (cur) throw Error();
    // in/out 是两侧可用的窗口额度，初始 4MB。
    const st = { in: 4 * 1024 * 1024, out: 4 * 1024 * 1024, wake: null, closed: false, proxy: null, pItems: 0 };
    st.proxy = mkStream({
      secret,
      emit: (b) => emitDn(st, b),
      onClose: () => {
        if (!closed && !st.closed) end(true);
      },
    });
    cur = st;
  };

  const write = (data) => {
    if (closed || cur?.closed) return;
    const st = cur;
    if (!st || st.closed) throw Error();

    const n = data.byteLength;
    if (n > st.in) throw Error();
    if (st.pItems >= LANE_ITEMS) throw Error();

    STATS.totalTrafficBytes += n; // 上行
    st.in -= n;
    st.pItems++;
    st.proxy.push(data).then(
      (accepted) => {
        freeUp(st);
        if (closed || st.closed || accepted === false) return;
        st.in += n;
        const delta = new Uint8Array(4);
        new DataView(delta.buffer).setUint32(0, n);
        send(4, delta).catch(() => close());
      },
      () => {
        freeUp(st);
        if (!closed && !st.closed) st.proxy.close();
      },
    ).catch(() => close());
  };

  const freeUp = (st) => {
    if (st.closed) return;
    st.pItems--;
  };

  const emitDn = async (st, b) => {
    for (let o = 0; o < b.byteLength; ) {
      while (!closed && !st.closed && st.out === 0) {
        await new Promise((ok) => {
          st.wake = ok;
        });
      }
      if (closed || st.closed) throw Error();

      const n = Math.min(DOWN_CHUNK, b.byteLength - o, st.out);
      st.out -= n;
      STATS.totalTrafficBytes += n; // 下行
      await send(2, b.subarray(o, o + n));
      o += n;
    }
  };

  const grant = (n) => {
    if (closed || cur?.closed) return;
    const st = cur;
    if (!st || st.closed) throw Error();
    st.out = Math.min(0xffffffff, st.out + n);
    wake(st);
  };

  const stop = (st) => {
    st.closed = true;
    st.pItems = 0;
    wake(st);
    st.proxy.close();
  };

  const end = (notify) => {
    if (closed || cur?.closed) return;
    const st = cur;
    if (!st) throw Error();
    stop(st);
    if (notify) send(3).then(() => close(), () => close());
    else close();
  };

  const close = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    if (cur) stop(cur);
    cur = null;
    try {
      sock?.close(code, reason);
    } catch {}
    onClose?.();
    onClose = null;
  };

  return { attach, close };
}
