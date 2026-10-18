-- 供应商级密钥（BYOK，2026-10-18）
-- 背景：llm-providers.json 是供应商/模型目录的唯一真源，但密钥严禁写进该文件
-- （文件校验规则只允许 apiKeyEnv 环境变量名）。管理台表单里填的密钥落本表（AES-GCM 密文）。
-- 运行时解析顺序：本表密文 → 进程环境变量（见 src/gateway/api-gateway/router.ts）。
CREATE TABLE "provider_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiKeyEnv" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "provider_secrets_providerId_key" ON "provider_secrets"("providerId");
