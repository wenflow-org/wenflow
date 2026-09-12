-- 预制虚拟学习者：来源标记 + 幂等键 + 定义版本
-- builtin 由启动同步（virtual-learners/presets.yaml → ensureBuiltinVirtualLearners）按 presetKey 幂等创建/更新；
-- custom 为后台手动 / AI 创建，presetKey 为 NULL。
ALTER TABLE "virtual_learner_profiles" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE "virtual_learner_profiles" ADD COLUMN "presetKey" TEXT;
ALTER TABLE "virtual_learner_profiles" ADD COLUMN "presetVersion" INTEGER;

-- SQLite 唯一索引允许多个 NULL（custom 行不受影响）
CREATE UNIQUE INDEX "virtual_learner_profiles_presetKey_key" ON "virtual_learner_profiles"("presetKey");
