-- 审查加固批（2026-08-21 代码审查行动项）：
-- 1) teaching_sessions.learningPathId 索引：admin session-console 按路径查会话、
--    虚拟学习者级联删除按路径圈范围，行数上量后退化为全表扫描
CREATE INDEX "teaching_sessions_learningPathId_idx" ON "teaching_sessions"("learningPathId");

-- 2) goal_conversations.revision 乐观锁列：messages/collectedData 为整包 JSON 读改写，
--    同一会话并发提交（双击/重试）时以条件更新防止互相覆盖丢消息
ALTER TABLE "goal_conversations" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
