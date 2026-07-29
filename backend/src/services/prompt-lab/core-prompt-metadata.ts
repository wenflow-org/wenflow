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
import { normalizeRuntimeContract } from './runtime-contract';
import { normalizeSkillPromptContract } from '../skill-prompt-contract';

const MANIFESTS_DIR = path.join(process.cwd(), '../prompt-lab/manifests');

function loadManifestContracts(skillId: string) {
  const filePath = path.join(MANIFESTS_DIR, `${skillId}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`v4 skill 缺少契约 manifest: prompt-lab/manifests/${skillId}.yaml`);
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
  const { runtimeContract, promptContract } = loadManifestContracts(input.skillId);
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
      runtimeContractSource: 'manifest',
      runtimeContract,
      promptContractSource: 'manifest',
      promptContract,
    },
  });
}
