/**
 * 单实例锁单测（架构优化批 #3）：获取/释放/陈旧回收/活实例冲突/豁免/启动目录无关性。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireInstanceLock,
  InstanceConflictError,
  isPidAlive,
  resolveLockFilePath,
  resolveLockKey,
} from '../instance-lock';

describe('instance-lock（单实例断言）', () => {
  it('resolveLockKey：file: 相对路径锚定 backend 包根，同库不同写法/不同启动目录同键', () => {
    const backendRoot = path.resolve(__dirname, '..', '..', '..');
    const a = resolveLockKey('file:./prisma/dev.db');
    const b = resolveLockKey('file:prisma/dev.db');
    const c = resolveLockKey('file:./prisma/../prisma/dev.db?connection_limit=1');
    expect(a).toBe(path.join(backendRoot, 'prisma', 'dev.db'));
    expect(a).toBe(b);
    expect(a).toBe(c);
    // 非 file 协议用原串（不同库互不冲突）
    expect(resolveLockKey('postgresql://x/y')).toBe('postgresql://x/y');
  });

  it('isPidAlive：自身存活、天外 PID 判死', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(999_999_999)).toBe(false);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });

  it('获取→释放→可再次获取（幂等释放不抛错）；锁落在 backend/.runtime/', () => {
    const lockPath = resolveLockFilePath('file:./prisma/dev.db');
    expect(lockPath).toContain(path.join('.runtime', 'instance-'));
    const lock = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
    expect(fs.existsSync(lockPath)).toBe(true);
    lock.release();
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(() => lock.release()).not.toThrow();
    const again = acquireInstanceLock('file:./prisma/dev.db', { port: 3002 });
    again.release();
  });

  it('活实例在跑 → 拒启并携带 PID/端口信息', () => {
    const holder = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
    try {
      acquireInstanceLock('file:./prisma/dev.db', { port: 3011 });
      throw new Error('应当抛 InstanceConflictError');
    } catch (error) {
      expect(error).toBeInstanceOf(InstanceConflictError);
      const conflict = (error as InstanceConflictError).conflict;
      expect(conflict.pid).toBe(process.pid);
      expect(conflict.port).toBe('3001');
      expect(conflict.startedAt).toBeTruthy();
    } finally {
      holder.release();
    }
  });

  it('陈旧锁（持有进程已死/内容损坏）→ 回收后获取成功', () => {
    const lockPath = resolveLockFilePath('file:./prisma/dev.db');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    // 伪造陈旧锁：写入一个已不存在的 PID
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, port: '9', startedAt: 'x' }));
    const lock = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
    lock.release();
    // 内容损坏同理
    fs.writeFileSync(lockPath, 'not-json{{{');
    const lock2 = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
    lock2.release();
  });

  it('不同数据库 → 不同锁文件，互不阻塞', () => {
    const a = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
    const b = acquireInstanceLock('file:./prisma/ci-main.db', { port: 3011 });
    b.release();
    a.release();
  });

  it('allowOverride=true → 跳过断言直接放行', () => {
    const holder = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
    const bypass = acquireInstanceLock('file:./prisma/dev.db', { port: 3011, allowOverride: true });
    bypass.release();
    holder.release();
  });

  describe('WENFLOW_RUNTIME_DIR 锁目录覆盖（#141 Docker 部署）', () => {
    const originalRuntimeDir = process.env.WENFLOW_RUNTIME_DIR;
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instance-lock-runtime-'));
    });

    afterEach(() => {
      if (originalRuntimeDir === undefined) delete process.env.WENFLOW_RUNTIME_DIR;
      else process.env.WENFLOW_RUNTIME_DIR = originalRuntimeDir;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('env 覆盖生效：锁文件落到 <WENFLOW_RUNTIME_DIR>/.runtime/，获取/释放照常工作', () => {
      process.env.WENFLOW_RUNTIME_DIR = tmpRoot;
      const lockPath = resolveLockFilePath('file:./prisma/dev.db');
      expect(lockPath).toBe(path.join(tmpRoot, '.runtime', path.basename(lockPath)));

      const lock = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
      expect(fs.existsSync(lockPath)).toBe(true);
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('env 覆盖只改锁文件落点，不改锁键（同库在默认与覆盖下键一致）', () => {
      const defaultPath = resolveLockFilePath('file:./prisma/dev.db');
      process.env.WENFLOW_RUNTIME_DIR = tmpRoot;
      const overridePath = resolveLockFilePath('file:./prisma/dev.db');
      expect(path.basename(overridePath)).toBe(path.basename(defaultPath));
      expect(path.dirname(path.dirname(overridePath))).toBe(tmpRoot);
    });

    it('env 未设或纯空白 → 默认行为不变（backend 包根/.runtime）', () => {
      delete process.env.WENFLOW_RUNTIME_DIR;
      const backendRoot = path.resolve(__dirname, '..', '..', '..');
      expect(resolveLockFilePath('file:./prisma/dev.db')).toContain(path.join(backendRoot, '.runtime', 'instance-'));

      process.env.WENFLOW_RUNTIME_DIR = '   ';
      expect(resolveLockFilePath('file:./prisma/dev.db')).toContain(path.join(backendRoot, '.runtime', 'instance-'));
    });

    it('env 指向不存在目录 → mkdir recursive 自动创建', () => {
      const nested = path.join(tmpRoot, 'data', 'runtime');
      process.env.WENFLOW_RUNTIME_DIR = nested;
      const lock = acquireInstanceLock('file:./prisma/dev.db', { port: 3001 });
      expect(fs.existsSync(path.join(nested, '.runtime'))).toBe(true);
      lock.release();
    });
  });
});
