/**
 * v4 coreHash 独立维度对账（SKILL_PROTOCOL_V4 §6.2/§6.3）
 *
 * 对声明了 coreHash 的 prompt 文件（v4 编译产物）做三项检查：
 * 1. 核心文件存在且 schema 合法（core-file-missing / invalid-core-file）
 * 2. 漂移：computeCoreHash(core) === 文件 frontmatter coreHash —— 手改 prompt 绕过核心文件即 drift
 * 3. 同步：DB ACTIVE 行锚点（列优先，metadata.promptLab 兜底）与文件一致 —— 否则 db-mismatch
 *
 * 未声明 coreHash 的 v2 文件记 not-declared，不影响现有 21/21 对账。
 * 纯函数分析 + 依赖注入，测试不连 DB 不读真实文件（对标 runtime-contract parity 测试模式）。
 */

import 'dotenv/config';
import systemPrisma from '../config/system-database';
import { scanPromptFiles, loadAllPromptFiles, type PromptFileScanDiagnostic } from '../composers/prompt-files/loader';
import {
  computeCoreHash,
  loadCoreFile,
  type CoreFile,
} from '../services/prompt-lab/core-file-loader';
import { ensureCoreAgentPrompts } from './seed-core-agent-prompts';

export type CoreHashParityStatus =
  | 'not-declared'
  | 'in-sync'
  | 'core-file-missing'
  | 'invalid-core-file'
  | 'drift'
  | 'db-mismatch'
  | 'missing-active';

export interface CoreHashParityFileInput {
  agentId: string;
  filePath: string;
  coreHash?: string;
  coreVersion?: number;
  acceptableAgentIds?: string[];
}

export interface CoreHashParityActiveRow {
  agentId: string;
  metadata?: string | null;
  coreHash?: string | null;
  coreVersion?: number | null;
}

export interface CoreHashParityResult {
  agentId: string;
  filePath: string;
  status: CoreHashParityStatus;
  detail?: string;
}

export interface CoreHashParityReport {
  results: CoreHashParityResult[];
  summary: {
    scannedFiles: number;
    declaredFiles: number;
    inSyncCount: number;
    errorCount: number;
    statuses: Record<string, number>;
  };
  hasErrors: boolean;
}

export type CoreLoader = (skillId: string) => { core: CoreFile | null; diagnostics?: unknown } | null;

function toSkillId(agentId: string): string {
  return String(agentId || '').replace(/^skill:/, '').trim();
}

/** 从 ACTIVE 行提取 coreHash：列优先，metadata.promptLab 快照兜底 */
export function extractRowCoreHash(row: CoreHashParityActiveRow): string | undefined {
  if (typeof row.coreHash === 'string' && row.coreHash.trim()) return row.coreHash.trim();
  if (!row.metadata) return undefined;
  try {
    const parsed = JSON.parse(row.metadata);
    const value = parsed?.promptLab?.coreHash;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function analyzeCoreHashParity(input: {
  files: CoreHashParityFileInput[];
  activeRows: CoreHashParityActiveRow[];
  loadCore: CoreLoader;
  diagnostics?: PromptFileScanDiagnostic[];
}): CoreHashParityReport {
  const results: CoreHashParityResult[] = [];

  for (const file of [...input.files].sort((a, b) => a.agentId.localeCompare(b.agentId))) {
    if (file.coreHash === undefined) {
      results.push({ agentId: file.agentId, filePath: file.filePath, status: 'not-declared' });
      continue;
    }

    const skillId = toSkillId(file.agentId);
    const loaded = input.loadCore(skillId);
    if (!loaded) {
      results.push({
        agentId: file.agentId,
        filePath: file.filePath,
        status: 'core-file-missing',
        detail: `声明 coreHash 但找不到核心文件 core/${skillId}.yaml`,
      });
      continue;
    }
    if (!loaded.core) {
      results.push({
        agentId: file.agentId,
        filePath: file.filePath,
        status: 'invalid-core-file',
        detail: `核心文件 core/${skillId}.yaml schema 不合法`,
      });
      continue;
    }

    const expectedHash = computeCoreHash(loaded.core);
    if (expectedHash !== file.coreHash) {
      results.push({
        agentId: file.agentId,
        filePath: file.filePath,
        status: 'drift',
        detail: `手改痕迹：frontmatter coreHash=${file.coreHash.slice(0, 12)}… ≠ 核心文件实际哈希=${expectedHash.slice(0, 12)}…，须回补核心文件后重新编译`,
      });
      continue;
    }

    const acceptedIds = new Set(
      (file.acceptableAgentIds?.length ? file.acceptableAgentIds : [file.agentId]).map((v) => v.trim()).filter(Boolean)
    );
    const activeRows = input.activeRows.filter((row) => acceptedIds.has(row.agentId));
    if (activeRows.length === 0) {
      results.push({
        agentId: file.agentId,
        filePath: file.filePath,
        status: 'missing-active',
        detail: 'DB 无 ACTIVE 版本，待 sync',
      });
      continue;
    }

    const rowHash = extractRowCoreHash(activeRows[0]);
    if (rowHash !== file.coreHash) {
      results.push({
        agentId: file.agentId,
        filePath: file.filePath,
        status: 'db-mismatch',
        detail: `DB ACTIVE 锚点=${rowHash ? `${rowHash.slice(0, 12)}…` : '缺失'} ≠ 文件=${file.coreHash.slice(0, 12)}…，待 sync`,
      });
      continue;
    }

    results.push({ agentId: file.agentId, filePath: file.filePath, status: 'in-sync' });
  }

  const statuses: Record<string, number> = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] || 0) + 1;
  const diagnosticCount = input.diagnostics?.length ?? 0;
  const errorCount =
    diagnosticCount + results.filter((r) => !['in-sync', 'not-declared'].includes(r.status)).length;

  return {
    results,
    summary: {
      scannedFiles: input.files.length,
      declaredFiles: results.filter((r) => r.status !== 'not-declared').length,
      inSyncCount: results.filter((r) => r.status === 'in-sync').length,
      errorCount,
      statuses: Object.fromEntries(Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b))),
    },
    hasErrors: errorCount > 0,
  };
}

export interface CoreHashParityQueryAdapter {
  agent_prompts: {
    findMany: (args: {
      where: { status: 'ACTIVE' };
      select: { agentId: true; metadata: true; coreHash: true; coreVersion: true };
    }) => Promise<CoreHashParityActiveRow[]>;
  };
}

export async function checkCoreHashParity(
  prisma: CoreHashParityQueryAdapter,
  scan = scanPromptFiles()
): Promise<CoreHashParityReport> {
  const activeRows = await prisma.agent_prompts.findMany({
    where: { status: 'ACTIVE' },
    select: { agentId: true, metadata: true, coreHash: true, coreVersion: true },
  });
  return analyzeCoreHashParity({
    files: scan.files,
    activeRows,
    loadCore: (skillId) => loadCoreFile(skillId),
    diagnostics: scan.diagnostics,
  });
}

async function main(): Promise<void> {
  // 检查前同步核心 prompt 到 DB（消除 CI 种子步骤脱节风险）
  const seedResult = await ensureCoreAgentPrompts(systemPrisma, 'sync');
  console.error('[core-hash-check] seed result:', JSON.stringify(seedResult));

  if (seedResult.created.length === 0 && seedResult.updated.length === 0) {
    console.error('[core-hash-check] seed created 0 records, falling back to direct seed');
    await directSeedFromPromptFiles(systemPrisma);
  }

  const report = await checkCoreHashParity(systemPrisma);
  console.log(JSON.stringify(report, null, 2));
  if (report.hasErrors) process.exitCode = 1;
}

async function directSeedFromPromptFiles(prisma: typeof systemPrisma): Promise<void> {
  const files = loadAllPromptFiles().filter((f) => f.archetype !== 'code-only');
  const config = await prisma.platform_api_configs.findUnique({
    where: { id: 'platform' },
    select: { defaultModel: true },
  });
  const defaultModel = String(config?.defaultModel || process.env.AI_MODEL || '').trim() || null;

  for (const file of files) {
    const existingActive = await prisma.agent_prompts.findFirst({
      where: { agentId: file.agentId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (existingActive) continue;

    const latest = await prisma.agent_prompts.findFirst({
      where: { agentId: file.agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await prisma.agent_prompts.create({
      data: {
        id: `ap_seed_${file.agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        agentId: file.agentId,
        version: nextVersion,
        name: `v${nextVersion}-${file.name}`,
        description: file.description || `从文件 ${file.agentId}.md 加载`,
        systemPrompt: file.systemPrompt,
        temperature: file.temperature ?? 0.7,
        maxTokens: file.maxTokens ?? 4000,
        model: defaultModel,
        status: 'ACTIVE',
        createdBy: 'core-hash-check',
        publishedAt: new Date(),
      },
    });
  }
  console.error(`[core-hash-check] direct seed checked ${files.length} files`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.log(
        JSON.stringify(
          { hasErrors: true, error: error instanceof Error ? error.message : String(error) },
          null,
          2
        )
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await systemPrisma.$disconnect();
    });
}
