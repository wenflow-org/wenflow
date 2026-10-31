-- 架构优化批 2b（2026-10-24）：PMC 滚动 checkpoint 表。
-- 用途见 schema.prisma 模型注释——读侧缓存，无外键（孤儿行无害），纯性能优化。

CREATE TABLE `learning_pmc_checkpoints` (
    `id` TEXT NOT NULL PRIMARY KEY,
    `userId` TEXT NOT NULL,
    `scope` TEXT NOT NULL,
    `dayKey` TEXT NOT NULL,
    `ktl` REAL NOT NULL,
    `lf` REAL NOT NULL,
    `latestLessonLss` REAL,
    `latestLessonAt` DATETIME,
    `metricVersion` TEXT NOT NULL,
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` DATETIME NOT NULL
);

CREATE UNIQUE INDEX `learning_pmc_checkpoints_userId_scope_dayKey_key`
ON `learning_pmc_checkpoints`(`userId`, `scope`, `dayKey`);

CREATE INDEX `learning_pmc_checkpoints_userId_scope_dayKey_idx`
ON `learning_pmc_checkpoints`(`userId`, `scope`, `dayKey`);
