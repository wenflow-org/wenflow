-- 架构优化批 2a（2026-10-24）：learning_metrics 的 committed/synthetic/version 拆列。
-- 背景：读路径（当前状态/趋势/聚合/温故配额）此前用 metadata 字符串 LIKE
-- （`"version":"state-v2"` / `"committed":true` / `"synthetic":true`）过滤，
-- SQLite 下对每行做全文子串匹配，userId+calculatedAt 索引完全用不上。
-- 拆列 + 回填后读路径走 (userId, committed, calculatedAt) 组合索引精确命中；
-- metadata JSON 原样保留（审计/调试仍可读）。

ALTER TABLE `learning_metrics` ADD COLUMN `committed` BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE `learning_metrics` ADD COLUMN `synthetic` BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE `learning_metrics` ADD COLUMN `metricVersion` TEXT;

-- 回填存量：从 metadata JSON 提取（SQLite JSON1 内建；键缺失/非真 → 保持默认 0）
UPDATE `learning_metrics`
SET `committed` = 1
WHERE json_extract(`metadata`, '$.committed') = 1;

UPDATE `learning_metrics`
SET `synthetic` = 1
WHERE json_extract(`metadata`, '$.synthetic') = 1;

UPDATE `learning_metrics`
SET `metricVersion` = json_extract(`metadata`, '$.version')
WHERE json_extract(`metadata`, '$.version') IS NOT NULL;

-- 与 schema.prisma 的 @@index([userId, committed, calculatedAt]) 同名同列
-- （Prisma 索引命名约定：<table>_<cols...>_idx，保持 migrate diff 干净）
CREATE INDEX `learning_metrics_userId_committed_calculatedAt_idx`
ON `learning_metrics`(`userId`, `committed`, `calculatedAt`);
