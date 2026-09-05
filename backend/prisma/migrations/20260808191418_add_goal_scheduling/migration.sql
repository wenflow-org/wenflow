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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_learning_goals" (
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
INSERT INTO "new_learning_goals" ("createdAt", "description", "id", "status", "title", "updatedAt", "userId") SELECT "createdAt", "description", "id", "status", "title", "updatedAt", "userId" FROM "learning_goals";
DROP TABLE "learning_goals";
ALTER TABLE "new_learning_goals" RENAME TO "learning_goals";
CREATE INDEX "learning_goals_userId_status_idx" ON "learning_goals"("userId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "goal_scheduling_ledger_userId_date_idx" ON "goal_scheduling_ledger"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "goal_scheduling_ledger_userId_goalId_date_key" ON "goal_scheduling_ledger"("userId", "goalId", "date");
