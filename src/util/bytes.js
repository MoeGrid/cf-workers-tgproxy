// 字节与编码工具：全项目共用的最小原语。

export const txt = new TextEncoder();
export const dec = new TextDecoder();
export const nil = new Uint8Array(0);

/** 把 ArrayBuffer / TypedArray / 普通数组统一成 Uint8Array。 */
export function u8(v) {
  if (v instanceof Uint8Array && v.constructor === Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw TypeError();
}

/** 复制一份，避免持有外部 buffer 的引用。 */
export const dup = (v) => u8(v).slice();

/** 拼接任意多个字节片段，自动跳过空片段。 */
export function cat(...args) {
  const parts = args.filter((v) => v?.byteLength).map(u8);
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.byteLength;
  }
  return out;
}

export const hex = (v) =>
  Uint8Array.from({ length: v.length / 2 }, (_, i) => Number.parseInt(v.slice(i * 2, i * 2 + 2), 16));

/** base64url 编码，无填充。 */
export function b64(v) {
  const b = v instanceof Uint8Array ? v : new Uint8Array(v);
  return btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function un64(v) {
  const s = v.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** 唤醒一个在队列上空等的等待者（背压用）。 */
export function wake(st) {
  const { wake: ok } = st;
  st.wake = null;
  ok?.();
}
