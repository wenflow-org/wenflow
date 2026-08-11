-- 管理员会话管理（P2 方案 B：轻量完整会话表）
-- 纯 CREATE TABLE + 索引，SQLite 安全（无 ALTER/无外键，无需 PRAGMA foreign_keys 处理）。

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_jti_key" ON "admin_sessions"("jti");

-- CreateIndex
CREATE INDEX "admin_sessions_adminId_createdAt_idx" ON "admin_sessions"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_sessions_revokedAt_expiresAt_idx" ON "admin_sessions"("revokedAt", "expiresAt");
