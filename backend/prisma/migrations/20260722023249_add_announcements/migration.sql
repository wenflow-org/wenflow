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

-- CreateIndex
CREATE INDEX "announcements_status_publishedAt_idx" ON "announcements"("status", "publishedAt");
