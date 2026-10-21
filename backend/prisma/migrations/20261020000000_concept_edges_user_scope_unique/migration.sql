-- #92 用户级概念边（scope='user', pathId IS NULL）的唯一性。
-- Prisma 复合唯一键 @@unique([..., pathId]) 对 NULL 不生效（SQLite 视多个 NULL 为互不相同），
-- 因此用部分唯一索引兜住用户级边的重复写入。
CREATE UNIQUE INDEX IF NOT EXISTS "concept_edges_user_scope_unique"
  ON "concept_edges"("userId", "fromConceptId", "toConceptId", "relation", "scope")
  WHERE "pathId" IS NULL;
