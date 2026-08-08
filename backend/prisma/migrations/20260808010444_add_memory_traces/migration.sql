-- CreateTable
CREATE TABLE "memory_traces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "label" TEXT,
    "masteryScore" REAL NOT NULL DEFAULT 0.5,
    "stability" TEXT NOT NULL DEFAULT 'developing',
    "lastSeenAt" DATETIME,
    "extractionCount" INTEGER NOT NULL DEFAULT 0,
    "decayFactor" REAL NOT NULL DEFAULT 0.5,
    "lastRetention" REAL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "memory_traces_userId_lastSeenAt_idx" ON "memory_traces"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "memory_traces_userId_stability_idx" ON "memory_traces"("userId", "stability");

-- CreateIndex
CREATE UNIQUE INDEX "memory_traces_userId_conceptKey_key" ON "memory_traces"("userId", "conceptKey");
