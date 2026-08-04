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

CREATE INDEX "projection_access_grants_userId_idx" ON "projection_access_grants"("userId");
CREATE INDEX "projection_access_grants_expiresAt_idx" ON "projection_access_grants"("expiresAt");
CREATE INDEX "projection_access_grants_revokedAt_idx" ON "projection_access_grants"("revokedAt");
