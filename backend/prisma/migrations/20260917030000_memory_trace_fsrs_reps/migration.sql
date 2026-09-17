-- AddColumn: memory_traces.fsrsReps（FSRS-6 累计复习次数）
-- 目的（审计 §5.2 P2 尾巴）：此前 `reps` 直接用 `extractionCount` 顶替，而两者的口径**不同**——
-- `extractionCount` 是"提取/写入次数"（含 `recordSessionOutcome` 这类非复习写入），
-- `reps` 是"FSRS 调度过的复习次数"。于是 reps 会被非复习写入推高并持续累加（实测：reps 不影响当前调度结果，
-- 但序列本身是错的，E4 参数拟合/回看会读到假数）。
--
-- 本次：新增真列；写入侧落 `result.card.reps`；读取侧优先用真列，历史行回退 extractionCount（兼容）。
-- 与 fsrsStability / fsrsDifficulty / fsrsLapses 一起构成完整 FSRS 状态。
ALTER TABLE "memory_traces" ADD COLUMN "fsrsReps" INTEGER;