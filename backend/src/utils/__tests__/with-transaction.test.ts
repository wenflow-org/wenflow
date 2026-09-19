/**
 * 事务写入封装单测（架构审计 P0）
 * - timeout/maxWait 透传（默认 + 覆盖）
 * - 瞬时冲突（P2034 / SQLITE_BUSY）退避重试
 * - 非瞬时错误不重试
 * - 重试耗尽后抛出原始错误（不吞错）
 * - system client 同形状复用
 */
const mockMainTransaction = jest.fn();
const mockSystemTransaction = jest.fn();

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { $transaction: (...args: unknown[]) => mockMainTransaction(...args) }
}));
jest.mock('../../config/system-database', () => ({
  __esModule: true,
  systemPrisma: { $transaction: (...args: unknown[]) => mockSystemTransaction(...args) },
  default: { $transaction: (...args: unknown[]) => mockSystemTransaction(...args) }
}));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import {
  DEFAULT_TRANSACTION_MAX_RETRIES,
  DEFAULT_TRANSACTION_MAX_WAIT_MS,
  DEFAULT_TRANSACTION_TIMEOUT_MS,
  createTransactionRunner,
  describeTransactionErrorCode,
  isTransientTransactionError,
  runWithTransaction,
  withSystemTransaction,
  withTransaction,
  type TransactionHost
} from '../with-transaction';

type TxCallback = (tx: unknown) => Promise<unknown>;

function fakeHost() {
  const transaction = jest.fn(async (callback: TxCallback) => callback({}));
  const host = { $transaction: transaction } as unknown as TransactionHost<unknown>;
  return { transaction, host };
}

function transientError(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

describe('isTransientTransactionError', () => {
  it('识别 Prisma P2034 与 SQLite busy/write-conflict', () => {
    expect(isTransientTransactionError(transientError('write conflict', 'P2034'))).toBe(true);
    expect(isTransientTransactionError(transientError('database is locked'))).toBe(true);
    expect(isTransientTransactionError(transientError('database table is locked'))).toBe(true);
    expect(isTransientTransactionError(transientError('SQLITE_BUSY'))).toBe(true);
    expect(isTransientTransactionError(transientError('busy', 'SQLITE_BUSY_SNAPSHOT'))).toBe(true);
    expect(isTransientTransactionError(transientError('write conflict detected'))).toBe(true);
  });

  it('非瞬时错误不判为可重试', () => {
    expect(isTransientTransactionError(transientError('unique constraint', 'P2002'))).toBe(false);
    expect(isTransientTransactionError(new Error('boom'))).toBe(false);
    expect(isTransientTransactionError(null)).toBe(false);
    expect(isTransientTransactionError(undefined)).toBe(false);
    expect(isTransientTransactionError('P2034')).toBe(false);
  });

  it('翻译可识别的事务错误码', () => {
    expect(describeTransactionErrorCode('P2034')).toContain('P2034');
    expect(describeTransactionErrorCode('P2002')).toBeNull();
    expect(describeTransactionErrorCode(null)).toBeNull();
  });
});

describe('runWithTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('默认透传 timeout/maxWait，并返回回调结果', async () => {
    const tx = { marker: 'tx' };
    const { transaction, host } = fakeHost();
    transaction.mockImplementation(async (callback: TxCallback) => callback(tx));

    const result = await runWithTransaction(host, async (inner) => {
      expect(inner).toBe(tx);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: DEFAULT_TRANSACTION_TIMEOUT_MS,
      maxWait: DEFAULT_TRANSACTION_MAX_WAIT_MS
    });
  });

  it('显式 timeout/maxWait 覆盖默认值', async () => {
    const { transaction, host } = fakeHost();

    await runWithTransaction(host, async () => 'ok', { timeout: 1234, maxWait: 567 });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 1234,
      maxWait: 567
    });
  });

  it('瞬时冲突后重试并最终成功', async () => {
    const tx = { marker: 'tx' };
    const { transaction, host } = fakeHost();
    transaction
      .mockRejectedValueOnce(transientError('write conflict', 'P2034'))
      .mockImplementationOnce(async (callback: TxCallback) => callback(tx));

    const result = await runWithTransaction(host, async (inner) => {
      expect(inner).toBe(tx);
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('非瞬时错误不重试，直接抛出原始错误', async () => {
    const original = transientError('unique constraint failed', 'P2002');
    const { transaction, host } = fakeHost();
    transaction.mockRejectedValue(original);

    await expect(runWithTransaction(host, async () => 'x')).rejects.toBe(original);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('重试耗尽后抛出原始错误（不吞错）', async () => {
    const original = transientError('database is locked', 'SQLITE_BUSY');
    const { transaction, host } = fakeHost();
    transaction.mockRejectedValue(original);

    await expect(
      runWithTransaction(host, async () => 'x', { maxRetries: 1 })
    ).rejects.toBe(original);
    expect(transaction).toHaveBeenCalledTimes(1 + 1);
  });

  it('maxRetries=0 时瞬时错误也不重试', async () => {
    const original = transientError('write conflict', 'P2034');
    const { transaction, host } = fakeHost();
    transaction.mockRejectedValue(original);

    await expect(
      runWithTransaction(host, async () => 'x', { maxRetries: 0 })
    ).rejects.toBe(original);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('客户端绑定封装', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('withTransaction 走主库并透传选项', async () => {
    mockMainTransaction.mockImplementation(async (callback: TxCallback) => callback({ main: true }));

    const result = await withTransaction(async (tx) => {
      expect(tx).toEqual({ main: true });
      return 'main-ok';
    }, { timeout: 2222, label: 'test.main' });

    expect(result).toBe('main-ok');
    expect(mockMainTransaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 2222,
      maxWait: DEFAULT_TRANSACTION_MAX_WAIT_MS
    });
  });

  it('withSystemTransaction 复用同一形状', async () => {
    mockSystemTransaction.mockImplementation(async (callback: TxCallback) => callback({ system: true }));

    const result = await withSystemTransaction(async (tx) => {
      expect(tx).toEqual({ system: true });
      return 'system-ok';
    });

    expect(result).toBe('system-ok');
    expect(mockSystemTransaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: DEFAULT_TRANSACTION_TIMEOUT_MS,
      maxWait: DEFAULT_TRANSACTION_MAX_WAIT_MS
    });
  });

  it('createTransactionRunner 可绑定任意客户端', async () => {
    const { transaction, host } = fakeHost();
    const runner = createTransactionRunner(host);

    await runner(async (tx) => {
      expect(tx).toEqual({});
      return 1;
    }, { maxRetries: DEFAULT_TRANSACTION_MAX_RETRIES });

    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
