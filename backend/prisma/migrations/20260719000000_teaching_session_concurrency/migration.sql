-- Add stable identities for session metrics and open teaching sessions.
ALTER TABLE "learning_metrics" ADD COLUMN "sourceKey" TEXT;

ALTER TABLE "teaching_sessions" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "teaching_sessions" ADD COLUMN "openKey" TEXT;
ALTER TABLE "teaching_sessions" ADD COLUMN "operationId" TEXT;
ALTER TABLE "teaching_sessions" ADD COLUMN "operationKind" TEXT;
ALTER TABLE "teaching_sessions" ADD COLUMN "operationLeaseExpiresAt" DATETIME;

-- Keep the most recently updated recoverable session open and retain older rows as audit history.
UPDATE "teaching_sessions"
SET
  "status" = 'superseded',
  "endTime" = COALESCE("endTime", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "userId", "taskId"
        ORDER BY "updatedAt" DESC, "id" DESC
      ) AS "rowNumber"
    FROM "teaching_sessions"
    WHERE "status" IN ('active', 'paused', 'timeout')
  ) AS "rankedSessions"
  WHERE "rowNumber" > 1
);

UPDATE "teaching_sessions"
SET "openKey" = "userId" || ':' || "taskId"
WHERE "status" IN ('active', 'paused', 'timeout');

CREATE UNIQUE INDEX "learning_metrics_sourceKey_key" ON "learning_metrics"("sourceKey");
CREATE UNIQUE INDEX "teaching_sessions_openKey_key" ON "teaching_sessions"("openKey");
CREATE INDEX "teaching_sessions_status_updatedAt_idx" ON "teaching_sessions"("status", "updatedAt");
CREATE INDEX "teaching_sessions_operationLeaseExpiresAt_idx" ON "teaching_sessions"("operationLeaseExpiresAt");
