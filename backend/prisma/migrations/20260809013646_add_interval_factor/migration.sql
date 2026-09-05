-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_memory_traces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "label" TEXT,
    "masteryScore" REAL NOT NULL DEFAULT 0.5,
    "stability" TEXT NOT NULL DEFAULT 'developing',
    "lastSeenAt" DATETIME,
    "extractionCount" INTEGER NOT NULL DEFAULT 0,
    "decayFactor" REAL NOT NULL DEFAULT 0.5,
    "intervalFactor" REAL NOT NULL DEFAULT 1,
    "lastRetention" REAL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_memory_traces" ("conceptKey", "createdAt", "decayFactor", "extractionCount", "id", "label", "lastRetention", "lastSeenAt", "masteryScore", "source", "stability", "updatedAt", "userId") SELECT "conceptKey", "createdAt", "decayFactor", "extractionCount", "id", "label", "lastRetention", "lastSeenAt", "masteryScore", "source", "stability", "updatedAt", "userId" FROM "memory_traces";
DROP TABLE "memory_traces";
ALTER TABLE "new_memory_traces" RENAME TO "memory_traces";
CREATE INDEX "memory_traces_userId_lastSeenAt_idx" ON "memory_traces"("userId", "lastSeenAt");
CREATE INDEX "memory_traces_userId_stability_idx" ON "memory_traces"("userId", "stability");
CREATE UNIQUE INDEX "memory_traces_userId_conceptKey_key" ON "memory_traces"("userId", "conceptKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
