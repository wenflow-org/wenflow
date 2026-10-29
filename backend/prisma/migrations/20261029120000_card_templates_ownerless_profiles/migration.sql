-- 卡库不是账号，只是档案（2026-10-29 用户拍板）：
-- 模板卡（导入/自建）不再建虚拟账号，virtual_learner_profiles.userId 改为可空；
-- 只有派生实例与预置实例保留账号。SQLite 需重建表以放宽 NOT NULL（数据原样保留）。

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_virtual_learner_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "profile" TEXT NOT NULL,
    "learningGoal" TEXT NOT NULL,
    "knowledgeLevel" TEXT NOT NULL,
    "knownConcepts" TEXT,
    "struggleConcepts" TEXT,
    "simulationPrompt" TEXT,
    "simulationModel" TEXT,
    "simulationTemperature" REAL DEFAULT 0.8,
    "personalityTraits" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "presetKey" TEXT,
    "presetVersion" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "virtual_learner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_virtual_learner_profiles" (
    "id", "userId", "profile", "learningGoal", "knowledgeLevel",
    "knownConcepts", "struggleConcepts", "simulationPrompt", "simulationModel",
    "simulationTemperature", "personalityTraits", "tags", "notes",
    "source", "presetKey", "presetVersion", "createdAt", "updatedAt"
)
SELECT
    "id", "userId", "profile", "learningGoal", "knowledgeLevel",
    "knownConcepts", "struggleConcepts", "simulationPrompt", "simulationModel",
    "simulationTemperature", "personalityTraits", "tags", "notes",
    "source", "presetKey", "presetVersion", "createdAt", "updatedAt"
FROM "virtual_learner_profiles";

DROP TABLE "virtual_learner_profiles";
ALTER TABLE "new_virtual_learner_profiles" RENAME TO "virtual_learner_profiles";

CREATE UNIQUE INDEX "virtual_learner_profiles_userId_key" ON "virtual_learner_profiles"("userId");
CREATE INDEX "virtual_learner_profiles_userId_idx" ON "virtual_learner_profiles"("userId");
CREATE UNIQUE INDEX "virtual_learner_profiles_presetKey_key" ON "virtual_learner_profiles"("presetKey");

PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
