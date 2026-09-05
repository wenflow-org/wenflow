/*
  Warnings:

  - You are about to drop the `virtual_experiment_runs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "virtual_experiment_runs";
PRAGMA foreign_keys=on;
