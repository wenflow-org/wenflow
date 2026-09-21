-- CreateTable: teaching_session_messages（教学会话消息子表，大 JSON 增量化 #2）
-- 目的：teaching_sessions.messages 单列存整个消息数组，每回合「读全量→parse→
-- append→整包 stringify 写回」，写成本随会话长度线性恶化（O(n) 写放大）。
-- 子表化后每回合 = INSERT 新增行（O(新增)）。
--
-- 并发语义（与旧协议对齐，见 doc/SESSION_JSON_INCREMENTAL_DESIGN.md）：
-- 旧「整包覆写」是 last-write-wins 载体；子表化改为显式快照基线——
-- claimOperation 返回 messagesBaseCount（侧表行数），commitTurnState 校验
-- 侧表当前行数 === 基线后仅 INSERT slice(baseCount) 的新增消息，不一致按
-- TEACHING_MESSAGE_BASE_STALE 冲突处理。伴学消息走同款行追加 + revision CAS。
--
-- 兼容：双读（侧表有行即权威，否则回退解析 messages 列）；首次写惰性播种
-- （列内容搬入侧表后置 null，原地回收）。
CREATE TABLE "teaching_session_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_session_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "teaching_session_messages_sessionId_id_idx" ON "teaching_session_messages"("sessionId", "id");
