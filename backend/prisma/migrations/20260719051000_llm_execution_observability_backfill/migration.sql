UPDATE "agent_call_logs"
SET "executionLayer" = 'api-gateway'
WHERE "executionLayer" IS NULL
  AND (
    "agentId" = 'api-gateway'
    OR "metadata" LIKE '%"layer":"api-gateway-v2"%'
    OR "metadata" LIKE '%"executionLayer":"api-gateway"%'
  );
