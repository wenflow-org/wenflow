-- fieldId 唯一约束：全局唯一 → stage 内唯一
-- 背景：simulation 的 learnerReply 改名为 reply 后与 teaching 顶层 reply 跨 stage 同名；
-- 字段身份由 (stage, fieldId) 复合唯一标识。
-- 迁移前已核查 (stage, fieldId) 无重复行，且 fieldId 全局唯一索引可安全替换。

-- DropIndex
DROP INDEX "field_definitions_fieldId_key";

-- CreateIndex
CREATE UNIQUE INDEX "field_definitions_stage_fieldId_key" ON "field_definitions"("stage", "fieldId");
