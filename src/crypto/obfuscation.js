// MTProto 传输层 obfuscation 头的解析与重签。
//
// 只处理最外层 64 字节头：解密 -> 读 mode/DC/media -> 生成新头 -> 重新加密。
// 内层 MTProto 载荷始终是客户端端到端的，本模块不接触。

import { cat, dec, dup, nil, u8 } from '../util/bytes.js';
import { mkCtr, sha } from './aes.js';

const badHead = new Set(['HEAD', 'POST', 'GET ', 'OPTI']);
const i16 = (b, o) => ((b[o] | (b[o + 1] << 8)) << 16) >> 16;

/** 解出 64 字节头里的 mode(0xef/0xee/0xdd)、DC 序号与 media 标志。 */
export function headOf(head) {
  const tag = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(56, true);
  const mode = tag === 0xefefefef ? 0xef : tag === 0xeeeeeeee ? 0xee : tag === 0xdddddddd ? 0xdd : 0;
  if (!mode) throw Error();
  const dc = i16(head, 60);
  const target = Math.abs(dc) - 1;
  if (target < 0 || target >= 5) throw Error();
  return { mode, target, media: dc < 0 };
}

/** 生成一个随机但合法的 64 字节头。 */
export function mkHead(mode, target, media) {
  const head = new Uint8Array(64);
  do {
    globalThis.crypto.getRandomValues(head);
  } while (
    head[0] === 0xef ||
    badHead.has(dec.decode(head.subarray(0, 4))) ||
    head.subarray(4, 8).every((v) => v === 0)
  );
  head.fill(mode, 56, 60);
  new DataView(head.buffer).setInt16(60, (target + 1) * (media ? -1 : 1), true);
  return head;
}

/**
 * 由头本身派生 AES-CTR 上下文。
 * secret 为空时是「重签」模式：密钥直接取自头内材料，可逆。
 */
export async function cipher(head, secret, reverse) {
  const mat = dup(u8(head).subarray(8, 56));
  if (reverse) mat.reverse();
  const key = secret.byteLength ? await sha(cat(mat.subarray(0, 32), secret)) : mat.subarray(0, 32);
  return mkCtr(key, mat.subarray(32, 48));
}

/** 把新头封成 wire 格式（同时返回可复用的 cipher）。 */
export async function wireHead(head) {
  const ctr = await cipher(head, nil, false);
  const raw = await ctr.crypt(head);
  raw.set(u8(head).subarray(0, 56));
  return { wire: raw, cipher: ctr };
}
