// AES-CTR 流式加解密。计数器跨块推进，支持任意长度切片。

import { dup, u8, nil } from '../util/bytes.js';

const CRYPTO = globalThis.crypto;

/** 把 128-bit 大端计数器加 n。溢出直接抛错。 */
export function step(ctr, n) {
  let carry = n;
  for (let i = ctr.length - 1; i >= 0 && carry; i--) {
    const next = ctr[i] + (carry & 0xff);
    ctr[i] = next & 0xff;
    carry = Math.floor(carry / 256) + Math.floor(next / 256);
  }
  if (carry) throw Error();
}

export const sha = async (v) => new Uint8Array(await CRYPTO.subtle.digest('SHA-256', u8(v)));

/**
 * 返回一个 { crypt } 对象。crypt 可被反复调用，内部维护计数器与未消费的
 * keystream 尾巴，因此对上游任意切片都能得到连续正确的密文。
 */
export function mkCtr(key, ctr) {
  const iv = dup(ctr);
  let tail = nil;
  const ready = CRYPTO.subtle.importKey('raw', u8(key), { name: 'AES-CTR' }, false, ['encrypt']);

  const crypt = async (v) => {
    const b = u8(v);
    if (!b.byteLength) return new Uint8Array(0);
    const key = await ready;

    // 整块且无残留：一次走原生的整块加密。
    if (!tail.byteLength && !(b.byteLength % 16)) {
      const raw = new Uint8Array(
        await CRYPTO.subtle.encrypt({ name: 'AES-CTR', counter: iv.slice(), length: 128 }, key, b),
      );
      step(iv, b.byteLength / 16);
      return raw;
    }

    // 剩余 keystream 足够：纯 XOR，不消耗计数器。
    if (b.byteLength <= tail.byteLength) {
      const out = new Uint8Array(b.byteLength);
      for (let i = 0; i < b.byteLength; i++) out[i] = b[i] ^ tail[i];
      tail = tail.slice(b.byteLength);
      return out;
    }

    // 跨块：补齐到整块边界，加密后切掉前导 keystream。
    const skip = tail.byteLength ? 16 - tail.byteLength : 0;
    const blockCtr = iv.slice();
    if (skip) {
      for (let i = blockCtr.length - 1; i >= 0; i--) if (blockCtr[i]--) break;
    }
    const end = skip + b.byteLength;
    const block = new Uint8Array(Math.ceil(end / 16) * 16);
    block.set(b, skip);
    const raw = new Uint8Array(
      await CRYPTO.subtle.encrypt({ name: 'AES-CTR', counter: blockCtr, length: 128 }, key, block),
    );
    tail = raw.slice(end);
    step(iv, block.byteLength / 16 - (skip ? 1 : 0));
    return raw.subarray(skip, end);
  };

  return { crypt };
}
