-- CreateTable
CREATE TABLE "virtual_experiment_leases" (
    "sessionId" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "virtual_experiment_leases_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "virtual_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "virtual_experiment_commands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "resultJson" TEXT,
    "errorJson" TEXT,
    "triggeredBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "virtual_experiment_commands_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "virtual_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "virtual_experiment_leases_expiresAt_idx" ON "virtual_experiment_leases"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_experiment_commands_runId_commandId_key" ON "virtual_experiment_commands"("runId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_experiment_commands_runId_sequence_key" ON "virtual_experiment_commands"("runId", "sequence");

-- CreateIndex
CREATE INDEX "virtual_experiment_commands_sessionId_createdAt_idx" ON "virtual_experiment_commands"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "virtual_experiment_commands_runId_status_idx" ON "virtual_experiment_commands"("runId", "status");
