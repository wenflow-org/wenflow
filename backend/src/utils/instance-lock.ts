/**
 * 单实例断言（架构优化批 #3）：同一数据目录只允许一个后端进程持有运行权。
 *
 * 为什么需要：本应用的运行时组件全部假设单实例——SQLite 单写者、进程内 RPM 限流桶、
 * 进程内调度器（autopilot 对账/会话回收/缓存预热）、outbox 单 worker、进程内互斥锁
 * （utils/keyed-lock）。restart.mjs 只防"同端口"双实例；换端口（--port=3011）起第二个
 * 进程共享同一 SQLite 时，限流形同虚设、租约互斥失效、outbox 双消费。
 * 本模块把"单实例假设"变成启动期硬守卫：锁文件以**主库文件绝对路径**为键（不同库的
 * 测试/CI 实例互不阻塞），冲突时携带在跑实例的 PID/端口拒启。
 *
 * 语义：
 * - 获取：`file:./xxx.db` 解析为绝对路径 → sha1 → `<锁目录锚点>/.runtime/instance-<hash>.lock`
 *   （锚点默认 backend 包根；容器部署用 WENFLOW_RUNTIME_DIR 覆盖到可写数据卷，见 #141）；
 *   内容 = {pid, port, startedAt}；`wx` 独占创建，成功即持有。
 * - 陈旧锁：持有进程已死（PID 探活失败）或内容不可解析 → 回收重试一次（最多 2 轮）。
 *   PID 复用是尽力而为的启发式（无跨平台命令行校验），冲突信息里带 startedAt 供人工判断。
 * - 释放：优雅关闭时 unlink；进程被 kill -9 时残留文件由下次启动的陈旧锁回收兜底。
 * - 豁免：`WENFLOW_ALLOW_MULTI_INSTANCE=1` 跳过（本地调试双实例用，启动日志会高声提示）。
 * - 边界（诚实声明）：只防"同机同库"双实例；跨机共享 SQLite 文件系统不在防护范围
 *   （当前部署形态不存在该拓扑）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { logger } from './logger';

const LOCK_DIR_NAME = '.runtime';
const MAX_ACQUIRE_ROUNDS = 2;
/**
 * 锚定 backend 包根（src/utils 与 dist/utils 同为两级上溯，ts-node 与编译产物一致）。
 * 相对 `file:` 路径必须锚在固定位置解析——锚 process.cwd() 会让"从仓库根启动"的第二个
 * 实例算出不同键、静默绕过断言（2026-10-24 实测发现的口径洞）。
 */
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/**
 * 锁目录锚点（#141 Docker 部署）：默认 backend 包根（本地开发不变，仍 backend/.runtime）；
 * 容器内包根（/app）归 root、进程以非 root 运行时 mkdir 必然 EACCES——部署侧用
 * WENFLOW_RUNTIME_DIR 把锁目录指到已可写的数据卷（如 /app/data/.runtime，随数据卷持久）。
 * 只影响锁文件落点；锁键（主库路径解析）仍锚定包根，不受该变量影响。
 */
function resolveLockDirRoot(): string {
  const configured = String(process.env.WENFLOW_RUNTIME_DIR || '').trim();
  if (configured) return path.resolve(configured);
  return BACKEND_ROOT;
}

export interface InstanceLockHandle {
  /** 释放锁（幂等；优雅关闭路径调用） */
  release: () => void;
}

export class InstanceConflictError extends Error {
  constructor(readonly conflict: { pid: number | null; port: string | null; startedAt: string | null; lockPath: string }) {
    super(
      `检测到另一后端实例正在运行（pid=${conflict.pid ?? '?'} port=${conflict.port ?? '?'} 自 ${conflict.startedAt ?? '?'}）。`
      + ' 本应用为单实例架构（SQLite 单写者 + 进程内限流/调度/互斥），第二个实例会造成限流失效与数据竞争。'
      + ' 请先停止旧实例（node backend/restart.mjs --stop），或换用不同数据库；'
      + ' 确需同库双实例调试可设 WENFLOW_ALLOW_MULTI_INSTANCE=1（自担风险）。',
    );
    this.name = 'InstanceConflictError';
  }
}

/** 进程存活探测（跨平台）：signal 0 不发信号只探权限；ESRCH=不存在，EPERM=存在但属他人。 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 主库数据源 → 锁键：`file:` 相对路径锚定 backend 包根解析（与启动目录无关）；其它协议用原串。 */
export function resolveLockKey(databaseUrl: string): string {
  const raw = String(databaseUrl || '').trim();
  if (raw.startsWith('file:')) {
    const filePath = raw.slice('file:'.length).split('?')[0];
    return path.resolve(BACKEND_ROOT, filePath);
  }
  return raw;
}

/** 锁键 → 锁文件路径（`<锁目录锚点>/.runtime/instance-<hash>.lock`；锚点默认 backend 包根，可被 WENFLOW_RUNTIME_DIR 覆盖）。 */
export function resolveLockFilePath(databaseUrl: string): string {
  const keyHash = createHash('sha1').update(resolveLockKey(databaseUrl)).digest('hex').slice(0, 16);
  return path.join(resolveLockDirRoot(), LOCK_DIR_NAME, `instance-${keyHash}.lock`);
}

function readLockContent(lockPath: string): { pid: number | null; port: string | null; startedAt: string | null } {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as Record<string, unknown>;
    return {
      pid: typeof parsed.pid === 'number' ? parsed.pid : null,
      port: typeof parsed.port === 'string' ? parsed.port : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
    };
  } catch {
    return { pid: null, port: null, startedAt: null };
  }
}

/**
 * 获取单实例锁。冲突抛 InstanceConflictError（含在跑实例信息）。
 * @param databaseUrl 主库连接串（键来源；相对 file: 路径锚定 backend 包根，与启动目录无关）
 * @param opts.port 本实例端口（写入锁文件供冲突信息展示）
 */
export function acquireInstanceLock(
  databaseUrl: string,
  opts: { port: string | number; allowOverride?: boolean },
): InstanceLockHandle {
  if (opts.allowOverride ?? process.env.WENFLOW_ALLOW_MULTI_INSTANCE === '1') {
    logger.warn('[instance-lock] WENFLOW_ALLOW_MULTI_INSTANCE=1：跳过单实例断言（限流/调度互斥可能失效，仅限调试）');
    return { release: () => undefined };
  }

  const lockPath = resolveLockFilePath(databaseUrl);
  const lockDir = path.dirname(lockPath);
  fs.mkdirSync(lockDir, { recursive: true });

  for (let round = 0; round < MAX_ACQUIRE_ROUNDS; round += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          port: String(opts.port),
          startedAt: new Date().toISOString(),
          key: resolveLockKey(databaseUrl),
        }));
      } finally {
        fs.closeSync(fd);
      }
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // 释放失败（文件已不在/权限）不影响关闭流程：陈旧锁由下次启动回收
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const content = readLockContent(lockPath);
      // PID 不可知或已死 = 陈旧锁（进程被 kill -9 / 机器重启残留）→ 回收重试
      const stale = content.pid === null || !isPidAlive(content.pid);
      if (stale && round < MAX_ACQUIRE_ROUNDS - 1) {
        logger.warn('[instance-lock] 回收陈旧锁文件', { lockPath, oldPid: content.pid });
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // 竞态：另一实例恰好已回收/持有 → 下一轮 openSync 自见分晓
        }
        continue;
      }
      if (stale) {
        // 第二轮仍抢不到：回收后瞬间被别人占有 → 按冲突处理（信息尽力）
        throw new InstanceConflictError({ ...content, lockPath });
      }
      throw new InstanceConflictError({ ...content, lockPath });
    }
  }
  /* c8 ignore next -- 循环内必然 return/throw，此处仅为类型完备 */
  throw new Error('[instance-lock] 未预期路径');
}
