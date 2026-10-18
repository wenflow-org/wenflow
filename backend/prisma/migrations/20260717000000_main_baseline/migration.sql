-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "current" INTEGER,
    "target" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" DATETIME,
    "earnedAt" DATETIME,
    CONSTRAINT "achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_call_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceEntry" TEXT NOT NULL DEFAULT 'platform',
    "traceId" TEXT,
    "callerAgent" TEXT,
    "userRole" TEXT NOT NULL DEFAULT 'user',
    "input" TEXT,
    "output" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER,
    "error" TEXT,
    "errorCode" TEXT,
    "calledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "executionLayer" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "parentExecutionId" TEXT,
    "rootExecutionId" TEXT,
    "promptCallId" TEXT,
    "providerId" TEXT,
    "providerType" TEXT,
    "routeSource" TEXT,
    "model" TEXT,
    "statusCode" INTEGER,
    "attemptCount" INTEGER,
    "maxAttempts" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "finishReason" TEXT,
    "completionId" TEXT,
    "errorCategory" TEXT,
    "sessionId" TEXT
);

-- CreateTable
CREATE TABLE "prompt_call_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "systemPromptVersion" INTEGER,
    "systemPromptVariant" TEXT,
    "systemPromptHash" TEXT NOT NULL,
    "userPayload" TEXT NOT NULL,
    "rawModelOutput" TEXT,
    "extractedJson" TEXT,
    "normalizedOutput" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "promptDrift" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "tokenUsage" TEXT,
    "routingContextHash" TEXT,
    "pathId" TEXT,
    "userId" TEXT,
    "conversationId" TEXT,
    "pipelineRunId" TEXT,
    "pipelineStepIndex" INTEGER,
    "traceId" TEXT,
    "parentExecutionId" TEXT,
    "promptAttemptCount" INTEGER NOT NULL DEFAULT 1,
    "llmRequestCount" INTEGER NOT NULL DEFAULT 0,
    "finalLlmRequestId" TEXT,
    "failureStage" TEXT,
    "attemptTrace" TEXT,
    "providerId" TEXT,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "llm_execution_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "llmRequestId" TEXT NOT NULL,
    "parentExecutionId" TEXT,
    "promptCallId" TEXT,
    "rootExecutionId" TEXT,
    "traceId" TEXT,
    "userId" TEXT,
    "sourceEntry" TEXT NOT NULL DEFAULT 'platform',
    "promptAttemptNo" INTEGER NOT NULL DEFAULT 1,
    "transportAttemptNo" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "providerId" TEXT,
    "providerType" TEXT,
    "routeSource" TEXT,
    "requestedModel" TEXT,
    "resolvedModel" TEXT,
    "responseModel" TEXT,
    "endpointHost" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "retryable" BOOLEAN,
    "willRetry" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "errorCategory" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "backoffMs" INTEGER,
    "retryAfterMs" INTEGER,
    "configuredTimeoutMs" INTEGER,
    "effectiveTimeoutMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "finishReason" TEXT,
    "completionId" TEXT,
    "providerRequestId" TEXT,
    "messageCount" INTEGER,
    "requestBytes" INTEGER,
    "responseBytes" INTEGER,
    "ttftMs" INTEGER,
    "promptCacheHitTokens" INTEGER,
    "promptCacheMissTokens" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "content_feedback" (
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

-- CreateTable
CREATE TABLE "goal_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "stage" TEXT NOT NULL DEFAULT 'initial',
    "description" TEXT,
    "messages" TEXT NOT NULL,
    "collectedData" TEXT,
    "completedAt" DATETIME,
    "learningPathId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learning_goals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "pathId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "plannedMinutesPerDay" INTEGER,
    "cognitiveBandwidth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal_scheduling_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT,
    "date" TEXT NOT NULL,
    "budgetMinutes" INTEGER NOT NULL DEFAULT 30,
    "consumedMinutes" REAL NOT NULL DEFAULT 0,
    "plannedTasks" TEXT,
    "loadAvg" REAL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "learning_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKey" TEXT,
    "userId" TEXT NOT NULL,
    "pathId" TEXT,
    "taskId" TEXT,
    "metricType" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "lss" REAL DEFAULT 0,
    "ktl" REAL DEFAULT 0,
    "lf" REAL DEFAULT 0,
    "lsb" REAL DEFAULT 0,
    "depth_score" REAL DEFAULT 0,
    "metadata" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ktlCurrent" REAL DEFAULT 0,
    "lfCurrent" REAL DEFAULT 0,
    "lsbCurrent" REAL DEFAULT 0,
    "lssCurrent" REAL DEFAULT 0,
    "lssHistory" TEXT,
    "dki" REAL DEFAULT 0,
    "mki" REAL DEFAULT 0,
    "ski" REAL DEFAULT 0,
    CONSTRAINT "learning_metrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learning_paths" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "difficulty" TEXT NOT NULL DEFAULT 'beginner',
    "estimatedHours" REAL,
    "totalMilestones" INTEGER NOT NULL DEFAULT 0,
    "completedMilestones" INTEGER NOT NULL DEFAULT 0,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiPromptTemplate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deadline" DATETIME,
    "deadlineText" TEXT,
    "replanMode" TEXT,
    "replanReason" TEXT,
    "replanTriggerSource" TEXT,
    "sourcePathId" TEXT,
    "activeGenerationRunId" TEXT,
    CONSTRAINT "learning_paths_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "learning_paths_activeGenerationRunId_fkey" FOREIGN KEY ("activeGenerationRunId") REFERENCES "path_generation_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "path_generation_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningPathId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "retryType" TEXT,
    "retryAllowed" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "inputSnapshot" TEXT,
    "rollbackSnapshot" TEXT,
    "heartbeatAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "leaseOwner" TEXT,
    "claimedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "path_generation_runs_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "learning_paths" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "path_generation_stage_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "stageNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "path_generation_stage_items_runId_fkey" FOREIGN KEY ("runId") REFERENCES "path_generation_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningPathId" TEXT NOT NULL,
    "stageNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "goal" TEXT,
    "estimatedHours" REAL,
    "status" TEXT NOT NULL DEFAULT 'locked',
    "unlockedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "coreConceptId" TEXT,
    "coreConceptName" TEXT,
    "conceptId" TEXT,
    CONSTRAINT "milestones_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "learning_paths" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subtasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "milestoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'practice',
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 30,
    "acceptanceCriteria" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "completedAt" DATETIME,
    "rating" INTEGER,
    "feedback" TEXT,
    "cognitiveLoad" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "usersId" TEXT,
    "annotationConfidence" REAL,
    "cognitiveLevel" TEXT,
    "icapLevel" TEXT,
    "coreConcept" TEXT,
    "displayLabel" TEXT,
    "knowledgeType" TEXT,
    "learningObjectives" TEXT,
    "transferable" BOOLEAN DEFAULT false,
    "linkedConceptId" TEXT,
    "linkedConceptName" TEXT,
    "conceptId" TEXT,
    CONSTRAINT "subtasks_usersId_fkey" FOREIGN KEY ("usersId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "subtasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teaching_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "learningPathId" TEXT,
    "milestoneId" TEXT,
    "subject" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'practice',
    "mode" TEXT NOT NULL DEFAULT 'tutor',
    "status" TEXT NOT NULL DEFAULT 'active',
    "messages" TEXT,
    "knowledgeState" TEXT,
    "teachingState" TEXT,
    "wrapup" TEXT,
    "advisory" TEXT,
    "startTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" DATETIME,
    "duration" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "openKey" TEXT,
    "operationId" TEXT,
    "operationKind" TEXT,
    "operationLeaseExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teaching_session_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_session_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "session_finalization_operations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "retryable" BOOLEAN,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "session_finalization_operations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "domain_event_inbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "consumerId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "misconception_ledger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "conceptId" TEXT,
    "hypothesisHash" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "canonicalLabel" TEXT,
    "confidence" INTEGER NOT NULL,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'suspected',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSessionId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "prediction_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pathId" TEXT,
    "taskId" TEXT,
    "milestoneId" TEXT,
    "sessionId" TEXT,
    "stallRisk" REAL NOT NULL,
    "predictedTone" TEXT NOT NULL,
    "suggestedDepth" TEXT NOT NULL,
    "focusConcepts" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "outcome" TEXT,
    "outcomeAt" DATETIME,
    "summaryEcho" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "memory_traces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "conceptId" TEXT,
    "label" TEXT,
    "masteryScore" REAL NOT NULL DEFAULT 0.5,
    "stability" TEXT NOT NULL DEFAULT 'developing',
    "lastSeenAt" DATETIME,
    "extractionCount" INTEGER NOT NULL DEFAULT 0,
    "decayFactor" REAL NOT NULL DEFAULT 0.5,
    "intervalFactor" REAL NOT NULL DEFAULT 1,
    "source" TEXT,
    "dueAt" DATETIME,
    "fsrsStability" REAL,
    "fsrsDifficulty" REAL,
    "fsrsLapses" INTEGER,
    "fsrsReps" INTEGER,
    "ktMasteryEma" REAL,
    "pathId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "concepts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "canonicalLabel" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'kc',
    "taxonomy" TEXT,
    "granularity" TEXT,
    "originPathId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "concept_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aliasNorm" TEXT NOT NULL,
    "aliasRaw" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "concept_aliases_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "concept_edges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromConceptId" TEXT NOT NULL,
    "toConceptId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'path',
    "pathId" TEXT,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "user_agent_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT NOT NULL,
    "codeRepositoryId" TEXT,
    "model" TEXT,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "systemPrompt" TEXT,
    "customCode" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "stats" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_agent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_agent_model_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "model" TEXT,
    "endpoint" TEXT,
    "apiKey" TEXT,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_agent_model_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_api_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT,
    "apiKey" TEXT,
    "chatModel" TEXT,
    "reasoningModel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_api_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_mcp_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "providers" TEXT NOT NULL,
    "tools" TEXT NOT NULL,
    "routingStrategy" TEXT NOT NULL DEFAULT 'priority',
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "healthCheck" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_mcp_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_skill_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT NOT NULL,
    "codeRepositoryId" TEXT,
    "parameters" TEXT,
    "customCode" TEXT,
    "endpoint" TEXT,
    "stats" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_skill_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "projection_access_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'dashboard',
    "scopeDefinition" TEXT,
    "purpose" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME,
    "lastUsedByAdminId" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "projection_access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "currentLevel" TEXT NOT NULL DEFAULT 'beginner',
    "xp" INTEGER NOT NULL DEFAULT 0,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isVirtualLearner" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "streakLastDate" DATETIME,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "dashboardGuidanceSnapshot" TEXT,
    "learningStateRevision" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "virtual_learner_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "virtual_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "virtualProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "currentStage" TEXT NOT NULL DEFAULT 'goal',
    "goalConversationId" TEXT,
    "learningPathId" TEXT,
    "currentTaskId" TEXT,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "stageResults" TEXT,
    "logs" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "virtual_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "virtual_sessions_virtualProfileId_fkey" FOREIGN KEY ("virtualProfileId") REFERENCES "virtual_learner_profiles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "virtual_session_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "phase" TEXT,
    "payload" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "virtual_session_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "virtual_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "virtual_quick_learn_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fixtureOfPathId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'fast_forward',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "maxTurns" INTEGER NOT NULL DEFAULT 25,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "teachingSessionId" TEXT,
    "story" TEXT,
    "frictionBudget" TEXT NOT NULL DEFAULT 'none',
    "progress" TEXT,
    "transcript" TEXT,
    "report" TEXT,
    "error" TEXT,
    "abortRequestedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'system',
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT,
    "adminName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "requestJson" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "previousTokenHash" TEXT,
    "familyId" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "rotatedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "batch_experiments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdBy" TEXT NOT NULL,
    "learnersConfig" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "batch_experiment_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "profileId" TEXT,
    "sessionId" TEXT,
    "learnerName" TEXT NOT NULL,
    "frictionBudget" TEXT NOT NULL DEFAULT 'normal',
    "phase" TEXT NOT NULL DEFAULT 'setup',
    "status" TEXT NOT NULL DEFAULT 'active',
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER,
    "currentTask" TEXT,
    "stallCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "advanceCalled" BOOLEAN NOT NULL DEFAULT false,
    "learningStarted" BOOLEAN NOT NULL DEFAULT false,
    "checkpoints" TEXT,
    "decaySims" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "batch_experiment_runs_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "batch_experiments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "virtual_batch_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'create-learners',
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "totalStories" INTEGER NOT NULL DEFAULT 0,
    "storiesDone" INTEGER NOT NULL DEFAULT 0,
    "personaLeft" INTEGER NOT NULL DEFAULT 0,
    "queue" TEXT,
    "failed" TEXT,
    "error" TEXT,
    "cohort" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "backend_boot_registry" (
    "instance_id" TEXT NOT NULL PRIMARY KEY,
    "pid" INTEGER NOT NULL,
    "boot_at" INTEGER NOT NULL,
    "hb_at" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "achievements_userId_idx" ON "achievements"("userId");

-- CreateIndex
CREATE INDEX "achievements_type_completed_idx" ON "achievements"("type", "completed");

-- CreateIndex
CREATE INDEX "agent_call_logs_agentId_calledAt_idx" ON "agent_call_logs"("agentId", "calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_idx" ON "agent_call_logs"("calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_success_idx" ON "agent_call_logs"("success");

-- CreateIndex
CREATE INDEX "agent_call_logs_traceId_idx" ON "agent_call_logs"("traceId");

-- CreateIndex
CREATE INDEX "agent_call_logs_sourceEntry_idx" ON "agent_call_logs"("sourceEntry");

-- CreateIndex
CREATE INDEX "agent_call_logs_userId_idx" ON "agent_call_logs"("userId");

-- CreateIndex
CREATE INDEX "agent_call_logs_agentId_idx" ON "agent_call_logs"("agentId");

-- CreateIndex
CREATE INDEX "agent_call_logs_sessionId_calledAt_idx" ON "agent_call_logs"("sessionId", "calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_parentExecutionId_calledAt_idx" ON "agent_call_logs"("parentExecutionId", "calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_promptCallId_calledAt_idx" ON "agent_call_logs"("promptCallId", "calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_executionLayer_calledAt_idx" ON "agent_call_logs"("executionLayer", "calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_success_idx" ON "agent_call_logs"("calledAt", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_executionLayer_success_idx" ON "agent_call_logs"("executionLayer", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_sourceEntry_success_idx" ON "agent_call_logs"("sourceEntry", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_providerId_calledAt_idx" ON "agent_call_logs"("providerId", "calledAt");

-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_agentId_sourceEntry_success_idx" ON "agent_call_logs"("calledAt", "agentId", "sourceEntry", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_calledAt_executionLayer_tokensUsed_success_idx" ON "agent_call_logs"("calledAt", "executionLayer", "tokensUsed", "success");

-- CreateIndex
CREATE INDEX "agent_call_logs_userId_success_executionLayer_idx" ON "agent_call_logs"("userId", "success", "executionLayer");

-- CreateIndex
CREATE INDEX "agent_call_logs_agentId_success_durationMs_calledAt_idx" ON "agent_call_logs"("agentId", "success", "durationMs", "calledAt");

-- CreateIndex
CREATE INDEX "prompt_call_logs_agentId_createdAt_idx" ON "prompt_call_logs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "prompt_call_logs_createdAt_idx" ON "prompt_call_logs"("createdAt");

-- CreateIndex
CREATE INDEX "prompt_call_logs_agentId_createdAt_success_durationMs_idx" ON "prompt_call_logs"("agentId", "createdAt", "success", "durationMs");

-- CreateIndex
CREATE INDEX "prompt_call_logs_pipelineRunId_idx" ON "prompt_call_logs"("pipelineRunId");

-- CreateIndex
CREATE INDEX "prompt_call_logs_pathId_idx" ON "prompt_call_logs"("pathId");

-- CreateIndex
CREATE INDEX "prompt_call_logs_userId_idx" ON "prompt_call_logs"("userId");

-- CreateIndex
CREATE INDEX "prompt_call_logs_traceId_idx" ON "prompt_call_logs"("traceId");

-- CreateIndex
CREATE INDEX "prompt_call_logs_parentExecutionId_idx" ON "prompt_call_logs"("parentExecutionId");

-- CreateIndex
CREATE INDEX "prompt_call_logs_finalLlmRequestId_idx" ON "prompt_call_logs"("finalLlmRequestId");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_startedAt_id_idx" ON "llm_execution_attempts"("startedAt", "id");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_traceId_startedAt_idx" ON "llm_execution_attempts"("traceId", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_parentExecutionId_startedAt_idx" ON "llm_execution_attempts"("parentExecutionId", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_promptCallId_promptAttemptNo_transportAttemptNo_idx" ON "llm_execution_attempts"("promptCallId", "promptAttemptNo", "transportAttemptNo");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_providerId_resolvedModel_startedAt_idx" ON "llm_execution_attempts"("providerId", "resolvedModel", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_rootExecutionId_startedAt_idx" ON "llm_execution_attempts"("rootExecutionId", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_userId_startedAt_idx" ON "llm_execution_attempts"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_errorCategory_startedAt_idx" ON "llm_execution_attempts"("errorCategory", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_success_errorCategory_startedAt_idx" ON "llm_execution_attempts"("success", "errorCategory", "startedAt");

-- CreateIndex
CREATE INDEX "llm_execution_attempts_userId_startedAt_success_idx" ON "llm_execution_attempts"("userId", "startedAt", "success");

-- CreateIndex
CREATE UNIQUE INDEX "llm_execution_attempts_llmRequestId_transportAttemptNo_key" ON "llm_execution_attempts"("llmRequestId", "transportAttemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "content_feedback_feedbackKey_key" ON "content_feedback"("feedbackKey");

-- CreateIndex
CREATE INDEX "content_feedback_userId_idx" ON "content_feedback"("userId");

-- CreateIndex
CREATE INDEX "content_feedback_sessionId_idx" ON "content_feedback"("sessionId");

-- CreateIndex
CREATE INDEX "content_feedback_agentId_idx" ON "content_feedback"("agentId");

-- CreateIndex
CREATE INDEX "content_feedback_status_createdAt_idx" ON "content_feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "content_feedback_rating_createdAt_idx" ON "content_feedback"("rating", "createdAt");

-- CreateIndex
CREATE INDEX "goal_conversations_userId_status_idx" ON "goal_conversations"("userId", "status");

-- CreateIndex
CREATE INDEX "goal_conversations_status_updatedAt_idx" ON "goal_conversations"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "goal_conversations_learningPathId_idx" ON "goal_conversations"("learningPathId");

-- CreateIndex
CREATE INDEX "learning_goals_userId_status_idx" ON "learning_goals"("userId", "status");

-- CreateIndex
CREATE INDEX "goal_scheduling_ledger_userId_date_idx" ON "goal_scheduling_ledger"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "goal_scheduling_ledger_userId_goalId_date_key" ON "goal_scheduling_ledger"("userId", "goalId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "learning_metrics_sourceKey_key" ON "learning_metrics"("sourceKey");

-- CreateIndex
CREATE INDEX "learning_metrics_userId_calculatedAt_idx" ON "learning_metrics"("userId", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "learning_paths_activeGenerationRunId_key" ON "learning_paths"("activeGenerationRunId");

-- CreateIndex
CREATE INDEX "learning_paths_userId_idx" ON "learning_paths"("userId");

-- CreateIndex
CREATE INDEX "learning_paths_status_idx" ON "learning_paths"("status");

-- CreateIndex
CREATE INDEX "learning_paths_userId_status_idx" ON "learning_paths"("userId", "status");

-- CreateIndex
CREATE INDEX "path_generation_runs_learningPathId_createdAt_idx" ON "path_generation_runs"("learningPathId", "createdAt");

-- CreateIndex
CREATE INDEX "path_generation_runs_status_leaseExpiresAt_idx" ON "path_generation_runs"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "path_generation_runs_phase_status_idx" ON "path_generation_runs"("phase", "status");

-- CreateIndex
CREATE INDEX "path_generation_stage_items_runId_status_idx" ON "path_generation_stage_items"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "path_generation_stage_items_runId_stageNumber_key" ON "path_generation_stage_items"("runId", "stageNumber");

-- CreateIndex
CREATE INDEX "milestones_learningPathId_idx" ON "milestones"("learningPathId");

-- CreateIndex
CREATE INDEX "milestones_status_idx" ON "milestones"("status");

-- CreateIndex
CREATE INDEX "milestones_conceptId_idx" ON "milestones"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_learningPathId_stageNumber_key" ON "milestones"("learningPathId", "stageNumber");

-- CreateIndex
CREATE INDEX "subtasks_status_idx" ON "subtasks"("status");

-- CreateIndex
CREATE INDEX "subtasks_userId_idx" ON "subtasks"("userId");

-- CreateIndex
CREATE INDEX "subtasks_milestoneId_idx" ON "subtasks"("milestoneId");

-- CreateIndex
CREATE INDEX "subtasks_knowledgeType_idx" ON "subtasks"("knowledgeType");

-- CreateIndex
CREATE INDEX "subtasks_cognitiveLevel_idx" ON "subtasks"("cognitiveLevel");

-- CreateIndex
CREATE INDEX "subtasks_icapLevel_idx" ON "subtasks"("icapLevel");

-- CreateIndex
CREATE INDEX "subtasks_status_completedAt_idx" ON "subtasks"("status", "completedAt");

-- CreateIndex
CREATE INDEX "subtasks_conceptId_idx" ON "subtasks"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_sessions_openKey_key" ON "teaching_sessions"("openKey");

-- CreateIndex
CREATE INDEX "teaching_sessions_userId_taskId_status_idx" ON "teaching_sessions"("userId", "taskId", "status");

-- CreateIndex
CREATE INDEX "teaching_sessions_status_updatedAt_idx" ON "teaching_sessions"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "teaching_sessions_operationLeaseExpiresAt_idx" ON "teaching_sessions"("operationLeaseExpiresAt");

-- CreateIndex
CREATE INDEX "teaching_sessions_status_idx" ON "teaching_sessions"("status");

-- CreateIndex
CREATE INDEX "teaching_sessions_taskId_idx" ON "teaching_sessions"("taskId");

-- CreateIndex
CREATE INDEX "teaching_sessions_userId_idx" ON "teaching_sessions"("userId");

-- CreateIndex
CREATE INDEX "teaching_sessions_userId_createdAt_idx" ON "teaching_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "teaching_sessions_startTime_idx" ON "teaching_sessions"("startTime");

-- CreateIndex
CREATE INDEX "teaching_sessions_learningPathId_idx" ON "teaching_sessions"("learningPathId");

-- CreateIndex
CREATE INDEX "teaching_session_messages_sessionId_id_idx" ON "teaching_session_messages"("sessionId", "id");

-- CreateIndex
CREATE INDEX "session_finalization_operations_status_leaseExpiresAt_idx" ON "session_finalization_operations"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "session_finalization_operations_sessionId_action_createdAt_idx" ON "session_finalization_operations"("sessionId", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "session_finalization_operations_sessionId_idempotencyKey_key" ON "session_finalization_operations"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "domain_event_outbox_status_availableAt_idx" ON "domain_event_outbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "domain_event_outbox_status_lockedAt_idx" ON "domain_event_outbox"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "domain_event_outbox_aggregateType_aggregateId_occurredAt_idx" ON "domain_event_outbox"("aggregateType", "aggregateId", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_event_outbox_userId_occurredAt_idx" ON "domain_event_outbox"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_event_inbox_eventId_idx" ON "domain_event_inbox"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "domain_event_inbox_consumerId_eventId_key" ON "domain_event_inbox"("consumerId", "eventId");

-- CreateIndex
CREATE INDEX "learner_evidence_userId_occurredAt_idx" ON "learner_evidence"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "learner_evidence_pathId_occurredAt_idx" ON "learner_evidence"("pathId", "occurredAt");

-- CreateIndex
CREATE INDEX "learner_evidence_sessionId_idx" ON "learner_evidence"("sessionId");

-- CreateIndex
CREATE INDEX "learner_evidence_taskId_idx" ON "learner_evidence"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "learner_evidence_eventId_evidenceKey_key" ON "learner_evidence"("eventId", "evidenceKey");

-- CreateIndex
CREATE INDEX "misconception_ledger_userId_status_idx" ON "misconception_ledger"("userId", "status");

-- CreateIndex
CREATE INDEX "misconception_ledger_userId_lastSeenAt_idx" ON "misconception_ledger"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "misconception_ledger_userId_conceptId_idx" ON "misconception_ledger"("userId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "misconception_ledger_userId_conceptKey_hypothesisHash_key" ON "misconception_ledger"("userId", "conceptKey", "hypothesisHash");

-- CreateIndex
CREATE UNIQUE INDEX "learner_projections_projectionKey_key" ON "learner_projections"("projectionKey");

-- CreateIndex
CREATE INDEX "learner_projections_userId_scope_idx" ON "learner_projections"("userId", "scope");

-- CreateIndex
CREATE INDEX "learner_projections_userId_pathId_scope_idx" ON "learner_projections"("userId", "pathId", "scope");

-- CreateIndex
CREATE INDEX "learner_projections_lastEventAt_idx" ON "learner_projections"("lastEventAt");

-- CreateIndex
CREATE INDEX "prediction_records_userId_taskId_idx" ON "prediction_records"("userId", "taskId");

-- CreateIndex
CREATE INDEX "prediction_records_userId_createdAt_idx" ON "prediction_records"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "prediction_records_outcome_idx" ON "prediction_records"("outcome");

-- CreateIndex
CREATE INDEX "memory_traces_userId_lastSeenAt_idx" ON "memory_traces"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "memory_traces_userId_stability_idx" ON "memory_traces"("userId", "stability");

-- CreateIndex
CREATE INDEX "memory_traces_userId_dueAt_idx" ON "memory_traces"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "memory_traces_userId_pathId_idx" ON "memory_traces"("userId", "pathId");

-- CreateIndex
CREATE INDEX "memory_traces_userId_conceptId_idx" ON "memory_traces"("userId", "conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "memory_traces_userId_conceptKey_key" ON "memory_traces"("userId", "conceptKey");

-- CreateIndex
CREATE INDEX "concepts_userId_level_idx" ON "concepts"("userId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_userId_canonicalLabel_key" ON "concepts"("userId", "canonicalLabel");

-- CreateIndex
CREATE INDEX "concept_aliases_conceptId_idx" ON "concept_aliases"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "concept_aliases_userId_aliasNorm_key" ON "concept_aliases"("userId", "aliasNorm");

-- CreateIndex
CREATE INDEX "concept_edges_userId_fromConceptId_relation_idx" ON "concept_edges"("userId", "fromConceptId", "relation");

-- CreateIndex
CREATE INDEX "concept_edges_userId_toConceptId_relation_idx" ON "concept_edges"("userId", "toConceptId", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "concept_edges_userId_fromConceptId_toConceptId_relation_scope_pathId_key" ON "concept_edges"("userId", "fromConceptId", "toConceptId", "relation", "scope", "pathId");

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_configs_userId_agentName_key" ON "user_agent_configs"("userId", "agentName");

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_model_configs_userId_agentId_key" ON "user_agent_model_configs"("userId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "user_api_configs_userId_key" ON "user_api_configs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_mcp_configs_userId_key" ON "user_mcp_configs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_skill_configs_userId_skillName_key" ON "user_skill_configs"("userId", "skillName");

-- CreateIndex
CREATE INDEX "projection_access_grants_userId_idx" ON "projection_access_grants"("userId");

-- CreateIndex
CREATE INDEX "projection_access_grants_expiresAt_idx" ON "projection_access_grants"("expiresAt");

-- CreateIndex
CREATE INDEX "projection_access_grants_revokedAt_idx" ON "projection_access_grants"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_createdAt_idx" ON "password_reset_tokens"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_learner_profiles_userId_key" ON "virtual_learner_profiles"("userId");

-- CreateIndex
CREATE INDEX "virtual_learner_profiles_userId_idx" ON "virtual_learner_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_learner_profiles_presetKey_key" ON "virtual_learner_profiles"("presetKey");

-- CreateIndex
CREATE INDEX "virtual_sessions_virtualProfileId_idx" ON "virtual_sessions"("virtualProfileId");

-- CreateIndex
CREATE INDEX "virtual_sessions_userId_idx" ON "virtual_sessions"("userId");

-- CreateIndex
CREATE INDEX "virtual_sessions_status_idx" ON "virtual_sessions"("status");

-- CreateIndex
CREATE INDEX "virtual_session_logs_sessionId_id_idx" ON "virtual_session_logs"("sessionId", "id");

-- CreateIndex
CREATE INDEX "virtual_experiment_leases_expiresAt_idx" ON "virtual_experiment_leases"("expiresAt");

-- CreateIndex
CREATE INDEX "virtual_experiment_commands_sessionId_createdAt_idx" ON "virtual_experiment_commands"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "virtual_experiment_commands_runId_status_idx" ON "virtual_experiment_commands"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_experiment_commands_runId_commandId_key" ON "virtual_experiment_commands"("runId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_experiment_commands_runId_sequence_key" ON "virtual_experiment_commands"("runId", "sequence");

-- CreateIndex
CREATE INDEX "virtual_quick_learn_runs_profileId_createdAt_idx" ON "virtual_quick_learn_runs"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "virtual_quick_learn_runs_status_idx" ON "virtual_quick_learn_runs"("status");

-- CreateIndex
CREATE INDEX "virtual_quick_learn_runs_userId_idx" ON "virtual_quick_learn_runs"("userId");

-- CreateIndex
CREATE INDEX "announcements_status_publishedAt_idx" ON "announcements"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "announcements_status_expiresAt_idx" ON "announcements"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_kind_idx" ON "notifications"("kind");

-- CreateIndex
CREATE INDEX "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_adminId_createdAt_idx" ON "admin_audit_logs"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_createdAt_idx" ON "admin_audit_logs"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_jti_key" ON "admin_sessions"("jti");

-- CreateIndex
CREATE INDEX "admin_sessions_adminId_createdAt_idx" ON "admin_sessions"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_sessions_revokedAt_expiresAt_idx" ON "admin_sessions"("revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "login_attempts_scope_createdAt_idx" ON "login_attempts"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_username_createdAt_idx" ON "login_attempts"("username", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ip_createdAt_idx" ON "login_attempts"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_success_createdAt_idx" ON "login_attempts"("success", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_tokenHash_key" ON "user_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_familyId_idx" ON "user_sessions"("familyId");

-- CreateIndex
CREATE INDEX "user_sessions_previousTokenHash_idx" ON "user_sessions"("previousTokenHash");

-- CreateIndex
CREATE INDEX "batch_experiments_status_createdAt_idx" ON "batch_experiments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "batch_experiment_runs_experimentId_idx" ON "batch_experiment_runs"("experimentId");

-- CreateIndex
CREATE INDEX "batch_experiment_runs_status_idx" ON "batch_experiment_runs"("status");

-- CreateIndex
CREATE INDEX "virtual_batch_jobs_status_idx" ON "virtual_batch_jobs"("status");

-- CreateIndex
CREATE INDEX "virtual_batch_jobs_createdAt_idx" ON "virtual_batch_jobs"("createdAt");

