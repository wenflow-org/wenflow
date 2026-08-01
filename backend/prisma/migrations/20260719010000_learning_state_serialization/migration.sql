-- Serialize canonical learning-state writes and clean up legacy Teaching closure rows.
ALTER TABLE "users" ADD COLUMN "learningStateRevision" INTEGER NOT NULL DEFAULT 0;

-- Legacy reset used completed without a wrapup. Keep those sessions out of reports and streaks.
UPDATE "teaching_sessions"
SET
  "status" = 'discarded',
  "openKey" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "status" = 'completed'
  AND "wrapup" IS NULL
  AND "teachingState" LIKE '%"resetAt"%';

-- Metrics written before their Teaching Session committed are not canonical and must be retried.
DELETE FROM "learning_metrics"
WHERE
  (
    "sourceKey" LIKE 'session-wrapup:%'
    OR (
      json_valid("metadata")
      AND json_extract("metadata", '$.source') = 'session-wrapup'
      AND json_extract("metadata", '$.sessionId') IS NOT NULL
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "teaching_sessions"
    WHERE
      "teaching_sessions"."id" = CASE
        WHEN "learning_metrics"."sourceKey" LIKE 'session-wrapup:%'
          THEN substr("learning_metrics"."sourceKey", length('session-wrapup:') + 1)
        ELSE json_extract("learning_metrics"."metadata", '$.sessionId')
      END
      AND "teaching_sessions"."status" = 'completed'
      AND "teaching_sessions"."wrapup" IS NOT NULL
);

DELETE FROM "learning_metrics"
WHERE
  "sourceKey" IS NULL
  AND json_valid("metadata")
  AND json_extract("metadata", '$.source') = 'session-wrapup'
  AND json_extract("metadata", '$.sessionId') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "learning_metrics" AS "canonicalMetric"
    WHERE "canonicalMetric"."sourceKey" = 'session-wrapup:' || json_extract("learning_metrics"."metadata", '$.sessionId')
  );

-- Keep one canonical legacy metric per completed session before assigning stable source keys.
DELETE FROM "learning_metrics"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY json_extract("metadata", '$.sessionId')
        ORDER BY "calculatedAt" DESC, "id" DESC
      ) AS "rowNumber"
    FROM "learning_metrics"
    WHERE
      "sourceKey" IS NULL
      AND json_valid("metadata")
      AND json_extract("metadata", '$.source') = 'session-wrapup'
      AND json_extract("metadata", '$.sessionId') IS NOT NULL
  ) AS "rankedMetrics"
  WHERE "rowNumber" > 1
);

UPDATE "learning_metrics"
SET "sourceKey" = 'session-wrapup:' || json_extract("metadata", '$.sessionId')
WHERE
  "sourceKey" IS NULL
  AND json_valid("metadata")
  AND json_extract("metadata", '$.source') = 'session-wrapup'
  AND json_extract("metadata", '$.sessionId') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "teaching_sessions"
    WHERE
      "teaching_sessions"."id" = json_extract("learning_metrics"."metadata", '$.sessionId')
      AND "teaching_sessions"."status" = 'completed'
      AND "teaching_sessions"."wrapup" IS NOT NULL
  );
