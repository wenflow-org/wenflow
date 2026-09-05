/*
  Warnings:

  - You are about to drop the `agent_definitions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `orchestrator_definitions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "agent_definitions";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "orchestrator_definitions";
PRAGMA foreign_keys=on;
