-- 拍板 2026-08-21：人为终止统一记 abandoned，failed 只承载系统/上游失败。
-- 存量改判：带 manualStop 标志的 failed 会话（管理员紧急停止 / 超时连锁停止）
-- 迁移为 abandoned；真·系统失败（无 manualStop）保持不变。
UPDATE "virtual_sessions"
SET "status" = 'abandoned',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'failed'
  AND (
    json_extract("stageResults", '$.teaching.manualStop') = 1
    OR json_extract("stageResults", '$.learning.manualStop') = 1
  );
