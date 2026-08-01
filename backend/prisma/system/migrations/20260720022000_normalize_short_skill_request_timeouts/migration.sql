UPDATE "skill_model_configs"
SET "requestTimeoutMs" = 10000
WHERE "requestTimeoutMs" IS NOT NULL
  AND "requestTimeoutMs" < 10000;
