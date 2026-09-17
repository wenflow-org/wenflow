-- AddColumn: memory_traces.pathId（记忆条目的来源路径）
-- 目的（审计 §3.18）：此前记忆条目没有路径身份，导致
--   ① 温故点的"这是你在《X》里学过的"只能靠 review 证据反查（首次复习前为空）；
--   ② 按路径限定复习范围（A′）无法实现。
-- 写入侧从会话带入；历史行留 NULL（未知来源，读取侧回落到证据反查）。
ALTER TABLE "memory_traces" ADD COLUMN "pathId" TEXT;

CREATE INDEX "memory_traces_userId_pathId_idx" ON "memory_traces"("userId", "pathId");
