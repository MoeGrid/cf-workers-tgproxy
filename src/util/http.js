// HTTP 请求侧的小工具：认证头、内容类型、主机名校验。

export const reply = (body = null, status = 404) => new Response(body, { status });

/** 解析 `Authorization: Bearer <token>`。 */
export const bearer = (v) => /^Bearer ([^\s]+)$/.exec(v || '')?.[1] ?? null;

export const binary = (req) =>
  req.headers.get('Content-Type')?.trim().toLowerCase() === 'application/octet-stream';

/** session 握手包体：0x10 00 00 00 | 01 00 00 00 | 01，共 9 字节。 */
export function hello(body) {
  if (
    body.byteLength !== 9 ||
    body[0] !== 0x10 ||
    body[1] !== 0 ||
    body[2] !== 0 ||
    body[3] !== 0 ||
    new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(4, false) !== 1 ||
    body[8] !== 1
  ) {
    throw Error();
  }
}

/** 解析 WebSocket 子协议列表。 */
export const protos = (req) =>
  (req.headers.get('Sec-WebSocket-Protocol') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** 严格校验并归一化主机名，避免签名被主机名歧义绕过。 */
export function hostOf(v) {
  const host = String(v || '').trim().toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (
    !host.includes('.') ||
    host.length > 253 ||
    host.includes(':') ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw Error();
  }
  return host;
}
