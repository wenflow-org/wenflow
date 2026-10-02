-- 后端进程启动登记表：虚拟会话回收「确证孤儿」判据的活性底座
-- 快档孤儿判据 = 会话最后写入 < 所有存活后端进程中最早的启动时间（MIN(boot_at) over 心跳存活行）
-- 代码侧经 $executeRawUnsafe 使用（Prisma client 再生成前兼容）；本迁移保证表结构入库有据
CREATE TABLE IF NOT EXISTS backend_boot_registry (
  instance_id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  boot_at INTEGER NOT NULL,
  hb_at INTEGER NOT NULL
);
