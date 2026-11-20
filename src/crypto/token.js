// 密钥派生、HMAC 令牌（bootstrap / session）与租约记账。

import { txt, hex, b64, un64, rand, u8 } from '../util/bytes.js';
import { TTL } from '../config.js';

const CRYPTO = globalThis.crypto;
const macKeys = new Map();

/** session token -> lease。进程内 Map，随 isolate 生命周期。 */
export const leases = new Map();

/** 解析代理密钥。支持 32 位 hex，或 dd/ee/ef 前缀的 34 位形式。 */
export function getKey(v, keepTag = false) {
  const str = String(v || '').trim().toLowerCase();
  if (!/^(?:[0-9a-f]{32}|(?:dd|ee|ef)[0-9a-f]{32})$/.test(str)) throw Error();
  return hex(keepTag && str.length === 34 && str.startsWith('dd') ? str : str.slice(-32));
}

/** 按 id 缓存导入的 HMAC key，避免热路径反复 importKey。 */
export const macKey = (raw, id) => {
  let key = macKeys.get(id);
  if (!key) {
    macKeys.set(
      id,
      (key = CRYPTO.subtle.importKey('raw', u8(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])),
    );
  }
  return key;
};

export const sign = async (key, v) => new Uint8Array(await CRYPTO.subtle.sign('HMAC', await key, u8(v)));

/** 对 `<kind>\n<body>` 做 HMAC-SHA256，截断 16 字节。 */
export async function mac(boot, kind, body) {
  const prefix = txt.encode(`${kind}\n`);
  const msg = new Uint8Array(prefix.byteLength + body.byteLength);
  msg.set(prefix);
  msg.set(body, prefix.byteLength);
  return (await sign(macKey(txt.encode(boot), `token:${boot}`), msg)).slice(0, 16);
}

/** token = exp(4) + nonce(12) + mac(16)，base64url 后共 43 字符。 */
export async function mkToken(boot, kind, expAt, nonce) {
  const body = new Uint8Array(4 + 12);
  new DataView(body.buffer).setUint32(0, Math.ceil(expAt / 1000), false);
  body.set(nonce, 4);
  const token = new Uint8Array(32);
  token.set(body);
  token.set(await mac(boot, kind, body), body.byteLength);
  return b64(token);
}

export const mkBoot = async (boot) => mkToken(boot, 'bootstrap', Date.now() + TTL.bootstrap, rand(12));
export const mkSess = async (boot) => mkToken(boot, 'session', Date.now() + TTL.session, rand(12));

/** 校验 token：长度、base64 规范形态、过期时间、常量时间签名比较。 */
export async function verify(v, boot, kind) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v)) return false;
  let token;
  try {
    token = un64(v);
  } catch {
    return false;
  }
  if (token.byteLength !== 32 || b64(token) !== v) return false;
  const body = token.slice(0, 4 + 12);
  const sig = token.slice(body.byteLength);
  const exp = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, false);
  if (exp <= Math.floor(Date.now() / 1000)) return false;
  const want = await mac(boot, kind, body);
  let diff = sig.byteLength ^ want.byteLength;
  for (let i = 0; i < want.length; i++) diff |= sig[i] ^ want[i];
  return diff === 0;
}

/** bootstrap 既接受页面内联的明文值，也接受签名 token。 */
export const authBoot = async (v, boot) => v === boot || verify(v, boot, 'bootstrap');

export const mkLease = (token) => ({
  expires: new DataView(un64(token).buffer).getUint32(0) * 1000,
  active: new Set(),
  used: new Set(),
  deleted: false,
});

/** 读取并校验必需的环境绑定。缺任何一个都抛错，让 /health 明确失败。 */
export function mkCfg({ SECRET, BOOT }) {
  const secret = String(SECRET || '').trim();
  const boot = String(BOOT || '').trim();
  if (!secret) throw Error();
  if (!boot) throw Error();
  return { secret, key: getKey(secret), boot };
}
