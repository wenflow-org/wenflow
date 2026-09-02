-- FSRS-6 调度升级：memory_traces 增加稳定性/难度数值列
-- 目的：复习调度从 ACT-R/ SM-2（Cepeda 15% 规则 + intervalFactor×2）升级为 FSRS-6（DSR 三变量模型）
--       fsrsStability 承载 FSRS 稳定性（天），fsrsDifficulty 承载 FSRS 难度（1-10）
--       null 表示尚未初始化 FSRS state（旧数据），走 legacy ACT-R 兜底
ALTER TABLE "memory_traces" ADD COLUMN "fsrsStability" REAL;
ALTER TABLE "memory_traces" ADD COLUMN "fsrsDifficulty" REAL;