/**
 * 生成沙盘说明书 prompts/agent-snapshots.md（P-A 固化产物，纳入版本控制）
 *
 * 数据源：字段路由编排文件（与运行时 routings 表同源）+ core fields 声明。
 * 运行方式：npx ts-node src/scripts/generate-agent-snapshots.ts
 * CI 校验：生成后 git diff --exit-code（产物漂移即失败）
 */

import fs from 'fs';
import path from 'path';
import { SANDBOX_AGENT_IDS, SANDBOX_EXTRA_KEYS } from '../services/agent-contract-view';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import { loadCoreFieldDeclarations } from '../services/skill-output-validator';

interface SeedRoutingLike {
  agentId: string;
  fieldId: string;
  handoff: string[];
}

// 字段路由声明源：编排文件（seed TS 已退役）；displayName 保留既有展示文案
const STAGES_BY_NAME = new Map(loadOrchestrationFiles().map((s) => [s.stage, s]));
const stageData = (stage: string) => STAGES_BY_NAME.get(stage)!;

const STAGE_SEEDS: Array<{
  agentId: string;
  displayName: string;
  fields: Array<{ fieldId: string; valueType?: string; pathInRawOutput?: string; description: string }>;
  routings: SeedRoutingLike[];
}> = [
  { agentId: 'goal-agent', displayName: '目标 Agent（Goal）', fields: stageData('goal').fields, routings: stageData('goal').routings },
  { agentId: 'path-agent', displayName: '路径 Agent（Path）', fields: stageData('path').fields, routings: stageData('path').routings },
  { agentId: 'teaching-agent', displayName: '教学 Agent（Teaching）', fields: stageData('teaching').fields, routings: stageData('teaching').routings },
  { agentId: 'profile-agent', displayName: '学习者 Agent（Profile）', fields: stageData('profile').fields, routings: stageData('profile').routings },
];

async function resolveType(fieldId: string, ownerAgentId: string, fallbackType?: string): Promise<string> {
  // 字段类型从所属 skill 的 core fields 声明解析（ownerAgentId 形如 skill:goal-conversation 或 goal-agent）
  const skillIds = ownerAgentId.startsWith('skill:')
    ? [ownerAgentId.replace(/^skill:/, '')]
    : (() => {
        // agent 名：尝试其成员 skill（按阶段编排文件的 handoff 推断太绕，直接试常见映射）
        const stage = STAGE_SEEDS.find((s) => s.agentId === ownerAgentId);
        if (!stage) return [];
        const memberSkillIds = new Set<string>();
        for (const row of stage.routings) {
          for (const target of row.handoff) {
            if (target.startsWith('skill:')) memberSkillIds.add(target.replace(/^skill:/, ''));
          }
        }
        return [...memberSkillIds];
      })();
  for (const skillId of skillIds) {
    const core = await loadCoreFieldDeclarations(skillId);
    if (!core) continue;
    // 精确匹配优先（顶层字段）；子路径字段用 seed valueType（更细粒度），core 容器类型仅兜底
    const exact = core.find((f) => f.name === fieldId);
    if (exact && !fieldId.includes('.')) return exact.type;
    if (fallbackType && fieldId.includes('.')) return fallbackType;
    if (exact) return exact.type;
  }
  return fallbackType || 'unknown';
}

async function render(): Promise<string> {
  const lines: string[] = [];
  lines.push('# Agent 沙盘说明书（自动生成，勿手改）');
  lines.push('');
  lines.push('> 生成命令：`npm run prompts:snapshots`（backend）。本文件由字段路由 seed + core fields 声明推导，');
  lines.push('> 供写 Prompt 的同事查阅：每个 Agent 的输入通道与输出字段，以及 `sandbox:` ref 的合法沙盘键。');
  lines.push('> 变更后请重新生成并提交，CI 会校验产物漂移。');
  lines.push('');
  lines.push('## 输入来源分类（ref 前缀 = kind）');
  lines.push('');
  lines.push('| 前缀 | 含义 | 对账 |');
  lines.push('|---|---|---|');
  lines.push('| `skill:<skillId>.<fieldPath>` | 上游 Skill 的模型输出字段 | 校验路由表 handoff |');
  lines.push('| `sandbox:<agentId>.<key>` | 编排层注入/确定性定帧/状态池 | 校验沙盘路径注册表（本文件） |');
  lines.push('| `user:<path>` | 用户/平台注入（对话消息、运行时控制） | 绿灯（自文档化） |');
  lines.push('');

  for (const agentId of SANDBOX_AGENT_IDS) {
    const seed = STAGE_SEEDS.find((s) => s.agentId === agentId);
    const extraKeys = SANDBOX_EXTRA_KEYS[agentId] || [];
    const displayName = seed?.displayName || agentId;
    lines.push(`## ${displayName}（${agentId}）`);
    lines.push('');

    if (seed) {
      // 输入通道：该 agent 名下 handoff 指向成员 skill 的行
      const memberSkills = new Set(
        seed.routings
          .filter((r) => r.agentId === agentId)
          .flatMap((r) => r.handoff)
      );
      const channelRows = seed.routings.filter(
        (r) => r.agentId === agentId && r.handoff.some((target) => target.startsWith('skill:'))
      );
      if (channelRows.length > 0) {
        lines.push('### 输入通道（编排注入 → 成员 skill）');
        lines.push('');
        lines.push('| 沙盘路径 | 字段 | 类型 | 抽取路径 |');
        lines.push('|---|---|---|---|');
        for (const row of channelRows) {
          const field = seed.fields.find((f) => f.fieldId === row.fieldId);
          const type = await resolveType(row.fieldId, row.agentId, field?.valueType);
          lines.push(`| \`sandbox:${agentId}.${row.fieldId}\` | \`${row.fieldId}\` | ${type} | ${field?.pathInRawOutput || '—'} |`);
        }
        lines.push('');
      }

      // 输出字段
      const outputFields = seed.routings
        .filter((r) => r.agentId === agentId || r.agentId.startsWith('skill:'))
        .map((r) => r.fieldId);
      if (outputFields.length > 0) {
        lines.push('### 输出/交付字段');
        lines.push('');
        lines.push('| 字段 | 类型 | handoff |');
        lines.push('|---|---|---|');
        const seen = new Set<string>();
        for (const row of seed.routings.filter((r) => r.agentId === agentId || r.agentId.startsWith('skill:'))) {
          if (seen.has(row.fieldId)) continue;
          seen.add(row.fieldId);
          const field = seed.fields.find((f) => f.fieldId === row.fieldId);
          const type = await resolveType(row.fieldId, row.agentId, field?.valueType);
          lines.push(`| \`${row.fieldId}\` | ${type} | ${row.handoff.join(', ') || '—'} |`);
        }
        lines.push('');
      }
    }

    lines.push('### 合法沙盘键（sandbox: 对账注册表）');
    lines.push('');
    const registeredKeys = new Set<string>();
    if (seed) {
      for (const row of seed.routings.filter((r) => r.agentId === agentId)) {
        registeredKeys.add(row.fieldId);
      }
    }
    for (const key of extraKeys) registeredKeys.add(key);
    lines.push('```');
    for (const key of [...registeredKeys].sort()) {
      lines.push(`sandbox:${agentId}.${key}`);
    }
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('> 本文件由 `npm run prompts:snapshots` 生成。');
  return lines.join('\n');
}

async function main() {
  const content = await render();
  const target = path.resolve(__dirname, '../../../prompts/agent-snapshots.md');
  const checkMode = process.argv.includes('--check');
  if (checkMode) {
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
    if (existing !== content) {
      console.error('[generate-agent-snapshots] 说明书漂移：prompts/agent-snapshots.md 与 seed/core 声明不一致。请运行 npm run prompts:snapshots 重新生成并提交。');
      process.exit(1);
    }
    console.log('agent-snapshots.md 与声明一致');
    return;
  }
  fs.writeFileSync(target, content, 'utf-8');
  console.log(`已生成 ${target}`);
}

main().catch((error) => {
  console.error('[generate-agent-snapshots] 失败', error);
  process.exit(1);
});
