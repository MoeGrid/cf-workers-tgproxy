// `?bridge=` 能力签名：客户端带签名访问根路径 -> 下发隧道页。
//
// 签名消息前缀是客户端侧写死的约定，不能修改，否则客户端校验不通过。

import { b64, txt } from '../util/bytes.js';
import { hostOf } from '../util/http.js';
import { getKey, macKey, sign } from '../crypto/token.js';

const BRIDGE_PREFIX = 'tdesktop-web-proxy-bridge-v1';

/** 对 host 生成 43 字符 base64url 签名。 */
export async function mkCap(secret, host) {
  const key = macKey(getKey(secret, true), `bridge:${String(secret).trim().toLowerCase()}`);
  const sig = await sign(key, txt.encode(`${BRIDGE_PREFIX}\n${hostOf(host)}`));
  return b64(sig);
}

/**
 * 校验根路径上的 bridge 签名。
 * 命中返回归一化 host，否则返回 null。
 */
export async function bridge(url, secret) {
  if (url.pathname !== '/' || url.search.length !== 51) return null;
  const cand = url.search.slice(8);
  if (url.search !== `?bridge=${cand}` || !/^[A-Za-z0-9_-]{43}$/.test(cand)) return null;
  const host = hostOf(url.hostname);
  const want = await mkCap(secret, host);
  if (cand.length !== want.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= cand.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0 ? host : null;
}
