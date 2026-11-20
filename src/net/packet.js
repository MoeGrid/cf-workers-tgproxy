// MTProto 传输包切分。
//
// mode 0xef: 1-4 字节长度头，单位为 4 字节字；0xee/0xdd: 4 字节小端长度。

import { cat, nil, u8 } from '../util/bytes.js';

const MAX_PACKET = 8 * 1024 * 1024;

export function mkPkt(mode) {
  let tail = nil;

  const push = (v) => {
    const b = u8(v);
    if (b.byteLength) tail = tail.byteLength ? cat(tail, b) : b;

    const pkts = [];
    let o = 0;
    for (;;) {
      const avail = tail.byteLength - o;
      let hLen;
      let pLen;

      if (mode === 0xef) {
        if (avail < 1) break;
        let words = tail[o] & 0x7f;
        if (words === 0x7f) {
          if (avail < 4) break;
          words = tail[o + 1] | (tail[o + 2] << 8) | (tail[o + 3] << 16);
          hLen = 4;
        } else hLen = 1;
        pLen = words * 4;
      } else {
        if (avail < 4) break;
        pLen = new DataView(tail.buffer, tail.byteOffset + o, 4).getUint32(0, true) & 0x7fffffff;
        hLen = 4;
      }

      if (!pLen || pLen > MAX_PACKET) throw Error();
      const total = hLen + pLen;
      if (avail < total) break;
      pkts.push(tail.subarray(o, o + total));
      o += total;
    }

    if (o) tail = o === tail.byteLength ? nil : tail.slice(o);
    if (tail.byteLength > MAX_PACKET + 4) throw Error();
    return pkts;
  };

  const clear = () => {
    tail = nil;
  };

  return { push, clear };
}
