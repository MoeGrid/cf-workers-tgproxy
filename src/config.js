// 运行时配置与固定参数。所有数值与原实现保持一致。

export const CFG = {
  dnPack: 32 * 1024, // 下行单次合包上限
  upPack: 20 * 1024, // 上行合包目标
  dnMs: 1, // 下行 quiet window
};

// 路由层配额
export const LIMITS = {
  lanesPerSession: 128,
  usedSidsPerSession: 4096,
  leases: 4096,
  wsMessage: 2 * 1024 * 1024,
};

export const TTL = {
  bootstrap: 2 * 60 * 1000,
  session: 5 * 60 * 1000,
};
