-- 平台级「默认思考」开关与强度（继承链顶端；skill_model_configs 行优先覆盖）
-- 2026-09 审计：平台默认 thinkingMode='default' 会让未单独配置的 skill 走上游预思考（烧 token/TTFT 长）。
-- 该两列让 admin 在「模型与接入」配置全局默认，路由 resolve 继承。
ALTER TABLE "platform_api_configs" ADD COLUMN "defaultThinkingMode" TEXT DEFAULT 'default';
ALTER TABLE "platform_api_configs" ADD COLUMN "defaultReasoningEffort" TEXT DEFAULT 'default';
