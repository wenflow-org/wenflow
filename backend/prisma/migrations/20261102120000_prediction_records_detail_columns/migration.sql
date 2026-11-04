-- #181（P0）：prediction_records 增列 toneDetail/depthDetail。
-- 背景：P1-13 把预测器自由描述原文（toneDetail/depthDetail）透传到教学层，
-- 但持久化路径只写枚举；从第 2 回合起、以及所有重试/续课路径，教学层从本表
-- 重建预测时原文丢失，只剩退化后的枚举（teaching-turn.yaml 依赖原文语义）。
-- 补两列，使 DB 复用路径与首回合同构。SQLite ALTER TABLE ADD COLUMN 允许可空列。
ALTER TABLE `prediction_records` ADD COLUMN `toneDetail` TEXT;
ALTER TABLE `prediction_records` ADD COLUMN `depthDetail` TEXT;
