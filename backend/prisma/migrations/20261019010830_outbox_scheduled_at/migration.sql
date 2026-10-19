-- AlterTable
ALTER TABLE "domain_event_outbox" ADD COLUMN "scheduledAt" DATETIME;

-- #106② 存量排期保留（人工补充）：未决行中 availableAt 落在未来的（虚拟实验室按模拟日写入，
-- 现存 10-19…10-26 共 36 行），其原有可用时刻就是排期，回填 scheduledAt = availableAt。
-- Prisma 的 SQLite 连接器把 DateTime 存为「epoch 毫秒整数」，因此判未来用 strftime('%s')*1000。
-- 其余行 scheduledAt 保持 NULL = 立即可用；配合 worker 新拾取门
-- 「availableAt <= now AND (scheduledAt IS NULL OR scheduledAt <= now)」，存量行为与旧门逐一等价。
UPDATE "domain_event_outbox"
SET "scheduledAt" = "availableAt"
WHERE "status" IN ('pending', 'processing')
  AND "availableAt" > CAST(strftime('%s','now') AS INTEGER) * 1000;
