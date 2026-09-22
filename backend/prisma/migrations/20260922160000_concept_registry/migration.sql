-- 概念身份注册表（KC 概念身份与图关系改造 · P0/L1 建表）
-- 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.1 / §4.1
--
-- 背景（实测 2026-09-22）：系统里概念有**三套互不相通的身份**——
--   memory_traces/misconception_ledger 用自由文本概念名做键（848 行/843 键，一行为一键）；
--   subtasks/milestones 用 path 内局部序号 concept-N（2415/2415，同键不同义）；
--   kcGraph.nodes.kcId 又是 kc-mapper 自造的一套。三者无共同主键，跨表 join 静默错。
--
-- 本迁移**纯新增**（不改任何既有列语义），故上线零行为变化：
--   1) concepts / concept_aliases：canonical 身份 + 别名唯一索引（解析器即一次索引命中）；
--   2) concept_edges：typed 边表（kcGraph.edges 的物化目标，JSON 仍保留作生成快照）；
--   3) 各表新增 conceptId 可空列 + 索引 —— 历史行留 NULL = 未回填，读侧「conceptId 优先，空则回落原键」。

-- CreateTable
CREATE TABLE "concepts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "canonicalLabel" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'kc',
    "taxonomy" TEXT,
    "granularity" TEXT,
    "originPathId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "concepts_userId_canonicalLabel_key" ON "concepts"("userId", "canonicalLabel");

-- CreateIndex
CREATE INDEX "concepts_userId_level_idx" ON "concepts"("userId", "level");

-- CreateTable
CREATE TABLE "concept_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aliasNorm" TEXT NOT NULL,
    "aliasRaw" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "concept_aliases_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "concept_aliases_userId_aliasNorm_key" ON "concept_aliases"("userId", "aliasNorm");

-- CreateIndex
CREATE INDEX "concept_aliases_conceptId_idx" ON "concept_aliases"("conceptId");

-- CreateTable
CREATE TABLE "concept_edges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromConceptId" TEXT NOT NULL,
    "toConceptId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'path',
    "pathId" TEXT,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "concept_edges_userId_fromConceptId_toConceptId_relation_scope_pathId_key" ON "concept_edges"("userId", "fromConceptId", "toConceptId", "relation", "scope", "pathId");

-- CreateIndex
CREATE INDEX "concept_edges_userId_fromConceptId_relation_idx" ON "concept_edges"("userId", "fromConceptId", "relation");

-- CreateIndex
CREATE INDEX "concept_edges_userId_toConceptId_relation_idx" ON "concept_edges"("userId", "toConceptId", "relation");

-- AlterTable: memory_traces.conceptId（canonical 身份；NULL = 未回填）
ALTER TABLE "memory_traces" ADD COLUMN "conceptId" TEXT;

-- CreateIndex
CREATE INDEX "memory_traces_userId_conceptId_idx" ON "memory_traces"("userId", "conceptId");

-- AlterTable: misconception_ledger.conceptId
ALTER TABLE "misconception_ledger" ADD COLUMN "conceptId" TEXT;

-- CreateIndex
CREATE INDEX "misconception_ledger_userId_conceptId_idx" ON "misconception_ledger"("userId", "conceptId");

-- AlterTable: subtasks.conceptId（canonical；与 path 内局部 linkedConceptId 并存）
ALTER TABLE "subtasks" ADD COLUMN "conceptId" TEXT;

-- CreateIndex
CREATE INDEX "subtasks_conceptId_idx" ON "subtasks"("conceptId");

-- AlterTable: milestones.conceptId（canonical；与 path 内局部 coreConceptId 并存）
ALTER TABLE "milestones" ADD COLUMN "conceptId" TEXT;

-- CreateIndex
CREATE INDEX "milestones_conceptId_idx" ON "milestones"("conceptId");
