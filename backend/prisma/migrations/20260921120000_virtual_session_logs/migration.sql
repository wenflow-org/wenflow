-- CreateTable: virtual_session_logs（虚拟会话日志子表，大 JSON 增量化）
-- 目的（性能审计 2026-09-21）：virtual_sessions.logs 单列存全部轨迹，每次追加
-- 「读全量→parse→push→整包 stringify 写回」，单会话累计冗余写达 MB 级
-- （实测曾有单行 31.9MB）。子表化后追加 = INSERT 行，O(新增) 代替 O(全量)。
--
-- 兼容策略：双读（侧表有行即权威，否则回退旧 logs 列）+ 首写惰性播种（列内容
-- 搬入侧表后置 null，立回收列空间）。不加一次性回填迁移：1.7GB 库上在线回填
-- 风险大，且冷会话永远不再写、读了也只是旧轨迹。
CREATE TABLE "virtual_session_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "phase" TEXT,
    "payload" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "virtual_session_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "virtual_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "virtual_session_logs_sessionId_id_idx" ON "virtual_session_logs"("sessionId", "id");
