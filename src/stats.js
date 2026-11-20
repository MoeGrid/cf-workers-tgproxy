// 边缘实例内存指标。注意：这是单 isolate 局部值，不是全局聚合。

export const STATS = {
  // 不能在模块顶层取时间：Workers 全局作用域里 Date.now() 不可靠（会得到 0）。
  // 由第一个请求调用 markStart() 惰性写入。
  startTime: 0,
  totalSessions: 0,
  activeConnections: 0,
  totalTrafficBytes: 0,
};

export function markStart() {
  if (!STATS.startTime) STATS.startTime = Date.now();
}

export function formatTraffic(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分钟`;
  return `${m}分钟`;
}

function formatBootTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 生成 /api/stats 的响应体。 */
export function snapshot(env) {
  const uptime = formatDuration(Date.now() - STATS.startTime);
  return {
    active_connections: STATS.activeConnections,
    total_sessions: STATS.totalSessions,
    total_traffic: formatTraffic(STATS.totalTrafficBytes),
    uptime,
    machine_boot_time: env.MACHINE_BOOT_TIME || formatBootTime(STATS.startTime),
    machine_uptime: env.MACHINE_UPTIME || uptime,
  };
}
