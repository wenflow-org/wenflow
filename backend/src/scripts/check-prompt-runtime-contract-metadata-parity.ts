import 'dotenv/config';
import systemPrisma from '../config/system-database';
import {
  scanPromptFiles,
  type PromptFile,
  type PromptFileScanDiagnostic,
  type PromptFileScanResult,
} from '../composers/prompt-files/loader';
import type { RuntimeContract } from '../services/prompt-lab/runtime-contract';
import {
  normalizeDeclaredPromptRuntimeContract,
  type DeclaredPromptRuntimeContractIdentity,
} from './seed-core-agent-prompts';

export interface ActivePromptRuntimeContractMetadataRow {
  id: string;
  agentId: string;
  version: number;
  metadata: string | null;
}

export interface PromptRuntimeContractMetadataParityQueryAdapter {
  agent_prompts: {
    findMany: (args: {
      where: {
        status: 'ACTIVE';
        agentId: { in: string[] };
      };
      select: {
        id: true;
        agentId: true;
        version: true;
        metadata: true;
      };
      orderBy: Array<{ agentId?: 'asc'; version?: 'desc'; id?: 'asc' }>;
    }) => Promise<ActivePromptRuntimeContractMetadataRow[]>;
  };
}

export type PromptRuntimeContractMetadataParityStatus =
  | 'in-sync'
  | 'mismatch'
  | 'invalid-file-declaration'
  | 'duplicate-canonical-agent-id'
  | 'alias-collision'
  | 'missing-active'
  | 'active-alias-not-canonical'
  | 'ambiguous-active'
  | 'missing-metadata'
  | 'malformed-metadata-json'
  | 'metadata-non-object'
  | 'missing-nested-contract'
  | 'malformed-nested-contract';

export interface PromptRuntimeContractMetadataParityResult {
  agentId: string;
  filePath: string;
  acceptableAgentIds: string[];
  status: PromptRuntimeContractMetadataParityStatus;
  sourceIssues?: Array<'duplicate-canonical-agent-id' | 'alias-collision'>;
  detail?: string;
  activePrompt?: Pick<ActivePromptRuntimeContractMetadataRow, 'id' | 'agentId' | 'version'>;
  activePrompts?: Array<Pick<ActivePromptRuntimeContractMetadataRow, 'id' | 'agentId' | 'version'>>;
  declaredContract?: RuntimeContract;
  activeContract?: RuntimeContract;
}

export interface PromptRuntimeContractMetadataParityReport {
  diagnostics: PromptFileScanDiagnostic[];
  results: PromptRuntimeContractMetadataParityResult[];
  summary: {
    scannedFiles: number;
    declaredRuntimeContractFiles: number;
    skippedFilesWithoutRuntimeContract: number;
    diagnosticCount: number;
    resultCount: number;
    inSyncCount: number;
    errorCount: number;
    statuses: Record<string, number>;
  };
  hasErrors: boolean;
}

export interface PromptRuntimeContractMetadataParityAnalysisInput {
  files: PromptFile[];
  activeRows: ActivePromptRuntimeContractMetadataRow[];
  diagnostics?: PromptFileScanDiagnostic[];
}

type RuntimeContractMetadataParseResult =
  | { status: 'valid'; contract: RuntimeContract }
  | {
    status:
      | 'missing-metadata'
      | 'malformed-metadata-json'
      | 'metadata-non-object'
      | 'missing-nested-contract'
      | 'malformed-nested-contract';
    detail?: string;
  };

interface DeclaredPromptSource {
  file: PromptFile;
  agentId: string;
  acceptableAgentIds: string[];
  acceptedAgentIds: string[];
  sourceIssues: Array<'duplicate-canonical-agent-id' | 'alias-collision'>;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dedupeAndSort(values: string[]): string[] {
  return Array.from(new Set(values)).sort(compareText);
}

function acceptedAgentIdsForFile(file: PromptFile): string[] {
  const aliases = Array.isArray(file.acceptableAgentIds)
    ? file.acceptableAgentIds.filter((agentId): agentId is string => typeof agentId === 'string')
    : [];
  return dedupeAndSort([file.agentId.trim(), ...aliases.map((agentId) => agentId.trim())].filter(Boolean));
}

function toIdentity(file: PromptFile): DeclaredPromptRuntimeContractIdentity {
  return { agentId: file.agentId, archetype: file.archetype };
}

function sortRows(rows: ActivePromptRuntimeContractMetadataRow[]): ActivePromptRuntimeContractMetadataRow[] {
  return [...rows].sort((left, right) => {
    const byAgentId = compareText(left.agentId, right.agentId);
    if (byAgentId !== 0) return byAgentId;
    if (left.version !== right.version) return right.version - left.version;
    return compareText(left.id, right.id);
  });
}

function promptReference(row: ActivePromptRuntimeContractMetadataRow) {
  return { id: row.id, agentId: row.agentId, version: row.version };
}

/** Collects only File-as-Truth sources which explicitly declare a runtime contract. */
export function collectDeclaredPromptRuntimeContractAgentIdCandidates(files: PromptFile[]): string[] {
  return dedupeAndSort(files
    .filter((file) => file.runtimeContract !== undefined)
    .flatMap((file) => acceptedAgentIdsForFile(file)));
}

/** The checker has one intentionally narrow read query and no write or transaction path. */
export function buildActivePromptRuntimeContractMetadataQuery(agentIdCandidates: string[]) {
  return {
    where: {
      status: 'ACTIVE' as const,
      agentId: { in: dedupeAndSort(agentIdCandidates) },
    },
    select: {
      id: true as const,
      agentId: true as const,
      version: true as const,
      metadata: true as const,
    },
    orderBy: [
      { agentId: 'asc' as const },
      { version: 'desc' as const },
      { id: 'asc' as const },
    ],
  };
}

export async function queryActivePromptRuntimeContractMetadataRows(
  prisma: PromptRuntimeContractMetadataParityQueryAdapter,
  agentIdCandidates: string[]
): Promise<ActivePromptRuntimeContractMetadataRow[]> {
  return prisma.agent_prompts.findMany(buildActivePromptRuntimeContractMetadataQuery(agentIdCandidates));
}

/** Parses metadata without correcting or persisting any malformed value. */
export function parseActivePromptRuntimeContractMetadata(
  metadata: unknown,
  identity: DeclaredPromptRuntimeContractIdentity
): RuntimeContractMetadataParseResult {
  if (metadata === null || metadata === undefined) {
    return { status: 'missing-metadata' };
  }
  if (typeof metadata !== 'string') {
    return { status: 'metadata-non-object', detail: 'metadata must be a JSON object string' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch (error) {
    return {
      status: 'malformed-metadata-json',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!isRecord(parsed)) {
    return { status: 'metadata-non-object', detail: 'metadata JSON must be an object' };
  }

  if (!Object.prototype.hasOwnProperty.call(parsed, 'promptLab')) {
    return { status: 'missing-nested-contract', detail: 'metadata.promptLab.runtimeContract is missing' };
  }
  if (!isRecord(parsed.promptLab)) {
    return { status: 'malformed-nested-contract', detail: 'metadata.promptLab must be an object' };
  }
  if (!Object.prototype.hasOwnProperty.call(parsed.promptLab, 'runtimeContract')) {
    return { status: 'missing-nested-contract', detail: 'metadata.promptLab.runtimeContract is missing' };
  }

  try {
    return {
      status: 'valid',
      contract: normalizeDeclaredPromptRuntimeContract(parsed.promptLab.runtimeContract, identity),
    };
  } catch (error) {
    return {
      status: 'malformed-nested-contract',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Structural comparison keeps object-key ordering irrelevant and array ordering significant. */
export function structurallyEqualRuntimeContracts(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqualRuntimeContracts(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left).sort(compareText);
  const rightKeys = Object.keys(right).sort(compareText);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && structurallyEqualRuntimeContracts(left[key], right[key]));
}

function buildDeclaredSources(files: PromptFile[]): DeclaredPromptSource[] {
  const sources = files
    .filter((file) => file.runtimeContract !== undefined)
    .map((file) => {
      const acceptedAgentIds = acceptedAgentIdsForFile(file);
      return {
        file,
        agentId: file.agentId,
        acceptableAgentIds: acceptedAgentIds.filter((agentId) => agentId !== file.agentId),
        acceptedAgentIds,
        sourceIssues: [],
      };
    });

  const sourceIndexesByCanonicalId = new Map<string, number[]>();
  const sourceIndexesByAcceptedId = new Map<string, number[]>();
  sources.forEach((source, index) => {
    const canonicalIndexes = sourceIndexesByCanonicalId.get(source.agentId) || [];
    canonicalIndexes.push(index);
    sourceIndexesByCanonicalId.set(source.agentId, canonicalIndexes);

    for (const acceptedAgentId of source.acceptedAgentIds) {
      const acceptedIndexes = sourceIndexesByAcceptedId.get(acceptedAgentId) || [];
      acceptedIndexes.push(index);
      sourceIndexesByAcceptedId.set(acceptedAgentId, acceptedIndexes);
    }
  });

  for (const indexes of sourceIndexesByCanonicalId.values()) {
    if (indexes.length > 1) {
      indexes.forEach((index) => sources[index].sourceIssues.push('duplicate-canonical-agent-id'));
    }
  }
  for (const indexes of sourceIndexesByAcceptedId.values()) {
    const canonicalAgentIds = new Set(indexes.map((index) => sources[index].agentId));
    if (canonicalAgentIds.size > 1) {
      indexes.forEach((index) => sources[index].sourceIssues.push('alias-collision'));
    }
  }

  return sources.map((source) => ({
    ...source,
    sourceIssues: dedupeAndSort(source.sourceIssues) as Array<'duplicate-canonical-agent-id' | 'alias-collision'>,
  }));
}

function primarySourceIssue(source: DeclaredPromptSource): PromptRuntimeContractMetadataParityStatus | null {
  if (source.sourceIssues.includes('duplicate-canonical-agent-id')) return 'duplicate-canonical-agent-id';
  if (source.sourceIssues.includes('alias-collision')) return 'alias-collision';
  return null;
}

/**
 * Pure parity analysis. It never fills defaults for invalid declarations and never mutates input rows.
 */
export function analyzePromptRuntimeContractMetadataParity(
  input: PromptRuntimeContractMetadataParityAnalysisInput
): PromptRuntimeContractMetadataParityReport {
  const sources = buildDeclaredSources(input.files);
  const sortedRows = sortRows(input.activeRows);
  const results: PromptRuntimeContractMetadataParityResult[] = [];

  for (const source of sources) {
    let declaredContract: RuntimeContract;
    try {
      declaredContract = normalizeDeclaredPromptRuntimeContract(source.file.runtimeContract, toIdentity(source.file));
    } catch (error) {
      results.push({
        agentId: source.agentId,
        filePath: source.file.filePath,
        acceptableAgentIds: source.acceptableAgentIds,
        status: 'invalid-file-declaration',
        ...(source.sourceIssues.length > 0 ? { sourceIssues: source.sourceIssues } : {}),
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const sourceIssue = primarySourceIssue(source);
    if (sourceIssue) {
      results.push({
        agentId: source.agentId,
        filePath: source.file.filePath,
        acceptableAgentIds: source.acceptableAgentIds,
        status: sourceIssue,
        sourceIssues: source.sourceIssues,
        declaredContract,
      });
      continue;
    }

    const activeRows = sortedRows.filter((row) => source.acceptedAgentIds.includes(row.agentId));
    if (activeRows.length === 0) {
      results.push({
        agentId: source.agentId,
        filePath: source.file.filePath,
        acceptableAgentIds: source.acceptableAgentIds,
        status: 'missing-active',
        declaredContract,
      });
      continue;
    }
    if (activeRows.length > 1) {
      results.push({
        agentId: source.agentId,
        filePath: source.file.filePath,
        acceptableAgentIds: source.acceptableAgentIds,
        status: 'ambiguous-active',
        activePrompts: activeRows.map(promptReference),
        declaredContract,
      });
      continue;
    }

    const active = activeRows[0];
    if (active.agentId !== source.agentId) {
      results.push({
        agentId: source.agentId,
        filePath: source.file.filePath,
        acceptableAgentIds: source.acceptableAgentIds,
        status: 'active-alias-not-canonical',
        activePrompt: promptReference(active),
        declaredContract,
      });
      continue;
    }

    const activeMetadata = parseActivePromptRuntimeContractMetadata(active.metadata, toIdentity(source.file));
    if (activeMetadata.status !== 'valid') {
      results.push({
        agentId: source.agentId,
        filePath: source.file.filePath,
        acceptableAgentIds: source.acceptableAgentIds,
        status: activeMetadata.status,
        ...(activeMetadata.detail ? { detail: activeMetadata.detail } : {}),
        activePrompt: promptReference(active),
        declaredContract,
      });
      continue;
    }

    results.push({
      agentId: source.agentId,
      filePath: source.file.filePath,
      acceptableAgentIds: source.acceptableAgentIds,
      status: structurallyEqualRuntimeContracts(declaredContract, activeMetadata.contract) ? 'in-sync' : 'mismatch',
      activePrompt: promptReference(active),
      declaredContract,
      activeContract: activeMetadata.contract,
    });
  }

  const sortedResults = results.sort((left, right) => {
    const byAgentId = compareText(left.agentId, right.agentId);
    return byAgentId !== 0 ? byAgentId : compareText(left.filePath, right.filePath);
  });
  const diagnostics = [...(input.diagnostics || [])].sort((left, right) => {
    const byPath = compareText(left.filePath, right.filePath);
    return byPath !== 0 ? byPath : compareText(left.code, right.code);
  });
  const statuses: Record<string, number> = {};
  for (const result of sortedResults) statuses[result.status] = (statuses[result.status] || 0) + 1;
  const sortedStatuses = Object.fromEntries(Object.entries(statuses).sort(([left], [right]) => compareText(left, right)));
  const inSyncCount = sortedResults.filter((result) => result.status === 'in-sync').length;
  const errorCount = diagnostics.length + sortedResults.length - inSyncCount;

  return {
    diagnostics,
    results: sortedResults,
    summary: {
      scannedFiles: input.files.length,
      declaredRuntimeContractFiles: sources.length,
      skippedFilesWithoutRuntimeContract: input.files.length - sources.length,
      diagnosticCount: diagnostics.length,
      resultCount: sortedResults.length,
      inSyncCount,
      errorCount,
      statuses: sortedStatuses,
    },
    hasErrors: errorCount > 0,
  };
}

export async function checkPromptRuntimeContractMetadataParity(
  prisma: PromptRuntimeContractMetadataParityQueryAdapter,
  scan: PromptFileScanResult = scanPromptFiles()
): Promise<PromptRuntimeContractMetadataParityReport> {
  const activeRows = await queryActivePromptRuntimeContractMetadataRows(
    prisma,
    collectDeclaredPromptRuntimeContractAgentIdCandidates(scan.files)
  );
  return analyzePromptRuntimeContractMetadataParity({
    files: scan.files,
    activeRows,
    diagnostics: scan.diagnostics,
  });
}

export function assertCheckOnlyPromptRuntimeContractParityArgs(argv: string[]): void {
  if (argv.includes('--apply')) {
    throw new Error('This runtime-contract parity checker is read-only; --apply is not supported.');
  }
  if (argv.length > 0) {
    throw new Error(`This runtime-contract parity checker accepts no flags: ${argv.join(' ')}`);
  }
}

async function main(): Promise<void> {
  assertCheckOnlyPromptRuntimeContractParityArgs(process.argv.slice(2));
  const report = await checkPromptRuntimeContractMetadataParity(systemPrisma);
  console.log(JSON.stringify(report, null, 2));
  if (report.hasErrors) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.log(JSON.stringify({
        hasErrors: true,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2));
      process.exitCode = 1;
    })
    .finally(async () => {
      await systemPrisma.$disconnect();
    });
}
