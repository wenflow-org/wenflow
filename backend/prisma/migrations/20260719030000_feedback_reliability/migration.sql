-- Make session feedback idempotent and operable from the admin console.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Keep the latest feedback when legacy retries created duplicates.
DELETE FROM "content_feedback"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "userId", "sessionId"
        ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
      ) AS "rowNumber"
    FROM "content_feedback"
  ) AS "rankedFeedback"
  WHERE "rowNumber" > 1
);

CREATE TABLE "new_content_feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedbackKey" TEXT,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "subtaskId" TEXT,
    "agentId" TEXT NOT NULL DEFAULT 'teaching-agent',
    "rating" INTEGER NOT NULL,
    "helpfulness" INTEGER,
    "clarity" INTEGER,
    "difficulty" INTEGER,
    "difficultyFit" TEXT,
    "comment" TEXT,
    "suggestions" TEXT,
    "confusionPoint" TEXT,
    "reasonCodes" TEXT,
    "strategy" TEXT,
    "uiType" TEXT,
    "roundNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assigneeAdminId" TEXT,
    "internalNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "content_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_content_feedback" (
    "id",
    "feedbackKey",
    "userId",
    "sessionId",
    "subtaskId",
    "agentId",
    "rating",
    "helpfulness",
    "clarity",
    "difficulty",
    "comment",
    "suggestions",
    "confusionPoint",
    "strategy",
    "uiType",
    "roundNumber",
    "status",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "userId" || ':' || "sessionId",
    "userId",
    "sessionId",
    "subtaskId",
    CASE WHEN "agentId" = 'ai-teaching-agent' THEN 'teaching-agent' ELSE "agentId" END,
    "rating",
    "helpfulness",
    "clarity",
    "difficulty",
    "comment",
    "suggestions",
    "confusionPoint",
    "strategy",
    "uiType",
    "roundNumber",
    'new',
    "createdAt",
    "updatedAt"
FROM "content_feedback";

DROP TABLE "content_feedback";
ALTER TABLE "new_content_feedback" RENAME TO "content_feedback";

CREATE UNIQUE INDEX "content_feedback_feedbackKey_key" ON "content_feedback"("feedbackKey");
CREATE INDEX "content_feedback_userId_idx" ON "content_feedback"("userId");
CREATE INDEX "content_feedback_sessionId_idx" ON "content_feedback"("sessionId");
CREATE INDEX "content_feedback_agentId_idx" ON "content_feedback"("agentId");
CREATE INDEX "content_feedback_status_createdAt_idx" ON "content_feedback"("status", "createdAt");
CREATE INDEX "content_feedback_rating_createdAt_idx" ON "content_feedback"("rating", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Failed conservative evaluations are display fallbacks, not canonical learner metrics.
DELETE FROM "learning_metrics"
WHERE EXISTS (
  SELECT 1
  FROM "teaching_sessions"
  WHERE
    "teaching_sessions"."id" = CASE
      WHEN "learning_metrics"."sourceKey" LIKE 'session-wrapup:%'
        THEN substr("learning_metrics"."sourceKey", length('session-wrapup:') + 1)
      WHEN json_valid("learning_metrics"."metadata")
        THEN json_extract("learning_metrics"."metadata", '$.sessionId')
      ELSE NULL
    END
    AND json_valid("teaching_sessions"."wrapup")
    AND COALESCE(
      json_extract("teaching_sessions"."wrapup", '$.evaluationSource'),
      json_extract("teaching_sessions"."wrapup", '$.sources.evaluation')
    ) = 'failed'
);
