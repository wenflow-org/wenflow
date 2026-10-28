-- #133（2026-10-22）：ktEstimate 的模型自报证据窗随 EMA 落库。
-- 此前 engine 组装 ktItems 时只传 conceptKey/kcId/mastery，evidence（≤200 字）被丢弃，
-- 事后检查器只能拿二手转述核对。可空列，SQLite 加列零回表。

ALTER TABLE `memory_traces` ADD COLUMN `ktEvidence` TEXT;
