-- 平台级「结构化输出」默认（继承链顶端；skill_model_configs.paramOverrides.responseFormat 优先覆盖）
-- 上游支持 OpenAI 风格 response_format 时，json 媒介技能可由解码层强制 JSON（2026-10-02 渠道实测：
-- json_object/json_schema 均为真强制；对散文诱导仍输出合规 JSON）。
-- none = 关闭（默认，行为不变）；json_object = 对 output.media=json 的技能附 response_format。
ALTER TABLE "platform_api_configs" ADD COLUMN "defaultResponseFormat" TEXT DEFAULT 'none';
