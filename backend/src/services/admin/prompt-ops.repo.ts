import systemPrisma from '../../config/system-database';
import type { Prisma } from '../../generated/system-client';

/**
 * Prompt 运维仓储（routes/admin/prompt-ops.ts 的取数层，系统库）。
 * agent_prompts 活跃版本/版本定位 + prompt_eval_cases/eval_runs 评估用例与历史；
 * 评估执行与编译语义留在路由层。
 */

// ---------- agent_prompts ----------

export function listActiveAgentPromptsFull() {
  return systemPrisma.agent_prompts.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      agentId: true,
      version: true,
      name: true,
      systemPrompt: true,
      temperature: true,
      maxTokens: true,
      model: true,
      publishedAt: true,
      useCount: true,
    },
    orderBy: { agentId: 'asc' },
  });
}

export function groupDraftCountsByAgent() {
  return systemPrisma.agent_prompts.groupBy({
    by: ['agentId'],
    where: { status: 'DRAFT' },
    _count: { _all: true },
  });
}

export function listActiveAgentPromptsBrief() {
  return systemPrisma.agent_prompts.findMany({
    where: { status: 'ACTIVE' },
    select: { agentId: true, systemPrompt: true, version: true },
  });
}

export function findAgentPromptById(id: string) {
  return systemPrisma.agent_prompts.findUnique({
    where: { id },
  });
}

export function findAgentPromptByVersion(agentId: string, version: number) {
  return systemPrisma.agent_prompts.findFirst({
    where: { agentId, version },
  });
}

export function findActiveAgentPrompt(agentId: string) {
  return systemPrisma.agent_prompts.findFirst({
    where: { agentId, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
  });
}

export function listAllActiveAgentPrompts() {
  return systemPrisma.agent_prompts.findMany({
    where: { status: 'ACTIVE' },
    select: {
      agentId: true,
      systemPrompt: true,
      compiledSystemPrompt: true,
      compileStatus: true,
      name: true,
      version: true,
    },
  });
}

// ---------- prompt_eval_cases ----------

export function listEvalCases(where: Prisma.prompt_eval_casesWhereInput) {
  return systemPrisma.prompt_eval_cases.findMany({
    where,
    orderBy: [{ agentId: 'asc' }, { createdAt: 'asc' }],
  });
}

export function findEvalCaseByAgentAndCaseId(agentId: string, caseId: string) {
  return systemPrisma.prompt_eval_cases.findUnique({
    where: { agentId_caseId: { agentId, caseId } },
  });
}

export function createEvalCase(args: Prisma.prompt_eval_casesCreateArgs) {
  return systemPrisma.prompt_eval_cases.create(args);
}

export function updateEvalCase(id: string, data: Prisma.prompt_eval_casesUpdateInput) {
  return systemPrisma.prompt_eval_cases.update({ where: { id }, data });
}

export function deleteEvalCase(id: string) {
  return systemPrisma.prompt_eval_cases.delete({ where: { id } });
}

export function findEnabledEvalCasesByIds(agentId: string, caseIds: string[]) {
  return systemPrisma.prompt_eval_cases.findMany({
    where: {
      agentId,
      caseId: { in: caseIds },
      enabled: true,
    },
  });
}

export function listEnabledEvalCasesByAgent(agentId: string) {
  return systemPrisma.prompt_eval_cases.findMany({
    where: { agentId, enabled: true },
  });
}

// ---------- prompt_eval_runs ----------

export function createEvalRun(args: Prisma.prompt_eval_runsCreateArgs) {
  return systemPrisma.prompt_eval_runs.create(args);
}

export function listEvalRuns(where: Prisma.prompt_eval_runsWhereInput, limit: number) {
  return systemPrisma.prompt_eval_runs.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function findEvalRunById(id: string) {
  return systemPrisma.prompt_eval_runs.findUnique({
    where: { id },
  });
}
