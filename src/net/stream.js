// 单条 lane 的传输流：客户端 obfuscation 头 -> 重签 -> 上游 KWS。
//
// 上行：解密客户端密文 -> 切 MTProto 包 -> 合包 -> 重新加密 -> 写上游
// 下行：读上游合包 -> 解密 -> 重新加密 -> emit 回客户端

import { CFG } from '../config.js';
import { cat, nil, u8 } from '../util/bytes.js';
import { cipher, headOf, mkHead, wireHead } from '../crypto/obfuscation.js';
import { dial } from './wire.js';
import { mkPkt } from './packet.js';

export function mkStream({ secret, emit, onClose }) {
  let hdr = nil;
  let cIn = null;
  let cOut = null;
  let kIn = null;
  let kOut = null;
  let peer = null;
  let pkt = null;
  let init = false;
  let closed = false;
  let chain = Promise.resolve();
  const ac = new AbortController();
  const uq = new Set();

  /** 上行并入同一条 promise 链，天然串行；顺带把相邻小包合并到 upPack。 */
  const push = (v) => {
    if (closed) return Promise.reject(Error());
    const job = { bytes: u8(v) };
    uq.add(job);
    chain = chain.then(async () => {
      if (closed) throw Error();
      if (!job.bytes) return job.result;

      const jobs = [job];
      let n = job.bytes.byteLength;
      for (const next of uq) {
        if (next === job) continue;
        if (n >= CFG.upPack || n + next.bytes.byteLength > CFG.upPack) break;
        n += next.bytes.byteLength;
        jobs.push(next);
      }
      const b = jobs.length === 1 ? job.bytes : cat(...jobs.map((x) => x.bytes));
      for (const item of jobs) {
        uq.delete(item);
        item.bytes = null;
      }
      const out = await feed(b);
      for (const item of jobs) item.result = out;
      return out;
    });
    return chain;
  };

  const feed = async (b) => {
    if (closed) throw Error();
    if (init && peer.closed) return false;
    if (!b.byteLength) return;

    if (!init) {
      const need = 64 - hdr.byteLength;
      if (b.byteLength < need) {
        hdr = cat(hdr, b);
        return;
      }
      hdr = cat(hdr, b.subarray(0, need));
      await start();
      const rest = b.subarray(need);
      if (rest.byteLength) return write(rest);
      return;
    }
    return write(b);
  };

  const start = async () => {
    const raw = hdr;
    const cr = await cipher(raw, secret, false);
    const plain = await cr.crypt(raw);
    if (closed) return;

    const info = headOf(plain);
    const head = mkHead(info.mode, info.target, info.media);
    const [cw, out, kr] = await Promise.all([
      cipher(raw, secret, true),
      wireHead(head),
      cipher(head, nil, true),
    ]);
    if (closed) return;

    const kws = await dial({ target: info.target, media: info.media, signal: ac.signal });
    if (closed) {
      kws.close();
      return;
    }

    peer = kws;
    cIn = cr;
    cOut = cw;
    kOut = out.cipher;
    kIn = kr;
    pkt = mkPkt(info.mode);

    await kws.write(out.wire);
    if (closed) return;
    hdr = nil;
    init = true;
    pump().catch(() => close());
  };

  const write = async (raw) => {
    if (closed || peer.closed) return false;
    const plain = await cIn.crypt(raw);
    if (closed || peer.closed) return false;

    const pkts = pkt.push(plain);
    for (let first = 0; first < pkts.length; ) {
      let last = first + 1;
      let n = pkts[first].byteLength;
      while (last < pkts.length && n + pkts[last].byteLength <= CFG.upPack) n += pkts[last++].byteLength;

      const chunk = pkts[first];
      const b = last === first + 1 ? chunk : new Uint8Array(chunk.buffer, chunk.byteOffset, n);
      if (closed || peer.closed) return false;

      const wire = await kOut.crypt(b);
      for (let o = 0; first < last; first++) {
        if (closed || peer.closed) return false;
        const len = pkts[first].byteLength;
        try {
          await peer.write(wire.subarray(o, o + len));
        } catch (err) {
          if (closed || peer.closed) return false;
          throw err;
        }
        o += len;
      }
    }
  };

  const pump = async () => {
    while (!closed) {
      const b = await peer.readPack();
      if (closed) return;
      if (!b) return close();
      const plain = await kIn.crypt(b);
      if (closed) return;
      const raw = await cOut.crypt(plain);
      if (closed) return;
      await emit(raw);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    ac.abort();
    try {
      peer?.close();
    } catch {}
    for (const job of uq) job.bytes = null;
    uq.clear();
    hdr = nil;
    pkt?.clear();
    cIn = cOut = kIn = kOut = peer = null;
    try {
      onClose();
    } catch {}
  };

  return { push, close };
}
