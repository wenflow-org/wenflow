// 模拟协调器 - 模块级错误类（自 simulation.coordinator.ts 抽离，行为保持不变）

export class VirtualSessionLeaseBusyError extends Error {
  readonly code = 'VIRTUAL_SESSION_BUSY';
  readonly statusCode = 409;
  readonly retryable = true;

  constructor() {
    super('当前模拟会话正在执行其他写操作，请稍后重试');
    this.name = 'VirtualSessionLeaseBusyError';
  }
}

export class VirtualSessionLeaseLostError extends Error {
  readonly code = 'VIRTUAL_SESSION_LEASE_LOST';
  readonly statusCode = 409;
  readonly retryable = true;

  constructor() {
    super('模拟会话执行租约已丢失，请重试');
    this.name = 'VirtualSessionLeaseLostError';
  }
}

export class VirtualSessionDatabaseBusyError extends Error {
  readonly code = 'DB_BUSY';
  readonly statusCode = 503;
  readonly retryable = true;

  constructor(readonly originalError?: unknown) {
    super('租约数据库暂时繁忙，请稍后重试');
    this.name = 'VirtualSessionDatabaseBusyError';
  }
}
