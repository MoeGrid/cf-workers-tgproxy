// lane 帧编解码：8 字节头 = type(1) + sid(3, big-endian) + length(4, big-endian)。

import { nil, u8 } from './bytes.js';

export const isType = (t) => t === 1 || t === 2 || t === 3 || t === 4 || t === 17;

export function enc(type, sid, data = nil) {
  const body = u8(data);
  if (!isType(type)) throw RangeError();
  if (!Number.isInteger(sid) || sid < 0 || sid > 0xffffff) throw RangeError();
  if (body.byteLength > 1024 * 1024) throw RangeError();
  const frame = new Uint8Array(8 + body.byteLength);
  frame[0] = type;
  frame[1] = sid >>> 16;
  frame[2] = sid >>> 8;
  frame[3] = sid;
  new DataView(frame.buffer).setUint32(4, body.byteLength, false);
  frame.set(body, 8);
  return frame;
}

/** 从偏移 o 解析一帧；数据不完整返回 null。 */
export function getFrame(b, o) {
  if (b.byteLength - o < 8) return null;
  const type = b[o];
  if (!isType(type)) throw Error();
  const view = new DataView(b.buffer, b.byteOffset + o, b.byteLength - o);
  const sid = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const n = view.getUint32(4, false);
  if (n > 1024 * 1024) throw Error();
  const total = 8 + n;
  if (b.byteLength - o < total) return null;
  return { frame: { type, sid, payload: b.subarray(o + 8, o + total) }, consumed: total };
}

/** 把一个缓冲区拆成完整帧数组；任何不完整/非法都视为错误。 */
export function frames(v) {
  const src = u8(v);
  const out = [];
  for (let o = 0; o < src.byteLength; ) {
    const part = getFrame(src, o);
    if (!part) throw Error();
    if (out.length >= 4096) throw Error();
    out.push(part.frame);
    o += part.consumed;
  }
  return out;
}

/** 流量控制帧的 4 字节窗口值。 */
export function win(data) {
  const body = u8(data);
  if (body.byteLength !== 4) throw Error();
  const n = new DataView(body.buffer, body.byteOffset, 4).getUint32(0, false);
  if (!n) throw Error();
  return n;
}

/** 校验并返回帧的窗口增量（仅 type 4 有值）。 */
export function check(frame) {
  const { type, payload: data } = frame;
  if (type === 1 || type === 3) {
    if (data.byteLength) throw Error();
    return 0;
  }
  if (type === 2) {
    if (!data.byteLength) throw Error();
    return 0;
  }
  if (type === 4) return win(data);
  throw Error();
}
