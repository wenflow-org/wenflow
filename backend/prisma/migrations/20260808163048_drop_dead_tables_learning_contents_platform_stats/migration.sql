/*
  Warnings:

  - You are about to drop the `learningContents` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `platform_stats` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "learningContents";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "platform_stats";
PRAGMA foreign_keys=on;
