-- CreateTable
CREATE TABLE "ab_test" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "testType" TEXT NOT NULL,
    "variants" TEXT NOT NULL,
    "trafficSplit" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ab_test_result" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "completionTime" INTEGER,
    "successRate" REAL,
    "averageScore" REAL,
    "engagement" REAL,
    "frustration" REAL,
    "satisfaction" REAL,
    "preTestScore" REAL,
    "postTestScore" REAL,
    "learningGain" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ab_test_result_testId_fkey" FOREIGN KEY ("testId") REFERENCES "ab_test" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "agent_execution_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" TEXT,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "agent_instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "agentType" TEXT NOT NULL DEFAULT 'official',
    "currentTaskId" TEXT,
    "taskType" TEXT,
    "avgDurationMs" INTEGER NOT NULL DEFAULT 0,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "successCalls" INTEGER NOT NULL DEFAULT 0,
    "errorCalls" INTEGER NOT NULL DEFAULT 0,
    "cpuUsage" REAL,
    "memoryUsage" REAL,
    "lastHeartbeat" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "agent_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" TEXT,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "prompt_call_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "systemPromptVersion" INTEGER,
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
    "pathId" TEXT,
    "userId" TEXT,
    "conversationId" TEXT,
    "pipelineRunId" TEXT,
    "pipelineStepIndex" INTEGER,
    "traceId" TEXT,
    "parentExecutionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "arena_agent_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "durationMs" INTEGER,
    "input" TEXT,
    "output" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "error" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_agent_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_dialogues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "messages" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "userMessageCount" INTEGER NOT NULL,
    "aiMessageCount" INTEGER NOT NULL,
    "generationTimeMs" INTEGER,
    "agentName" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_dialogues_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_evaluations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "personaScore" INTEGER,
    "dialogueScore" INTEGER,
    "extractionScore" INTEGER,
    "proposalScore" INTEGER,
    "pathScore" INTEGER,
    "report" TEXT,
    "suggestions" TEXT,
    "generationTimeMs" INTEGER,
    "agentName" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_evaluations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_extractions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "content" TEXT,
    "surfaceGoal" TEXT,
    "realProblem" TEXT,
    "level" TEXT,
    "timePerDay" TEXT,
    "totalWeeks" TEXT,
    "motivation" TEXT,
    "urgency" TEXT,
    "completenessScore" INTEGER,
    "missingFields" TEXT,
    "followUpQuestions" TEXT,
    "generationTimeMs" INTEGER,
    "agentName" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_extractions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_generations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "proposalContent" TEXT,
    "pathContent" TEXT,
    "totalWeeks" INTEGER,
    "totalTasks" INTEGER,
    "generationTimeMs" INTEGER,
    "agentName" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_generations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_optimizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "suggestions" TEXT,
    "optimizedPrompts" TEXT,
    "expectedImprovement" TEXT,
    "generationTimeMs" INTEGER,
    "agentName" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_optimizations_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_personas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "content" TEXT,
    "surfaceGoal" TEXT,
    "realProblem" TEXT,
    "level" TEXT,
    "timePerDay" TEXT,
    "totalWeeks" TEXT,
    "motivation" TEXT,
    "urgency" TEXT,
    "generationTimeMs" INTEGER,
    "agentName" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "arena_personas_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "arena_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "arena_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scenario" TEXT NOT NULL DEFAULT 'default',
    "config" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "agentCount" INTEGER NOT NULL DEFAULT 0,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "totalRounds" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "content_feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "subtaskId" TEXT,
    "agentId" TEXT NOT NULL DEFAULT 'ai-teaching-agent',
    "rating" INTEGER NOT NULL,
    "helpfulness" INTEGER,
    "clarity" INTEGER,
    "difficulty" INTEGER,
    "comment" TEXT,
    "suggestions" TEXT,
    "confusionPoint" TEXT,
    "strategy" TEXT,
    "uiType" TEXT,
    "roundNumber" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "content_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "debug_learning_paths" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "path" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "totalWeeks" INTEGER,
    "totalTasks" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposalId" TEXT,
    CONSTRAINT "debug_learning_paths_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "debug_snapshots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "debug_learning_paths_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "debug_proposals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "debug_proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "proposal" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "debug_proposals_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "debug_snapshots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "debug_requirements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "realProblem" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "debug_requirements_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "debug_snapshots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "debug_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '未命名快照',
    "description" TEXT,
    "sourceConversationId" TEXT,
    "rawMessages" TEXT,
    "snapshot" TEXT,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "dialogue_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "round" INTEGER NOT NULL DEFAULT 0,
    "history" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "evaluation_params" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "dialogue_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learningContents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subtaskId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'lesson',
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "keyPoints" TEXT,
    "resources" TEXT,
    "exercises" TEXT,
    "generatedBy" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "learningContents_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "subtasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learning_goals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "learning_metrics" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "milestones_learningPathId_fkey" FOREIGN KEY ("learningPathId") REFERENCES "learning_paths" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "path_decompositions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "stages" TEXT NOT NULL,
    "milestones" TEXT NOT NULL,
    "subtasks" TEXT NOT NULL,
    "aiAnalysis" TEXT,
    "feasibility" TEXT,
    "difficulty" TEXT,
    "recommendations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "path_decompositions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "platform_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "totalPaths" INTEGER NOT NULL DEFAULT 0,
    "activePaths" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "student_baselines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "totalTime" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "avgRating" REAL NOT NULL DEFAULT 0,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActive" DATETIME,
    "responseTimeEma" REAL NOT NULL DEFAULT 10.0,
    "responseTimeEmVar" REAL NOT NULL DEFAULT 1.0,
    "messageLengthEma" REAL NOT NULL DEFAULT 50.0,
    "messageLengthEmVar" REAL NOT NULL DEFAULT 100.0,
    "interactionIntervalEma" REAL NOT NULL DEFAULT 5.0,
    "interactionIntervalEmVar" REAL NOT NULL DEFAULT 1.0,
    "aiScoreEma" REAL NOT NULL DEFAULT 0.5,
    "aiScoreEmVar" REAL NOT NULL DEFAULT 0.01,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "student_baselines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "coreConcept" TEXT,
    "displayLabel" TEXT,
    "knowledgeType" TEXT,
    "learningObjectives" TEXT,
    "transferable" BOOLEAN DEFAULT false,
    "linkedConceptId" TEXT,
    "linkedConceptName" TEXT,
    CONSTRAINT "subtasks_usersId_fkey" FOREIGN KEY ("usersId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "subtasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_announcements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "servers" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "dashboardGuidanceSnapshot" TEXT
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
    "simulationMode" TEXT NOT NULL DEFAULT 'manual',
    "simulationPrompt" TEXT,
    "simulationModel" TEXT,
    "simulationTemperature" REAL DEFAULT 0.8,
    "personalityTraits" TEXT,
    "tags" TEXT,
    "notes" TEXT,
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

-- CreateIndex
CREATE INDEX "ab_test_status_idx" ON "ab_test"("status");

-- CreateIndex
CREATE INDEX "ab_test_testType_idx" ON "ab_test"("testType");

-- CreateIndex
CREATE INDEX "ab_test_result_testId_idx" ON "ab_test_result"("testId");

-- CreateIndex
CREATE INDEX "ab_test_result_variantId_idx" ON "ab_test_result"("variantId");

-- CreateIndex
CREATE INDEX "ab_test_result_userId_idx" ON "ab_test_result"("userId");

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
CREATE INDEX "agent_execution_logs_timestamp_idx" ON "agent_execution_logs"("timestamp");

-- CreateIndex
CREATE INDEX "agent_execution_logs_agentName_idx" ON "agent_execution_logs"("agentName");

-- CreateIndex
CREATE INDEX "agent_execution_logs_instanceId_idx" ON "agent_execution_logs"("instanceId");

-- CreateIndex
CREATE INDEX "agent_logs_timestamp_idx" ON "agent_logs"("timestamp");

-- CreateIndex
CREATE INDEX "agent_logs_agentName_idx" ON "agent_logs"("agentName");

-- CreateIndex
CREATE INDEX "prompt_call_logs_agentId_createdAt_idx" ON "prompt_call_logs"("agentId", "createdAt");

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
CREATE INDEX "arena_agent_logs_sessionId_idx" ON "arena_agent_logs"("sessionId");

-- CreateIndex
CREATE INDEX "arena_agent_logs_agentName_idx" ON "arena_agent_logs"("agentName");

-- CreateIndex
CREATE INDEX "arena_agent_logs_status_idx" ON "arena_agent_logs"("status");

-- CreateIndex
CREATE INDEX "arena_agent_logs_startTime_idx" ON "arena_agent_logs"("startTime");

-- CreateIndex
CREATE UNIQUE INDEX "arena_dialogues_sessionId_key" ON "arena_dialogues"("sessionId");

-- CreateIndex
CREATE INDEX "arena_dialogues_sessionId_idx" ON "arena_dialogues"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "arena_evaluations_sessionId_key" ON "arena_evaluations"("sessionId");

-- CreateIndex
CREATE INDEX "arena_evaluations_sessionId_idx" ON "arena_evaluations"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "arena_extractions_sessionId_key" ON "arena_extractions"("sessionId");

-- CreateIndex
CREATE INDEX "arena_extractions_sessionId_idx" ON "arena_extractions"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "arena_generations_sessionId_key" ON "arena_generations"("sessionId");

-- CreateIndex
CREATE INDEX "arena_generations_sessionId_idx" ON "arena_generations"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "arena_optimizations_sessionId_key" ON "arena_optimizations"("sessionId");

-- CreateIndex
CREATE INDEX "arena_optimizations_sessionId_idx" ON "arena_optimizations"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "arena_personas_sessionId_key" ON "arena_personas"("sessionId");

-- CreateIndex
CREATE INDEX "arena_personas_sessionId_idx" ON "arena_personas"("sessionId");

-- CreateIndex
CREATE INDEX "content_feedback_userId_idx" ON "content_feedback"("userId");

-- CreateIndex
CREATE INDEX "content_feedback_sessionId_idx" ON "content_feedback"("sessionId");

-- CreateIndex
CREATE INDEX "content_feedback_agentId_idx" ON "content_feedback"("agentId");

-- CreateIndex
CREATE INDEX "learningContents_subtaskId_idx" ON "learningContents"("subtaskId");

-- CreateIndex
CREATE INDEX "learningContents_contentType_idx" ON "learningContents"("contentType");

-- CreateIndex
CREATE UNIQUE INDEX "learning_paths_activeGenerationRunId_key" ON "learning_paths"("activeGenerationRunId");

-- CreateIndex
CREATE INDEX "learning_paths_userId_idx" ON "learning_paths"("userId");

-- CreateIndex
CREATE INDEX "learning_paths_status_idx" ON "learning_paths"("status");

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
CREATE UNIQUE INDEX "milestones_learningPathId_stageNumber_key" ON "milestones"("learningPathId", "stageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "student_baselines_userId_key" ON "student_baselines"("userId");

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
CREATE INDEX "teaching_sessions_userId_taskId_status_idx" ON "teaching_sessions"("userId", "taskId", "status");

-- CreateIndex
CREATE INDEX "teaching_sessions_status_idx" ON "teaching_sessions"("status");

-- CreateIndex
CREATE INDEX "teaching_sessions_taskId_idx" ON "teaching_sessions"("taskId");

-- CreateIndex
CREATE INDEX "teaching_sessions_userId_idx" ON "teaching_sessions"("userId");

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
CREATE UNIQUE INDEX "learner_projections_projectionKey_key" ON "learner_projections"("projectionKey");

-- CreateIndex
CREATE INDEX "learner_projections_userId_scope_idx" ON "learner_projections"("userId", "scope");

-- CreateIndex
CREATE INDEX "learner_projections_userId_pathId_scope_idx" ON "learner_projections"("userId", "pathId", "scope");

-- CreateIndex
CREATE INDEX "learner_projections_lastEventAt_idx" ON "learner_projections"("lastEventAt");

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
CREATE UNIQUE INDEX "virtual_learner_profiles_userId_key" ON "virtual_learner_profiles"("userId");

-- CreateIndex
CREATE INDEX "virtual_learner_profiles_userId_idx" ON "virtual_learner_profiles"("userId");

-- CreateIndex
CREATE INDEX "virtual_sessions_virtualProfileId_idx" ON "virtual_sessions"("virtualProfileId");

-- CreateIndex
CREATE INDEX "virtual_sessions_userId_idx" ON "virtual_sessions"("userId");

-- CreateIndex
CREATE INDEX "virtual_sessions_status_idx" ON "virtual_sessions"("status");
