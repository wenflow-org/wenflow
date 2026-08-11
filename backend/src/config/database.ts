import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// SQLite 锁风暴根治（2026-08）：WAL 模式 + busy_timeout
// - WAL：读写并发、单写不阻塞读，避免 rollback journal 下 74MB 级写事务长时间独占锁
// - busy_timeout：锁冲突时等待而非立即报 database is locked
// PostgreSQL 等其余 provider 无此 PRAGMA，忽略即可。
const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
if (isSqlite) {
  Promise.allSettled([
    prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;'),
    prisma.$executeRawUnsafe('PRAGMA busy_timeout=30000;'),
    prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;')
  ]).catch(() => {
    // PRAGMA 失败不阻断启动（如 readonly 场景），仅提示
    console.warn('[database] SQLite PRAGMA 初始化未全部生效');
  });
}

export default prisma;
