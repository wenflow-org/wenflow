-- quick-learn 单课单元补全：单课上下文（故事）与行为摩擦预算
-- 目标：单课单元从"无故事、纯合作"补全为"带故事 + 可配置摩擦"，对齐"单课=原子单元"抽象。
ALTER TABLE "virtual_quick_learn_runs" ADD COLUMN "story" TEXT;
ALTER TABLE "virtual_quick_learn_runs" ADD COLUMN "frictionBudget" TEXT NOT NULL DEFAULT 'none';
