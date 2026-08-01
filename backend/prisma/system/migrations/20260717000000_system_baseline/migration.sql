-- CreateTable
CREATE TABLE "agent_lab_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentName" TEXT NOT NULL,
    "model" TEXT,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "baseURL" TEXT,
    "apiKey" TEXT,
    "systemPrompt" TEXT,
    "extraConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "agent_model_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'chat',
    "model" TEXT,
    "endpoint" TEXT,
    "apiKey" TEXT,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2000,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reasoningEffort" TEXT,
    "thinkingMode" TEXT
);

-- CreateTable
CREATE TABLE "agent_prompts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "compiledSystemPrompt" TEXT,
    "compileStatus" TEXT,
    "compileError" TEXT,
    "sourceHash" TEXT,
    "compileContextHash" TEXT,
    "compiledAt" DATETIME,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "avgLatency" REAL,
    "successRate" REAL,
    "publishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "agent_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "inputSchema" TEXT,
    "outputSchema" TEXT,
    "variableBindings" TEXT,
    "capabilities" TEXT,
    "defaultMaxTokens" INTEGER,
    "defaultTemperature" REAL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'code',
    "managedByCode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "orchestrator_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'agent',
    "steps" TEXT NOT NULL,
    "variableGraph" TEXT,
    "source" TEXT NOT NULL DEFAULT 'code',
    "managedByCode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "agent_registrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "config" TEXT,
    "inputSchema" TEXT,
    "outputSchema" TEXT,
    "capabilities" TEXT,
    "subscribes" TEXT,
    "publishes" TEXT,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" REAL NOT NULL DEFAULT 1.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endpoint" TEXT
);

-- CreateTable
CREATE TABLE "platform_api_configs" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'platform',
    "apiUrl" TEXT,
    "apiKey" TEXT,
    "availableModels" TEXT,
    "defaultModel" TEXT,
    "defaultReasoningModel" TEXT,
    "defaultEvaluationModel" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defaultTemperature" REAL NOT NULL DEFAULT 0.7,
    "defaultMaxTokens" INTEGER NOT NULL DEFAULT 2000,
    "reasoningEndpoint" TEXT,
    "lightEndpoint" TEXT,
    "chatModels" TEXT,
    "reasoningModels" TEXT,
    "lightModels" TEXT,
    "adminAccessMode" TEXT,
    "adminAllowedIps" TEXT,
    "allowPrivateNetwork" BOOLEAN,
    "privateNetworkHosts" TEXT
);

-- CreateTable
CREATE TABLE "skill_model_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'chat',
    "model" TEXT,
    "thinkingMode" TEXT,
    "reasoningEffort" TEXT,
    "endpoint" TEXT,
    "apiKey" TEXT,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2000,
    "requestTimeoutMs" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "skill_registrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "category" TEXT,
    "description" TEXT,
    "inputSchema" TEXT,
    "outputSchema" TEXT,
    "endpoint" TEXT,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" REAL NOT NULL DEFAULT 1.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "field_definitions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fieldId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "promptRole" TEXT NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'string',
    "snakeName" TEXT,
    "camelName" TEXT,
    "description" TEXT,
    "enumValues" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v3',
    "source" TEXT NOT NULL DEFAULT 'code',
    "managedByCode" BOOLEAN NOT NULL DEFAULT true,
    "systemLocked" BOOLEAN NOT NULL DEFAULT false,
    "structureLocked" BOOLEAN NOT NULL DEFAULT false,
    "bindings" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "agent_contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v3',
    "source" TEXT NOT NULL DEFAULT 'code',
    "managedByCode" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "agent_field_routings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "render" TEXT NOT NULL DEFAULT 'visible',
    "handoff" TEXT,
    "internalFlag" BOOLEAN NOT NULL DEFAULT false,
    "accumulate" BOOLEAN NOT NULL DEFAULT false,
    "visibilityPreset" TEXT,
    "ordering" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'code',
    "managedByCode" BOOLEAN NOT NULL DEFAULT true,
    "systemLocked" BOOLEAN NOT NULL DEFAULT false,
    "structureLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "node_config_changes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changeType" TEXT NOT NULL,
    "targetTable" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "agentId" TEXT,
    "fieldId" TEXT,
    "before" TEXT,
    "after" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "prompt_eval_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "messagesJson" TEXT NOT NULL,
    "previousStateJson" TEXT,
    "expectationsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "prompt_eval_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "promptVersionId" TEXT,
    "promptVersion" INTEGER,
    "promptSource" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "summaryJson" TEXT NOT NULL,
    "resultsJson" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_lab_configs_agentName_key" ON "agent_lab_configs"("agentName");

-- CreateIndex
CREATE UNIQUE INDEX "agent_model_configs_agentId_key" ON "agent_model_configs"("agentId");

-- CreateIndex
CREATE INDEX "agent_prompts_agentId_idx" ON "agent_prompts"("agentId");

-- CreateIndex
CREATE INDEX "agent_prompts_status_idx" ON "agent_prompts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_prompts_agentId_version_key" ON "agent_prompts"("agentId", "version");

-- CreateIndex
CREATE INDEX "agent_definitions_category_idx" ON "agent_definitions"("category");

-- CreateIndex
CREATE INDEX "agent_definitions_managedByCode_idx" ON "agent_definitions"("managedByCode");

-- CreateIndex
CREATE UNIQUE INDEX "agent_registrations_name_key" ON "agent_registrations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "skill_model_configs_skillId_key" ON "skill_model_configs"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_registrations_name_key" ON "skill_registrations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "field_definitions_fieldId_key" ON "field_definitions"("fieldId");

-- CreateIndex
CREATE INDEX "field_definitions_stage_idx" ON "field_definitions"("stage");

-- CreateIndex
CREATE INDEX "field_definitions_promptRole_idx" ON "field_definitions"("promptRole");

-- CreateIndex
CREATE UNIQUE INDEX "agent_contracts_agentId_key" ON "agent_contracts"("agentId");

-- CreateIndex
CREATE INDEX "agent_contracts_stage_idx" ON "agent_contracts"("stage");

-- CreateIndex
CREATE INDEX "agent_field_routings_agentId_idx" ON "agent_field_routings"("agentId");

-- CreateIndex
CREATE INDEX "agent_field_routings_fieldId_idx" ON "agent_field_routings"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_field_routings_agentId_fieldId_key" ON "agent_field_routings"("agentId", "fieldId");

-- CreateIndex
CREATE INDEX "node_config_changes_targetTable_targetId_idx" ON "node_config_changes"("targetTable", "targetId");

-- CreateIndex
CREATE INDEX "node_config_changes_agentId_idx" ON "node_config_changes"("agentId");

-- CreateIndex
CREATE INDEX "node_config_changes_fieldId_idx" ON "node_config_changes"("fieldId");

-- CreateIndex
CREATE INDEX "node_config_changes_createdAt_idx" ON "node_config_changes"("createdAt");

-- CreateIndex
CREATE INDEX "prompt_eval_cases_agentId_idx" ON "prompt_eval_cases"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_eval_cases_agentId_caseId_key" ON "prompt_eval_cases"("agentId", "caseId");

-- CreateIndex
CREATE INDEX "prompt_eval_runs_agentId_idx" ON "prompt_eval_runs"("agentId");

-- CreateIndex
CREATE INDEX "prompt_eval_runs_createdAt_idx" ON "prompt_eval_runs"("createdAt");
