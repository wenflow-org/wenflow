-- AlterTable
ALTER TABLE "users" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "users" ADD COLUMN "deletedBy" TEXT;

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
