-- 对齐 backend_boot_registry 与 schema.prisma：原迁移（20261002230000）主键写成
-- `instance_id TEXT PRIMARY KEY`（SQLite 下不等价于 NOT NULL），与 model 的 String @id
-- 语义不一致，fresh replay 与 schema 产生漂移——CI prisma:migrate:verify-clean 自
-- 2026-10-03 起持续红。此迁移即 prisma migrate diff 给出的 RedefineTables 对齐方案。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_backend_boot_registry" (
    "instance_id" TEXT NOT NULL PRIMARY KEY,
    "pid" INTEGER NOT NULL,
    "boot_at" INTEGER NOT NULL,
    "hb_at" INTEGER NOT NULL
);
INSERT INTO "new_backend_boot_registry" ("boot_at", "hb_at", "instance_id", "pid") SELECT "boot_at", "hb_at", "instance_id", "pid" FROM "backend_boot_registry";
DROP TABLE "backend_boot_registry";
ALTER TABLE "new_backend_boot_registry" RENAME TO "backend_boot_registry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
