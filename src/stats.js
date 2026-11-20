// 边缘实例内存指标。注意：这是单 isolate 局部值，不是全局聚合。

export const STATS = {
  totalSessions: 0,
  activeConnections: 0,
  totalTrafficBytes: 0,
};

export function formatTraffic(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/** 生成 /api/stats 的响应体。 */
export function snapshot() {
  return {
    active_connections: STATS.activeConnections,
    total_sessions: STATS.totalSessions,
    total_traffic: formatTraffic(STATS.totalTrafficBytes),
  };
}
