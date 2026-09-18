/**
 * 生成 Agent 自述手册 prompts/AGENTS_SELF_INTRO.md（升级方向 Q5，纳入版本控制）
 *
 * 定位：面向"手册读者"的人话自述（区别于 prompts/agent-snapshots.md —— 那是面向
 * 写 Prompt 的人的接口说明书）。每个核心提示单元（prompts/core/<skillId>.yaml，即
 * 编译产物「## 身份」块的来源）一节：
 *   - 我是谁（identity 原文）
 *   - 我读什么（channels + inputs）
 *   - 我写什么（fields）
 *   - 我与谁协作（orchestration 字段路由 routings.handoff）
 *   - 我的边界（constraints）
 * 并给出 skillId 与阶段（stage）。
 *
 * 数据源（全部只读）：
 *   - prompts/core/*.yaml              → identity / channels / inputs / fields / constraints
 *   - prompts/orchestration/*.yaml     → stage / routings.handoff（阶段顺序）
 *   - prompts/skills.yaml              → 阶段归属 / 展示名 / kind（stage 兜底）
 *
 * 阶段编排 Agent（goal-agent / path-agent / teaching-agent / profile-agent /
 * simulation-agent）不单列：它们是 Skill 的编排容器，不持有 core.yaml 身份；
 * 其职责与交接通过成员 Skill 的「我与谁协作」体现。
 *
 * 运行方式（backend 目录）：
 *   npx ts-node --transpile-only src/scripts/generate-agents-self-intro.ts           # 生成
 *   npx ts-node --transpile-only src/scripts/generate-agents-self-intro.ts --check   # 漂移校验（不一致退出 1）
 * 已挂 npm script：`npm run prompts:self-intro` / `npm run prompts:self-intro:check`。
 *
 * 纯函数（buildSelfIntroSections / renderSelfIntro）与文件系统解耦，单元测试用内联
 * 夹具直接断言小节形状与确定性输出；CLI 入口 main() 受 require.main 守卫，import
 * 不产生写盘副作用（对齐 generate-agent-snapshots 的 C6 修复）。
 */

import fs from 'fs';
import path from 'path';
import { scanCoreFiles, type CoreInputRef } from '../services/prompt-lab/core-file-loader';
import { loadOrchestrationFiles } from '../services/field-routing/orchestration-file';
import { loadSkillsFile, type SkillEntry } from '../services/skill-registry/skills-file';

/* -------------------------------------------------------------------------- */
/* 纯函数输入类型（单元测试夹具与 CLI 采集共用）                                  */
/* -------------------------------------------------------------------------- */

export interface SelfIntroInputDecl {
  name?: string;
  type?: string;
  ref: string;
  desc?: string;
  note?: string;
}

export interface SelfIntroFieldDecl {
  name: string;
  type: string;
  desc: string;
  /** 当轮消费即弃（core fields 的 turn 标记） */
  turn: boolean;
}

export interface SelfIntroCoreInput {
  skillId: string;
  identity: string;
  channels: string[];
  inputs: SelfIntroInputDecl[];
  fields: SelfIntroFieldDecl[];
  constraints: string[];
  baseVersion?: number;
}

export interface SelfIntroRegistryEntry {
  skillId: string;
  kind: string;
  stage?: string;
  parentAgent?: string;
  /** skills.yaml coordinator.agentId（aux Skill 的阶段归属兜底；与 parentAgent 二选一） */
  coordinatorAgent?: string;
  displayName?: string;
  description?: string;
}

export interface SelfIntroRouting {
  agentId: string;
  fieldId: string;
  handoff: string[];
}

export interface SelfIntroOrchestration {
  stage: string;
  order?: number;
  displayName?: string;
  description?: string;
  /** contracts 的 agentId 列表（含 skill:<id> 与阶段 Agent id） */
  contracts: string[];
  routings: SelfIntroRouting[];
}

export interface SelfIntroSources {
  cores: SelfIntroCoreInput[];
  registry: SelfIntroRegistryEntry[];
  orchestration: SelfIntroOrchestration[];
}

/** 一个核心提示单元的自述小节（结构化，渲染前的稳定中间形态） */
export interface SelfIntroSection {
  skillId: string;
  displayName: string;
  kind?: string;
  stage?: string;
  stageDisplayName?: string;
  parentAgent?: string;
  baseVersion?: number;
  identity: string;
  channels: string[];
  inputs: SelfIntroInputDecl[];
  fields: SelfIntroFieldDecl[];
  /** 去重后的下游交接对象（保持声明顺序） */
  handoff: string[];
  constraints: string[];
}

/* -------------------------------------------------------------------------- */
/* 纯函数：构建小节 + 渲染 Markdown                                             */
/* -------------------------------------------------------------------------- */

const SKILL_PREFIX = 'skill:';

function stripSkillPrefix(agentId: string): string {
  return agentId.startsWith(SKILL_PREFIX) ? agentId.slice(SKILL_PREFIX.length) : agentId;
}

/**
 * 把数据源装配为确定性排序的小节列表。
 * 排序键：阶段业务顺序（orchestration.order）→ skills.yaml 登记顺序 → skillId。
 * 阶段归属优先级：skills.yaml.stage → 编排 contracts/routings → coordinator/parent Agent 所属阶段。
 */
export function buildSelfIntroSections(sources: SelfIntroSources): SelfIntroSection[] {
  const registryById = new Map(sources.registry.map((entry) => [entry.skillId, entry]));
  const registryIndex = new Map(sources.registry.map((entry, index) => [entry.skillId, index]));
  const stageOrder = new Map<string, number>();
  const stageMeta = new Map<string, SelfIntroOrchestration>();
  const agentStage = new Map<string, string>();
  const skillStage = new Map<string, string>();

  sources.orchestration.forEach((stage, index) => {
    stageOrder.set(stage.stage, stage.order ?? index + 1);
    stageMeta.set(stage.stage, stage);
    for (const agentId of stage.contracts) {
      if (!agentStage.has(agentId)) agentStage.set(agentId, stage.stage);
      const skillId = stripSkillPrefix(agentId);
      if (agentId.startsWith(SKILL_PREFIX) && !skillStage.has(skillId)) skillStage.set(skillId, stage.stage);
    }
    for (const routing of stage.routings) {
      if (!agentStage.has(routing.agentId)) agentStage.set(routing.agentId, stage.stage);
      if (routing.agentId.startsWith(SKILL_PREFIX)) {
        const skillId = stripSkillPrefix(routing.agentId);
        if (!skillStage.has(skillId)) skillStage.set(skillId, stage.stage);
      }
    }
  });

  const sections = sources.cores.map((core): SelfIntroSection => {
    const meta = registryById.get(core.skillId);
    const stage =
      meta?.stage ??
      skillStage.get(core.skillId) ??
      (meta?.coordinatorAgent ? agentStage.get(meta.coordinatorAgent) : undefined) ??
      (meta?.parentAgent ? agentStage.get(meta.parentAgent) : undefined);

    const handoff: string[] = [];
    const seenHandoff = new Set<string>();
    for (const stage of sources.orchestration) {
      for (const routing of stage.routings) {
        if (routing.agentId !== `${SKILL_PREFIX}${core.skillId}`) continue;
        for (const target of routing.handoff) {
          if (seenHandoff.has(target)) continue;
          seenHandoff.add(target);
          handoff.push(target);
        }
      }
    }

    return {
      skillId: core.skillId,
      displayName: meta?.displayName || core.skillId,
      kind: meta?.kind,
      stage,
      stageDisplayName: stage ? stageMeta.get(stage)?.displayName : undefined,
      parentAgent: meta?.parentAgent,
      baseVersion: core.baseVersion,
      identity: core.identity,
      channels: [...core.channels],
      inputs: [...core.inputs],
      fields: [...core.fields],
      handoff,
      constraints: [...core.constraints],
    };
  });

  return sections.sort((a, b) => {
    const orderA = a.stage ? stageOrder.get(a.stage) ?? 999 : 1000;
    const orderB = b.stage ? stageOrder.get(b.stage) ?? 999 : 1000;
    if (orderA !== orderB) return orderA - orderB;
    const indexA = registryIndex.get(a.skillId) ?? Number.MAX_SAFE_INTEGER;
    const indexB = registryIndex.get(b.skillId) ?? Number.MAX_SAFE_INTEGER;
    if (indexA !== indexB) return indexA - indexB;
    return a.skillId.localeCompare(b.skillId);
  });
}

/** 单行化：折叠换行/连续空白，供 Markdown 列表项使用 */
function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function renderStageLabel(section: SelfIntroSection): string {
  if (!section.stage) return '—（辅助 Skill，未归属主链阶段）';
  return section.stageDisplayName
    ? `\`${section.stage}\`（${section.stageDisplayName}）`
    : `\`${section.stage}\``;
}

function renderInputLine(input: SelfIntroInputDecl): string {
  const typeLabel = input.type ? `\`${input.type}\`` : 'type 未声明';
  const detail = input.desc || input.note;
  const tail = detail ? `：${inline(detail)}` : '';
  if (input.name) {
    return `  - \`${input.name}\`（${typeLabel}；来源 \`${input.ref}\`）${tail}`;
  }
  return `  - \`${input.ref}\`（${typeLabel}）${tail}`;
}

function renderFieldLine(field: SelfIntroFieldDecl): string {
  const turnLabel = field.turn ? '，当轮' : '';
  return `- \`${field.name}\`（\`${field.type}\`${turnLabel}）：${inline(field.desc)}`;
}

/** 渲染完整手册正文（确定性：同一输入恒同输出） */
export function renderSelfIntro(sections: SelfIntroSection[]): string {
  const lines: string[] = [];
  lines.push('# Agent 自述手册（自动生成，勿手改）');
  lines.push('');
  lines.push('> 生成命令：`npm run prompts:self-intro`（backend）；漂移校验：`npm run prompts:self-intro:check`。');
  lines.push('> 直接命令：`npx ts-node --transpile-only src/scripts/generate-agents-self-intro.ts`。');
  lines.push('> 数据源：`prompts/core/*.yaml`（identity / channels / inputs / fields / constraints）');
  lines.push('> + `prompts/orchestration/*.yaml`（stage / routings.handoff）+ `prompts/skills.yaml`（阶段归属与展示名）。');
  lines.push('> 每个核心提示单元（Skill / Agent）一节；阶段编排 Agent 不单列，其职责经成员 Skill 的「我与谁协作」体现。');
  lines.push('> 改动任一数据源后请重新生成并提交，CI 用 `--check` 校验产物漂移。');
  lines.push('');

  lines.push('## 目录');
  lines.push('');
  lines.push('| # | 单元 | 阶段 | 类型 | 父级 Agent |');
  lines.push('|---|---|---|---|---|');
  sections.forEach((section, index) => {
    const stage = section.stage ? `\`${section.stage}\`` : '—';
    const kind = section.kind ? `\`${section.kind}\`` : '—';
    const parent = section.parentAgent ? `\`${section.parentAgent}\`` : '—';
    lines.push(`| ${index + 1} | ${section.displayName}（\`${section.skillId}\`） | ${stage} | ${kind} | ${parent} |`);
  });
  lines.push('');

  for (const section of sections) {
    lines.push(`## ${section.displayName}（${section.skillId}）`);
    lines.push('');
    lines.push(`- **单元 ID（skillId）**：\`${section.skillId}\``);
    lines.push(`- **阶段（stage）**：${renderStageLabel(section)}`);
    lines.push(`- **类型（kind）**：${section.kind ? `\`${section.kind}\`` : '—'}`);
    lines.push(`- **父级 Agent**：${section.parentAgent ? `\`${section.parentAgent}\`` : '—'}`);
    lines.push(`- **版本（baseVersion）**：${section.baseVersion ?? '—'}`);
    lines.push('');

    lines.push('### 我是谁');
    lines.push('');
    lines.push(section.identity);
    lines.push('');

    lines.push('### 我读什么');
    lines.push('');
    lines.push(`- **材料通道（channels）**：${section.channels.length ? section.channels.map((c) => `\`${c}\``).join('、') : '—'}`);
    if (section.inputs.length === 0) {
      lines.push('- **输入声明**：无（仅使用上述材料通道）。');
    } else {
      lines.push('- **输入声明**：');
      for (const input of section.inputs) lines.push(renderInputLine(input));
    }
    lines.push('');

    lines.push('### 我写什么');
    lines.push('');
    if (section.fields.length === 0) {
      lines.push('- 无字段声明。');
    } else {
      for (const field of section.fields) lines.push(renderFieldLine(field));
    }
    lines.push('');

    lines.push('### 我与谁协作');
    lines.push('');
    lines.push(
      section.handoff.length
        ? `- **下游交接（handoff）**：${section.handoff.map((t) => `\`${t}\``).join('、')}`
        : '- **下游交接（handoff）**：无（字段不跨单元交付）。',
    );
    lines.push('');

    lines.push('### 我的边界');
    lines.push('');
    if (section.constraints.length === 0) {
      lines.push('- 无额外约束（以 identity 与字段描述为准）。');
    } else {
      for (const constraint of section.constraints) lines.push(`- ${inline(constraint)}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('> 本文件由 `npm run prompts:self-intro` 生成。');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* CLI 适配层：读取只读数据源并装配                                             */
/* -------------------------------------------------------------------------- */

function toInputDecl(input: CoreInputRef): SelfIntroInputDecl {
  return {
    name: input.name,
    type: input.type,
    ref: input.ref,
    desc: input.desc,
    note: input.note,
  };
}

function toRegistryEntry(entry: SkillEntry): SelfIntroRegistryEntry {
  return {
    skillId: entry.skillId,
    kind: entry.kind,
    stage: entry.stage,
    parentAgent: entry.parentAgent,
    coordinatorAgent: entry.coordinator?.agentId,
    displayName: entry.displayName,
    description: entry.description,
  };
}

/** 读取 core + orchestration + skills.yaml，装配纯函数输入（只读，无写盘） */
export function collectSelfIntroSources(): SelfIntroSources {
  const { files, diagnostics } = scanCoreFiles();
  if (diagnostics.length > 0) {
    throw new Error(
      `[generate-agents-self-intro] prompts/core 存在非法文件，拒绝生成（${diagnostics.length} 条）：` +
        diagnostics.map((d) => `${d.filePath}(${d.code})`).join('; '),
    );
  }

  const stages = loadOrchestrationFiles();
  const book = loadSkillsFile();

  return {
    cores: files.map((core) => ({
      skillId: core.skillId,
      identity: core.identity,
      channels: core.channels,
      inputs: (core.inputs ?? []).map(toInputDecl),
      fields: core.fields.map((field) => ({
        name: field.name,
        type: field.type,
        desc: field.desc,
        turn: field.turn,
      })),
      constraints: core.constraints,
      baseVersion: core.baseVersion,
    })),
    registry: book.skills.map(toRegistryEntry),
    orchestration: stages.map((stage) => ({
      stage: stage.stage,
      order: stage.order,
      displayName: stage.displayName,
      description: stage.description,
      contracts: stage.contracts.map((contract) => contract.agentId),
      routings: stage.routings.map((routing) => ({
        agentId: routing.agentId,
        fieldId: routing.fieldId,
        handoff: routing.handoff,
      })),
    })),
  };
}

/** 渲染自述手册正文（health-center 复检与 CLI --check 共用同一实现） */
export function generateAgentsSelfIntroContent(): string {
  return renderSelfIntro(buildSelfIntroSections(collectSelfIntroSources()));
}

export const AGENTS_SELF_INTRO_TARGET = path.resolve(__dirname, '../../../prompts/AGENTS_SELF_INTRO.md');

/** 自述手册漂移检测：渲染正文 vs 磁盘产物（--check 共用同一实现） */
export function checkAgentsSelfIntroDrift(
  target = AGENTS_SELF_INTRO_TARGET,
): { drifted: boolean; detail: string } {
  const content = generateAgentsSelfIntroContent();
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
  if (existing !== content) {
    return {
      drifted: true,
      detail: 'prompts/AGENTS_SELF_INTRO.md 与 core/orchestration/skills 声明不一致，请重新生成并提交',
    };
  }
  return { drifted: false, detail: 'AGENTS_SELF_INTRO.md 与声明一致' };
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes('--check');
  const target = AGENTS_SELF_INTRO_TARGET;

  if (checkMode) {
    const report = checkAgentsSelfIntroDrift(target);
    if (report.drifted) {
      console.error(`[generate-agents-self-intro] 自述手册漂移：${report.detail}`);
      process.exit(1);
    }
    console.log(report.detail);
    return;
  }

  const content = generateAgentsSelfIntroContent();
  fs.writeFileSync(target, content, 'utf-8');
  console.log(`已生成 ${target}`);
}

// require.main 守卫：import 该模块（测试/复检等只读消费方）不触发写盘。
if (require.main === module) {
  main().catch((error) => {
    console.error('[generate-agents-self-intro] 失败', error);
    process.exit(1);
  });
}
