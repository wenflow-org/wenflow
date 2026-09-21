import 'dotenv/config';
import { PrismaClient } from '../generated/system-client';

const globalForSystemPrisma = globalThis as unknown as {
  systemPrisma: PrismaClient | undefined;
};

export const systemPrisma = globalForSystemPrisma.systemPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForSystemPrisma.systemPrisma = systemPrisma;
}

// 与主库（config/database.ts）同款 SQLite PRAGMA：system 库此前缺 WAL/busy_timeout，
// 锁冲突会立即报 database is locked 而非等待。PRAGMA 失败不阻断启动。
const isSqlite = (process.env.SYSTEM_DATABASE_URL || '').startsWith('file:');
if (isSqlite) {
  Promise.allSettled([
    systemPrisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;'),
    systemPrisma.$executeRawUnsafe('PRAGMA busy_timeout=30000;'),
    systemPrisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;')
  ]).catch(() => {
    console.warn('[system-database] SQLite PRAGMA 初始化未全部生效');
  });
}

export default systemPrisma;
