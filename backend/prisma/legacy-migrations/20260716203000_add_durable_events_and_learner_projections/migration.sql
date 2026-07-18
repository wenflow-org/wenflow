CREATE TABLE "domain_event_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "metadata" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockOwner" TEXT,
    "processedAt" DATETIME,
    "lastError" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "domain_event_inbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "consumerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "learner_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pathId" TEXT,
    "milestoneId" TEXT,
    "taskId" TEXT,
    "sessionId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "learner_projections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectionKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "pathId" TEXT,
    "milestoneId" TEXT,
    "taskId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" TEXT NOT NULL,
    "lastEventId" TEXT,
    "lastEventAt" DATETIME,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "domain_event_outbox_status_availableAt_idx" ON "domain_event_outbox"("status", "availableAt");
CREATE INDEX "domain_event_outbox_status_lockedAt_idx" ON "domain_event_outbox"("status", "lockedAt");
CREATE INDEX "domain_event_outbox_aggregateType_aggregateId_occurredAt_idx" ON "domain_event_outbox"("aggregateType", "aggregateId", "occurredAt");
CREATE INDEX "domain_event_outbox_userId_occurredAt_idx" ON "domain_event_outbox"("userId", "occurredAt");
CREATE UNIQUE INDEX "domain_event_inbox_consumerId_eventId_key" ON "domain_event_inbox"("consumerId", "eventId");
CREATE INDEX "domain_event_inbox_eventId_idx" ON "domain_event_inbox"("eventId");
CREATE UNIQUE INDEX "learner_evidence_eventId_evidenceKey_key" ON "learner_evidence"("eventId", "evidenceKey");
CREATE INDEX "learner_evidence_userId_occurredAt_idx" ON "learner_evidence"("userId", "occurredAt");
CREATE INDEX "learner_evidence_pathId_occurredAt_idx" ON "learner_evidence"("pathId", "occurredAt");
CREATE INDEX "learner_evidence_sessionId_idx" ON "learner_evidence"("sessionId");
CREATE INDEX "learner_evidence_taskId_idx" ON "learner_evidence"("taskId");
CREATE UNIQUE INDEX "learner_projections_projectionKey_key" ON "learner_projections"("projectionKey");
CREATE INDEX "learner_projections_userId_scope_idx" ON "learner_projections"("userId", "scope");
CREATE INDEX "learner_projections_userId_pathId_scope_idx" ON "learner_projections"("userId", "pathId", "scope");
CREATE INDEX "learner_projections_lastEventAt_idx" ON "learner_projections"("lastEventAt");
