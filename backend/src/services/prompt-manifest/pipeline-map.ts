/**
 * 全管线导出（场景 → Agent → Skill/Prompt）。
 *
 * 目的：把三份 File-as-Truth 拼成一张可读、可机器消费的全景图——
 *   - prompts/skills.yaml          skill 户口簿（kind / stage / parentAgent / handler / coreFile / 挂接点）
 *   - prompts/orchestration/*.yaml 每阶段 Agent 与字段路由（contracts / fields / routings）
 *   - prompts/core/*.yaml + manifests/*.yaml  提示词正文与契约
 *   - coordinators/*.definition.ts 各 Agent 的步骤顺序（代码里的编排真相）
 *
 * 组织口径（2026-10-29 拍板）：**场景为一级轴，Agent 为二级轴，Prompt 为三级轴**。
 * 原因：运行时是按阶段推进的状态机，编排文件也按阶段拆分；而 path-reviewer / kc-mapper /
 * learning-predictor 等 Skill 由 service 侧越步调用，只看 Agent steps 会漏掉真实调用点。
 * Agent 维度的"为什么"仍以 doc/AGENT_SKILL_MANUAL.md 为准，本文件只回答 what / who / where。
 */
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { goalAgentRuntimeDefinition } from '../../coordinators/goal.definition';
import { pathAgentRuntimeDefinition } from '../../coordinators/path.definition';
import { AITeachingCoordinatorRuntimeDefinition } from '../../coordinators/ai-teaching.definition';
import { learnerAgentRuntimeDefinition } from '../../coordinators/learner.definition';
import { simulationAgentRuntimeDefinition } from '../../coordinators/simulation.definition';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PROMPTS_DIR = path.join(ROOT, 'prompts');

/** coordinators/*.definition.ts 里 steps 条目的最小形状视图（运行时编排声明；type 别名带隐式索引签名，可直接入 Record<string, unknown>[]） */
type OrchestratorStep = {
  step?: number;
  agentId?: string;
  kind?: string;
  impl?: string;
  role?: string;
  condition?: string;
  loopOver?: string;
}

/** coordinators/*.definition.ts 的最小形状视图（运行时编排声明） */
interface OrchestratorDefinition {
  id: string;
  displayName: string;
  description: string;
  variableGraph?: Record<string, string[]>;
  steps?: OrchestratorStep[];
}

const ORCHESTRATORS: Array<OrchestratorDefinition> = [
  goalAgentRuntimeDefinition,
  pathAgentRuntimeDefinition,
  AITeachingCoordinatorRuntimeDefinition,
  learnerAgentRuntimeDefinition,
  simulationAgentRuntimeDefinition,
];

/** 阶段 → Agent：一个阶段一个主 Agent（profile 为横切，simulation 为旁路） */
const STAGE_AGENT: Record<string, string> = {
  goal: 'goal-agent',
  path: 'path-agent',
  teaching: 'teaching-agent',
  profile: 'profile-agent',
  simulation: 'simulation-agent',
};

/**
 * 代码入口（人工维护的少量索引）：指向真正驱动该阶段的执行体。
 * 判据：能在该文件里找到阶段推进/循环，而不是只做类型定义。
 */
const CODE_ENTRY: Record<string, Array<{ label: string; file: string }>> = {
  goal: [
    { label: '真实用户 Goal 对话（多轮状态机）', file: 'backend/src/services/learning/goal-conversation.service.ts' },
    { label: 'Goal → Path handoff（确定性定帧）', file: 'backend/src/coordinators/path.coordinator.ts' },
  ],
  path: [
    { label: '路径生成主链（path-planning → stage-designer）', file: 'backend/src/services/learning/generation/path-generation.core.ts' },
    { label: 'Path 协调与 handoff 装配', file: 'backend/src/coordinators/path.coordinator.ts' },
    { label: '路径重排（人工确认制）', file: 'backend/src/services/learning/replan/path-replan.service.ts' },
  ],
  teaching: [
    { label: '教学会话状态机（开课/回合/收束）', file: 'backend/src/services/ai-teaching/AITeachingCoordinator.ts' },
    { label: '课堂上下文构建（五输入通道）', file: 'backend/src/services/ai-teaching/TeachingContextBuilder.ts' },
    { label: '教学回合引擎（teaching-turn 调用点）', file: 'backend/src/services/ai-teaching/teaching-turn-engine.ts' },
    { label: '课后重排建议', file: 'backend/src/services/ai-teaching/ReplanAdvisoryService.ts' },
  ],
  profile: [
    { label: 'outbox 事件消费注册', file: 'backend/src/bootstrap/schedulers.ts' },
    { label: '学习者快照刷新', file: 'backend/src/services/learner/LearnerSnapshotRefreshService.ts' },
    { label: '长期记忆写回', file: 'backend/src/virtual-lab/learner-memory.ts' },
  ],
  simulation: [
    { label: '仿真执行体（Goal/Path/Learn 驱动）', file: 'backend/src/coordinators/simulation.execution.ts' },
    { label: '自动驾驶（后台长任务/并发/恢复）', file: 'backend/src/virtual-lab/autopilot.service.ts' },
    { label: '旁路裁判/保真审计入口', file: 'backend/src/routes/admin/session-audits.ts' },
  ],
};

/** prompts/core/*.yaml（提示词正文与契约）的最小形状视图 */
interface CoreDoc {
  skillId?: string;
  identity?: unknown;
  channels?: string[];
  inputs?: unknown[];
  fields?: unknown[];
  params?: Record<string, unknown>;
  rules?: unknown[];
  constraints?: unknown[];
  baseVersion?: number;
}

/** manifest promptContract 段的最小形状视图 */
interface ManifestPromptContract {
  executionMode?: string;
  artifactKind?: string;
  interactionMode?: string;
  fields?: Record<string, unknown>;
}

/** manifest runtimeContract 段的最小形状视图 */
interface ManifestRuntimeContract {
  contextMode?: string;
  businessState?: { phases?: string[] };
}

/** prompts/manifests/*.yaml（契约清单）的最小形状视图 */
interface ManifestDoc {
  skillId?: string;
  agentId?: string;
  description?: string;
  __file?: string;
  promptContract?: ManifestPromptContract;
  runtimeContract?: ManifestRuntimeContract;
}

/** prompts/skills.yaml 户口簿条目的最小形状视图 */
interface SkillRegistryEntry {
  skillId: string;
  stage?: string;
  parentAgent?: string;
  coordinator?: { agentId?: string };
  kind?: string;
  displayName?: string;
  description?: string;
  coreFile?: string;
}

function readYaml(file: string): Record<string, unknown> {
  return (yaml.load(fs.readFileSync(file, 'utf8')) as Record<string, unknown>) || {};
}

function listYaml(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_') && f !== 'README.md')
    .sort();
}

function oneLine(text: unknown, max = 90): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const CONDITIONAL_RULE_LEAD = /^(?:若输入提供|如果输入提供|若 classroomEventContext)/;

function identityLine(core: CoreDoc): string {
  const raw = String(core?.identity || '').trim();
  if (!raw) return '';
  const first = raw.split('\n').map((x) => x.trim()).find(Boolean) || '';
  let s = first.replace(/^你是\s*/, '').trim();
  const quoted = s.match(/^[“"]([^”"]+)[”"]/);
  if (quoted) s = quoted[1] + s.slice(quoted[0].length);
  return oneLine(s, 80);
}

export interface PipelinePrompt {
  skillId: string;
  stage: string | null;
  agentId: string | null;
  kind: string | null;
  displayName: string;
  description: string;
  coreFile: string | null;
  manifestFile: string | null;
  hasCore: boolean;
  hasManifest: boolean;
  baseVersion: number | null;
  channels: string[];
  identity: string;
  inputs: number;
  outputs: number;
  params: Record<string, unknown> | null;
  executionMode: string | null;
  artifactKind: string | null;
  interactionMode: string | null;
  contractFields: number;
  /** core.yaml 的 rules / constraints 条数（条件规则按 teaching-turn 同款前缀判定） */
  ruleCount: number;
  constraintCount: number;
  conditionalRuleCount: number;
  phases: string[];
  contextMode: string | null;
  /** 该 Skill 实际被哪些阶段引用（含跨阶段复用，如 goal-conversation 同时属 goal/simulation） */
  usedInStages: string[];
}

export interface PipelineStage {
  stage: string;
  order: number | null;
  displayName: string;
  description: string;
  orchestrationFile: string;
  contracts: string[];
  fieldCount: number;
  routingCount: number;
  codeEntry: Array<{ label: string; file: string }>;
  agents: Array<{
    id: string;
    displayName: string;
    description: string;
    variableGraph: Record<string, string[]>;
    steps: Array<Record<string, unknown>>;
    memberSkills: string[];
  }>;
  skills: Array<{
    skillId: string;
    kind: string;
    parentAgent: string | null;
    displayName: string;
    description: string;
    coreFile: string | null;
    inAgentSteps: boolean;
    step: number | null;
    role: string | null;
    condition: string | null;
    loopOver: string | null;
    callSite: string;
  }>;
  prompts: PipelinePrompt[];
}

export interface PipelineMap {
  version: 1;
  sources: string[];
  stages: PipelineStage[];
  prompts: PipelinePrompt[];
  orphanPrompts: Array<{ skillId: string; manifestFile: string; coreFile: string | null }>;
  /** 只有 prompts/skill.<id>.md 编译产物、既无 core/manifest 也未进 skills.yaml 的条目 */
  compiledOnlyPrompts: Array<{ skillId: string; promptFile: string }>;
  skillsWithoutPrompt: Array<{ skillId: string; kind: string; displayName: string; reason: string }>;
  counts: {
    skills: number;
    byKind: Record<string, number>;
    prompts: number;
    mainline: number;
    aux: number;
    handlerOnly: number;
  };
}

export function buildPipelineMap(): PipelineMap {
  const registry = readYaml(path.join(PROMPTS_DIR, 'skills.yaml'));
  const skills: SkillRegistryEntry[] = Array.isArray(registry.skills) ? (registry.skills as SkillRegistryEntry[]) : [];

  const cores = new Map<string, CoreDoc>();
  for (const f of listYaml(path.join(PROMPTS_DIR, 'core'))) {
    const core = readYaml(path.join(PROMPTS_DIR, 'core', f)) as CoreDoc;
    cores.set(core.skillId || f.replace(/\.ya?ml$/, ''), core);
  }
  const manifests = new Map<string, ManifestDoc>();
  for (const f of listYaml(path.join(PROMPTS_DIR, 'manifests'))) {
    const man = readYaml(path.join(PROMPTS_DIR, 'manifests', f)) as ManifestDoc;
    manifests.set(man.skillId || f.replace(/\.ya?ml$/, ''), { ...man, __file: `prompts/manifests/${f}` });
  }

  const skillById = new Map(skills.map((s) => [s.skillId, s]));
  const promptFor = (skillId: string): PipelinePrompt => {
    const s = skillById.get(skillId) || ({} as SkillRegistryEntry);
    const core = cores.get(skillId);
    const man = manifests.get(skillId);
    const coreFile = s.coreFile || (core ? `prompts/core/${skillId}.yaml` : null);
    const manifestFile = man?.__file || null;
    const pc: ManifestPromptContract = man?.promptContract || {};
    const rc: ManifestRuntimeContract = man?.runtimeContract || {};
    return {
      skillId,
      stage: s.stage || null,
      agentId: s.parentAgent || s.coordinator?.agentId || (man?.agentId && !String(man.agentId).startsWith('skill:') ? man.agentId : null),
      kind: s.kind || null,
      displayName: s.displayName || man?.description || skillId,
      description: s.description || man?.description || '',
      coreFile,
      manifestFile,
      hasCore: Boolean(core),
      hasManifest: Boolean(man),
      baseVersion: core?.baseVersion ?? null,
      channels: Array.isArray(core?.channels) ? core.channels : [],
      identity: identityLine(core),
      inputs: Array.isArray(core?.inputs) ? core.inputs.length : 0,
      outputs: Array.isArray(core?.fields) ? core.fields.length : 0,
      params: core?.params || null,
      executionMode: pc.executionMode || null,
      artifactKind: pc.artifactKind || null,
      interactionMode: pc.interactionMode || null,
      contractFields: Object.keys(pc.fields || {}).length,
      ruleCount: Array.isArray(core?.rules) ? core.rules.length : 0,
      constraintCount: Array.isArray(core?.constraints) ? core.constraints.length : 0,
      conditionalRuleCount: Array.isArray(core?.rules)
        ? core.rules.filter((r: unknown) => CONDITIONAL_RULE_LEAD.test(String(r))).length
        : 0,
      phases: rc?.businessState?.phases || [],
      contextMode: rc?.contextMode || null,
      usedInStages: [],
    };
  };

  const stages: PipelineStage[] = [];
  for (const f of listYaml(path.join(PROMPTS_DIR, 'orchestration'))) {
    const o = readYaml(path.join(PROMPTS_DIR, 'orchestration', f));
    const stage = String(o.stage || f.replace(/\.ya?ml$/, ''));
    const agentId = STAGE_AGENT[stage];
    const orchestrator = ORCHESTRATORS.find((x) => x.id === agentId);
    const steps: OrchestratorStep[] = Array.isArray(orchestrator?.steps) ? orchestrator.steps : [];
    const stepBySkill = new Map<string, OrchestratorStep>();
    for (const st of steps) {
      const m = String(st.agentId || '').match(/^skill:(.+)$/);
      if (m) stepBySkill.set(m[1], st);
    }
    const contracts: string[] = ((o.contracts || []) as Array<{ agentId?: unknown }>)
      .map((c) => String(c.agentId || ''))
      .filter(Boolean);
    const contractSkills = contracts
      .map((c) => c.replace(/^skill:/, ''))
      .filter((id) => skillById.has(id));
    const stageSkills = skills.filter(
      (s) =>
        s.stage === stage ||
        contractSkills.includes(s.skillId) ||
        stepBySkill.has(s.skillId),
    );
    const members = skillById.has(agentId) ? [] : skills.filter((s) => s.parentAgent === agentId).map((s) => s.skillId);

    const promptList = stageSkills.map((s) => promptFor(s.skillId)).filter((p) => p.hasCore || p.hasManifest);
    // 不重复：同一 skill 只出现一次
    const seen = new Set<string>();
    const prompts = promptList.filter((p) => (seen.has(p.skillId) ? false : seen.add(p.skillId)));

    stages.push({
      stage,
      order: Number.isFinite(Number(o.order)) ? Number(o.order) : null,
      displayName: String(o.displayName || stage),
      description: String(o.description || ''),
      orchestrationFile: `prompts/orchestration/${f}`,
      contracts,
      fieldCount: Array.isArray(o.fields) ? o.fields.length : 0,
      routingCount: Array.isArray(o.routings) ? o.routings.length : 0,
      codeEntry: CODE_ENTRY[stage] || [],
      agents: orchestrator
        ? [{
            id: orchestrator.id,
            displayName: orchestrator.displayName || orchestrator.id,
            description: orchestrator.description || '',
            variableGraph: orchestrator.variableGraph || {},
            steps,
            memberSkills: members,
          }]
        : [],
      skills: stageSkills.map((s) => {
        const st = stepBySkill.get(s.skillId);
        return {
          skillId: s.skillId,
          kind: s.kind || 'mainline',
          parentAgent: s.parentAgent || null,
          displayName: s.displayName || s.skillId,
          description: s.description || '',
          coreFile: s.coreFile || (cores.has(s.skillId) ? `prompts/core/${s.skillId}.yaml` : null),
          inAgentSteps: Boolean(st),
          step: st ? Number(st.step) : null,
          role: st?.role || null,
          condition: st?.condition || null,
          loopOver: st?.loopOver || null,
          callSite: st ? 'agent steps' : (s.coordinator?.agentId ? `coordinator 登记（${s.coordinator.agentId}）` : 'service 侧内联/旁挂'),
        };
      }),
      prompts,
    });
  }
  stages.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  const allPromptIds = [
    ...skills.map((s) => s.skillId),
    ...[...manifests.keys()].filter((id) => !skillById.has(id)),
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  const usage = new Map<string, string[]>();
  for (const st of stages) {
    for (const sk of st.skills) {
      const list = usage.get(sk.skillId) || [];
      list.push(st.displayName);
      usage.set(sk.skillId, list);
    }
  }

  const prompts = allPromptIds.map((id) => ({
    ...promptFor(id),
    usedInStages: usage.get(id) || [],
  }));
  const orphanPrompts = [...manifests.keys()]
    .filter((id) => !skillById.has(id))
    .map((id) => ({
      skillId: id,
      manifestFile: manifests.get(id).__file,
      coreFile: cores.has(id) ? `prompts/core/${id}.yaml` : null,
    }));

  // 编译产物 prompts/skill.<id>.md：正常应与 core 同源；只剩 .md 说明该 Skill 绕过了户口簿与 core/manifest。
  const compiledOnlyPrompts = fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => /^skill\..+\.md$/.test(f))
    .map((f) => ({ skillId: f.replace(/^skill\./, '').replace(/\.md$/, ''), promptFile: `prompts/${f}` }))
    .filter((x) => !skillById.has(x.skillId) && !cores.has(x.skillId) && !manifests.has(x.skillId));

  const skillsWithoutPrompt = skills
    .filter((s) => !cores.has(s.skillId) && !manifests.has(s.skillId))
    .map((s) => ({
      skillId: s.skillId,
      kind: s.kind || 'unknown',
      displayName: s.displayName || s.skillId,
      reason: s.kind === 'handler-only' ? 'handler-only：无 LLM 提示词，逻辑在代码 handler' : '暂无 core/manifest',
    }));

  const byKind: Record<string, number> = {};
  for (const s of skills) byKind[s.kind || 'unknown'] = (byKind[s.kind || 'unknown'] || 0) + 1;

  return {
    version: 1,
    sources: [
      'prompts/skills.yaml',
      'prompts/orchestration/*.yaml',
      'prompts/core/*.yaml',
      'prompts/manifests/*.yaml',
      'backend/src/coordinators/{goal,path,ai-teaching,learner,simulation}.definition.ts',
      'doc/AGENT_SKILL_MANUAL.md（Agent 维度的"为什么"）',
    ],
    stages,
    prompts,
    orphanPrompts,
    compiledOnlyPrompts,
    skillsWithoutPrompt,
    counts: {
      skills: skills.length,
      byKind,
      prompts: prompts.filter((p) => p.hasCore).length,
      mainline: byKind.mainline || 0,
      aux: byKind.aux || 0,
      handlerOnly: byKind['handler-only'] || 0,
    },
  };
}

function sanitizeCell(text: unknown): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

export function renderPipelineMarkdown(map: PipelineMap): string {
  const L: string[] = [];
  L.push('# 全管线地图：场景 → Agent → Skill/Prompt');
  L.push('');
  L.push('> 📌 生成物｜场景/Agent/Prompt 全景索引（由 `pipeline:map` 生成，勿手改）');
  L.push('>');
  L.push('> 本文件由 `npm --prefix backend run pipeline:map` 从代码与 File-as-Truth 自动生成，**不要手改**。');
  L.push('> 数据源：' + map.sources.map((s) => '`' + s + '`').join('、') + '。');
  L.push('');
  L.push('## 口径：为什么以「场景」为一级轴');
  L.push('');
  L.push('运行时是按阶段推进的状态机（Goal → Path → Teaching），每阶段有自己的编排文件与执行体；');
  L.push('而且 `path-reviewer` / `kc-mapper` / `learning-predictor` / `adaptive-guidance-copy` 等 Skill');
  L.push('是由 service 侧越步调用的，只看 Agent 的 `steps` 会漏掉真实调用点。因此：');
  L.push('');
  L.push('1. **场景（阶段）** 回答"什么时候、按什么顺序发生"；');
  L.push('2. **Agent** 回答"谁拥有字段路由与生命周期"（为什么这样拆见 `doc/AGENT_SKILL_MANUAL.md`）；');
  L.push('3. **Prompt** 回答"具体改哪份文件"（正文唯一源在 `prompts/core/`，本图只做目录与契约索引）。');
  L.push('');
  L.push('机器可读版本：`doc/pipeline-map.json`；提示词正文汇编（原文，按场景归档）：`doc/PIPELINE_PROMPTS.md`。');
  L.push('');
  L.push('```mermaid');
  L.push('flowchart LR');
  const byStage = new Map(map.stages.map((s) => [s.stage, s]));
  const nodeLabel = (stageKey: string, fallbackName: string, fallbackAgent: string, fallbackChain: string): string => {
    const s = byStage.get(stageKey);
    const agent = s?.agents[0]?.id || fallbackAgent;
    const chain = (s?.agents[0]?.steps || [])
      .map((step) => String(step.agentId || ''))
      .filter((id) => id.startsWith('skill:'))
      .map((id) => id.replace(/^skill:/, ''))
      .slice(0, 4)
      .join(' → ') || fallbackChain;
    return `["${s?.displayName || fallbackName}<br/>${agent}<br/>${chain}"]`;
  };
  L.push(`  U[用户 / 虚拟学习者] --> G${nodeLabel('goal', 'Goal 阶段', 'goal-agent', 'goal-conversation')}`);
  L.push(`  G -->|"goal handoff（字段路由）"| P${nodeLabel('path', 'Path 阶段', 'path-agent', 'path-planning → stage-designer')}`);
  L.push(`  P -->|"path ready"| T${nodeLabel('teaching', 'Teaching 阶段', 'teaching-agent', 'opening → teaching-turn → wrapup')}`);
  L.push(`  T -.->|"lesson 事件"| F${nodeLabel('profile', 'Profile 阶段', 'profile-agent', 'learner-model → enricher → snapshot')}`);
  L.push('  F -.->|"LearnerSnapshot / hints"| P');
  L.push('  F -.->|"LearnerSnapshot / hints"| T');
  L.push(`  S${nodeLabel('simulation', 'Simulation 阶段', 'simulation-agent', 'virtual learner / referee')} --> G`);
  L.push('  S --> P');
  L.push('  S --> T');
  L.push('  S -.->|"旁路：只读审计"| R["referee / actor-auditor"]');
  L.push('```');
  L.push('');
  L.push('## 1. 阶段总览');
  L.push('');
  L.push('| # | 阶段 | Agent | 调用顺序（agent steps） | 字段 / 路由 | 编排文件 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of map.stages) {
    const agent = s.agents[0];
    const ordered = s.skills
      .filter((x) => x.inAgentSteps)
      .sort((a, b) => (a.step ?? 99) - (b.step ?? 99))
      .map((x) => '`' + x.skillId + '`')
      .join(' → ');
    L.push(
      `| ${s.order ?? '-'} | ${sanitizeCell(s.displayName)} | ${agent ? '`' + agent.id + '`' : '-'} | ${ordered || '-'} | ${s.fieldCount} / ${s.routingCount} | \`${s.orchestrationFile}\` |`,
    );
  }
  L.push('');
  L.push('> Goal/Path/Teaching 是纵向主链；Profile 是横切状态层（事件驱动）；Simulation 是目标函数相反的验证旁路。');
  L.push('');

  L.push('## 2. 分阶段详情');
  L.push('');
  for (const s of map.stages) {
    L.push(`### ${s.order ?? '-'}. ${s.displayName}（\`${s.stage}\`）`);
    L.push('');
    L.push(s.description);
    L.push('');
    if (s.agents.length) {
      const a = s.agents[0];
      L.push(`- **Agent**：\`${a.id}\` — ${a.displayName}`);
      L.push(`- **编排声明**：\`${s.orchestrationFile}\`（${s.fieldCount} 字段 / ${s.routingCount} 条路由）`);
      L.push('- **代码入口**：');
      for (const e of s.codeEntry) L.push(`  - ${e.label}：\`${e.file}\``);
      L.push('');
      L.push('| 步 | 节点 | 类型 | 职责 | 条件 | 循环 |');
      L.push('| --- | --- | --- | --- | --- | --- |');
      for (const st of a.steps) {
        const node = String(st.agentId || '');
        const kind = st.kind || (node.startsWith('skill:') ? 'skill' : 'service');
        L.push(
          `| ${st.step ?? '-'} | \`${sanitizeCell(node)}\` | ${kind} | ${sanitizeCell(st.role || st.impl || '')} | ${sanitizeCell(st.condition || '—')} | ${sanitizeCell(st.loopOver || '—')} |`,
        );
      }
      L.push('');
    }
    const stagePrompts = s.prompts;
    if (stagePrompts.length) {
      L.push('| Skill | 类型 | 提示词正文 | 参数 | 输入/输出 | 字段角色 |');
      L.push('| --- | --- | --- | --- | --- | --- |');
      for (const p of stagePrompts) {
        const params = p.params
          ? `temp=${p.params.temperature ?? '-'} / ${p.params.failurePolicy ?? '-'}`
          : '—';
        L.push(
          `| \`${p.skillId}\` | ${p.kind || '-'} | ${p.coreFile ? '`' + p.coreFile + '`' : '—'} | ${params} | ${p.inputs}/${p.outputs} | ${p.contractFields} |`,
        );
      }
      L.push('');
      L.push('> 「字段角色」= manifest `promptContract.fields` 的 direction/visibility 元数据；输出 schema 以 core.yaml 的 `fields` 为准，0 不代表没有输出契约。');
    }
    const side = s.skills.filter((x) => !x.inAgentSteps);
    if (side.length) {
      L.push('**不在 Agent steps 内、但登记在本阶段的 Skill**：');
      for (const x of side) {
        L.push(`- \`${x.skillId}\`（${x.kind}）— ${x.callSite}${x.description ? '：' + x.description : ''}`);
      }
      L.push('');
    }
  }

  L.push('## 3. Prompt 全量清单');
  L.push('');
  L.push(`共 ${map.counts.skills} 个已登记 Skill（mainline ${map.counts.mainline} / aux ${map.counts.aux} / handler-only ${map.counts.handlerOnly}），其中 ${map.counts.prompts} 个有 LLM 提示词正文。`);
  L.push('');
  L.push('| Skill | 所属阶段（含复用） | Agent | 类型 | 规则/约束（条件） | 正文 | Manifest | 身份（首行） |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of map.prompts) {
    L.push(
      `| \`${p.skillId}\` | ${p.usedInStages.length ? p.usedInStages.join('、') : '—'} | ${p.agentId ? '`' + p.agentId + '`' : '—'} | ${p.kind || '—'} | ${p.ruleCount}/${p.constraintCount}${p.conditionalRuleCount ? `（${p.conditionalRuleCount}）` : ''} | ${p.coreFile ? '`' + p.coreFile + '`' : '—'} | ${p.manifestFile ? '`' + p.manifestFile + '`' : '—'} | ${sanitizeCell(p.identity || '—')} |`,
    );
  }
  L.push('');
  L.push('> 提示词正文不复制进本文件：`prompts/core/*.yaml` 是唯一正文源；本表只给路径、参数与 I/O 契约。');
  L.push('');

  if (map.skillsWithoutPrompt.length) {
    L.push('## 4. 无提示词的 Skill（handler-only / 纯代码）');
    L.push('');
    L.push('| Skill | 类型 | 说明 |');
    L.push('| --- | --- | --- |');
    for (const s of map.skillsWithoutPrompt) {
      L.push(`| \`${s.skillId}\` | ${s.kind} | ${sanitizeCell(s.reason)} |`);
    }
    L.push('');
  }

  if (map.orphanPrompts.length) {
    L.push('## 5. 未在 skills.yaml 登记、但仍有 Manifest 的条目');
    L.push('');
    L.push('这些条目不会被 `skills:check` 的户口簿覆盖，属于历史/实验性 Prompt，改动前先确认是否仍在用。');
    L.push('');
    L.push('| Skill | Manifest | 正文 |');
    L.push('| --- | --- | --- |');
    for (const o of map.orphanPrompts) {
      L.push(`| \`${o.skillId}\` | \`${o.manifestFile}\` | ${o.coreFile ? '`' + o.coreFile + '`' : '—'} |`);
    }
    L.push('');
  }

  if (map.compiledOnlyPrompts.length) {
    L.push('## 6. 有编译产物但未登记');
    L.push('');
    L.push('这些条目只有 `prompts/skill.<id>.md`，既没有 `prompts/core/<id>.yaml`，也没有 manifest，且未进 `skills.yaml`；属于绕过 File-as-Truth 的旁路，改动前先确认是否应正式登记。');
    L.push('');
    L.push('| Skill | 编译产物 |');
    L.push('| --- | --- |');
    for (const c of map.compiledOnlyPrompts) {
      L.push(`| \`${c.skillId}\` | \`${c.promptFile}\` |`);
    }
    L.push('');
  }

  L.push('## 7. 维护');
  L.push('');
  L.push('```bash');
  L.push('npm --prefix backend run pipeline:map          # 重新生成 doc/PIPELINE_MAP.md + pipeline-map.json + PIPELINE_PROMPTS.md');
  L.push('npm --prefix backend run pipeline:map:check    # CI：生成结果与仓库内文件不一致则失败');
  L.push('```');
  L.push('');
  L.push('改管线时的顺序：`prompts/skills.yaml`（户口簿）→ `prompts/orchestration/<stage>.yaml`（字段路由）→ `prompts/core/<skill>.yaml`（正文）→ `coordinators/*.definition.ts`（步骤）；四者不一致时以代码与户口簿为准并回写本图。');
  L.push('');
  return L.join('\n');
}

/**
 * 提示词正文汇编：按阶段分组，逐篇嵌入 prompts/core/*.yaml 原文。
 * 不做结构化改写（避免二次解释失真），只保证「拿到这一个文件就能通读全部提示词」。
 */
export function renderPromptsMarkdown(map: PipelineMap): string {
  const L: string[] = [];
  L.push('# 全管线提示词正文汇编（按场景归档）');
  L.push('');
  L.push('> 📌 生成物｜全部提示词原文汇编（由 `pipeline:map` 生成，勿手改）');
  L.push('>');
  L.push('> 本文件由 `npm --prefix backend run pipeline:map` 生成，**不要手改**；唯一正文源是 `prompts/core/*.yaml`。');
  L.push('> 每篇给出所属场景 / Agent / 类型 / 路径 / 参数，然后原样嵌入 core YAML。');
  L.push('> 只想看目录与契约见 `doc/PIPELINE_MAP.md`；机器消费见 `doc/pipeline-map.json`。');
  L.push('');

  const emitted = new Set<string>();
  const pushPrompt = (p: PipelinePrompt): void => {
    if (!p.coreFile || emitted.has(p.skillId)) return;
    emitted.add(p.skillId);
    const raw = fs.readFileSync(path.join(ROOT, p.coreFile), 'utf8').replace(/\s+$/, '');
    const params = p.params
      ? Object.entries(p.params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' / ')
      : '—';
    L.push(`### \`${p.skillId}\` — ${p.displayName}`);
    L.push('');
    L.push(
      `- 场景：${p.usedInStages.length ? p.usedInStages.join('、') : '跨阶段/工具'} ｜ Agent：${p.agentId || '—'} ｜ 类型：${p.kind || '—'}`,
    );
    L.push(`- 正文：\`${p.coreFile}\` ｜ 参数：${params} ｜ baseVersion：${p.baseVersion ?? '—'}`);
    L.push(
      `- 规则：${p.ruleCount} 条（其中条件规则 ${p.conditionalRuleCount} 条）｜ 约束：${p.constraintCount} 条`,
    );
    L.push('');
    L.push('````yaml');
    L.push(raw);
    L.push('````');
    L.push('');
  };

  for (const st of map.stages) {
    const list = map.prompts.filter(
      (p) => p.hasCore && p.coreFile && p.usedInStages.includes(st.displayName) && !emitted.has(p.skillId),
    );
    if (!list.length) continue;
    L.push(`## ${st.order ?? ''}. ${st.displayName}（\`${st.stage}\`）`);
    L.push('');
    if (st.description) {
      L.push(`> ${st.description}`);
      L.push('');
    }
    for (const p of list) pushPrompt(p);
  }

  const rest = map.prompts.filter((p) => p.hasCore && p.coreFile && !emitted.has(p.skillId));
  if (rest.length) {
    L.push('## 跨阶段与工具类 Prompt');
    L.push('');
    for (const p of rest) pushPrompt(p);
  }

  L.push('## 未随包输出的条目');
  L.push('');
  if (map.skillsWithoutPrompt.length) {
    L.push(
      `- 无 LLM 正文的 Skill：${map.skillsWithoutPrompt.map((s) => '`' + s.skillId + '`').join('、')}（代码 handler 实现）`,
    );
  }
  if (map.orphanPrompts.length) {
    L.push(
      `- 未在 \`skills.yaml\` 登记、仅存 Manifest 的条目：${map.orphanPrompts
        .map((o) => '`' + o.skillId + '`')
        .join('、')}（改动前先确认是否仍在用）`,
    );
  }
  if (map.compiledOnlyPrompts.length) {
    L.push(
      `- 只有编译产物、未登记 core/manifest 的条目：${map.compiledOnlyPrompts
        .map((c) => '`' + c.skillId + '`（' + c.promptFile + '）')
        .join('、')}`,
    );
  }
  L.push('');
  return L.join('\n');
}

export function writePipelineMap(outDir: string = path.join(ROOT, 'doc')): { markdownPath: string; jsonPath: string; promptsPath: string } {
  const map = buildPipelineMap();
  const markdownPath = path.join(outDir, 'PIPELINE_MAP.md');
  const jsonPath = path.join(outDir, 'pipeline-map.json');
  const promptsPath = path.join(outDir, 'PIPELINE_PROMPTS.md');
  fs.writeFileSync(markdownPath, renderPipelineMarkdown(map));
  fs.writeFileSync(jsonPath, JSON.stringify(map, null, 2) + '\n');
  fs.writeFileSync(promptsPath, renderPromptsMarkdown(map));
  return { markdownPath, jsonPath, promptsPath };
}
