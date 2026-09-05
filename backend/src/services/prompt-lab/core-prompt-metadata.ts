/**
 * v4 发布版本的 metadata 快照。
 *
 * core.yaml 是业务 SSOT；ACTIVE prompt 保存其原文快照，保证历史版本能够
 * 恢复对应 core，而不只把旧的运行 prompt 写回文件。
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { computeCoreHash, loadCoreFile } from './core-file-loader';
import { normalizeRuntimeContract, type RuntimeContract } from './runtime-contract';
import { normalizeSkillPromptContract, type SkillPromptContract } from '../skill-prompt-contract';
import { PROMPTS_DIR } from '../../composers/prompt-files/loader';

// M3：与 loader 的 PROMPTS_DIR 同源解析（支持 PROMPTS_DIR 环境变量覆盖），
// manifests 位于仓库根 prompts/manifests，避免 process.cwd() 双轨不一致。
const MANIFESTS_DIR = path.join(PROMPTS_DIR, 'manifests');

function loadManifestContracts(skillId: string): {
  runtimeContract: RuntimeContract;
  promptContract: SkillPromptContract;
} | null {
  const filePath = path.join(MANIFESTS_DIR, `${skillId}.yaml`);
  if (!fs.existsSync(filePath)) {
    // manifest 缺失降级为 null（不再 throw），由调用方记录告警；
    // 避免文件已写盘、DB 未写时因 manifest 缺失抛错造成文件与 DB ACTIVE 分叉。
    return null;
  }
  const parsed = (yaml.load(fs.readFileSync(filePath, 'utf-8')) || {}) as Record<string, unknown>;
  const archetype = typeof parsed.archetype === 'string' ? parsed.archetype.trim() : '';
  const runtimeContract = normalizeRuntimeContract(parsed.runtimeContract, { skillId, archetype });
  const promptContract = normalizeSkillPromptContract(parsed.promptContract, {
    skillId,
    archetype,
    runtimeContract,
  });
  return { runtimeContract, promptContract };
}

/** 为 v4 文件/发布版本生成同一份结构化 metadata。 */
export function buildV4CorePromptMetadata(input: {
  skillId: string;
  coreHash: string;
  coreVersion: number;
  deltaOutput?: boolean;
  coreSnapshot?: string;
  developerApprovalReference?: string;
}): string {
  const loaded = loadCoreFile(input.skillId);
  if (!loaded?.core || !loaded.core.filePath) {
    throw new Error(`无法为 ${input.skillId} 读取合法核心文件快照`);
  }
  const actualCoreHash = computeCoreHash(loaded.core);
  if (actualCoreHash !== input.coreHash) {
    throw new Error(
      `拒绝为漂移版本写入 coreSnapshot：${input.skillId} 的 coreHash 与当前核心文件不一致`
    );
  }
  const contracts = loadManifestContracts(input.skillId);
  const coreSnapshot = input.coreSnapshot ?? fs.readFileSync(loaded.core.filePath, 'utf-8');

  return JSON.stringify({
    promptLab: {
      source: 'core-file',
      coreHash: input.coreHash,
      coreVersion: input.coreVersion,
      coreSnapshot,
      ...(input.deltaOutput ? { deltaOutput: true } : {}),
      ...(input.developerApprovalReference
        ? { developerApproval: { reference: input.developerApprovalReference } }
        : {}),
      ...(contracts
        ? {
            runtimeContractSource: 'manifest',
            runtimeContract: contracts.runtimeContract,
            promptContractSource: 'manifest',
            promptContract: contracts.promptContract,
          }
        : {
            // 契约 manifest 缺失：降级标记（原为 throw 阻断），由调用方记录告警
            runtimeContractSource: 'manifest-missing',
            promptContractSource: 'manifest-missing',
          }),
    },
  });
}
