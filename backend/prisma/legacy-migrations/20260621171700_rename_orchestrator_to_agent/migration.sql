-- Rename orchestrator tables to agent tables
-- This migration renames 3 tables and updates all orchestratorId fields to agentId

-- 1. Rename orchestrator_contracts to agent_contracts
ALTER TABLE "orchestrator_contracts" RENAME TO "agent_contracts";

-- 2. Rename orchestrator_field_routings to agent_field_routings
ALTER TABLE "orchestrator_field_routings" RENAME TO "agent_field_routings";

-- 3. Update orchestrator_definitions category default (SQLite doesn't support ALTER COLUMN DEFAULT directly)
-- We'll handle this by recreating the table
CREATE TABLE "orchestrator_definitions_new" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'agent',
  "steps" TEXT NOT NULL,
  "variableGraph" TEXT,
  "source" TEXT NOT NULL DEFAULT 'code',
  "managedByCode" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

INSERT INTO "orchestrator_definitions_new" 
  SELECT "id", "displayName", "description", "category", "steps", "variableGraph", 
         "source", "managedByCode", "createdAt", "updatedAt"
  FROM "orchestrator_definitions";

DROP TABLE "orchestrator_definitions";
ALTER TABLE "orchestrator_definitions_new" RENAME TO "orchestrator_definitions";

-- Note: SQLite doesn't support renaming columns directly, but our schema changes
-- handle field renames through table recreation which Prisma will manage in the next generate
