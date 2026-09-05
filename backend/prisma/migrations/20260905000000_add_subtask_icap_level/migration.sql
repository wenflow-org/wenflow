-- 添加 subtasks.icapLevel 字段：stage-designer 标注 ICAP 档位落库（此前 prompt 要求但 normalize 丢弃）
ALTER TABLE subtasks ADD COLUMN "icapLevel" TEXT;
CREATE INDEX IF NOT EXISTS "subtasks_icapLevel_idx" ON "subtasks"("icapLevel");
