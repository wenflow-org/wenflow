/**
 * v4 确定性编译器 —— SKILL_PROTOCOL_V4 §4
 *
 * core.yaml（核心文件）→ 五块结构 Runtime Prompt：
 *   身份 / 使用通道 / 执行规则 / 输出字段 / 边界约束
 *
 * 原则：
 * - 纯函数、确定性渲染，无 LLM 参与；同一 core + 同一 coreVersion 必得同一产物
 * - 字段表逐字渲染（字段冻结在构造上成立）；功能描述即生成指令
 * - JSON 输出格式等包装指令由本编译器全局注入（§4.3），核心文件不承载
 * - LLM 润色编译后置接入；守门检查（结构合法 / 字段冻结）在此提供可复用实现
 */

import yaml from 'js-yaml';
import {
  computeCoreHash,
  type CoreChannel,
  type CoreFile,
} from './core-file-loader';

/** §3.1 六材料池的标准语义描述（平台统一定义一次，全 skill 共享） */
export const CORE_CHANNEL_DESCRIPTIONS: Record<CoreChannel, string> = {
  dialogue: '当前输入与近期对话切片（用于语境理解，不充当状态载体）',
  state: '平台维护的主记忆快照（当前值，含 stage）',
  task: '当前任务 / 场景 / 控制指令',
  evidence: '客观事实轨迹：课堂证据、知识变化、课后总结、运行统计（只读追加）',
  learner: '学习者画像投影（长期特征）',
  path: '路径与确认方案上下文',
};

/** §4.3 编译器全局注入条款 */
export const INJECTED_JSON_CONSTRAINT =
  '只输出一个 JSON 对象，字段名与上方输出字段表完全一致，不输出表外字段与解释文字。';
export const INJECTED_NON_JSON_CONSTRAINT =
  '直接输出最终交付内容本身，不要用 JSON 包装，不要附加解释、过程说明或多余标记。';
export const INJECTED_DELTA_CONSTRAINT =
  '标注（当轮）的字段每轮必须输出；其余字段仅输出本轮新增或需要修改的，未变化的字段请勿输出；需要清空某字段时输出 null。';

export interface CompileCoreOptions {
  /** 编译产物的 coreVersion（默认 1，由发布流程递增） */
  coreVersion?: number;
}

export interface CompiledCorePrompt {
  /** 完整 prompt 文件文本（frontmatter + 五块正文） */
  prompt: string;
  /** 五块正文（不含 frontmatter，供 DB systemPrompt / lint 使用） */
  body: string;
  coreHash: string;
  coreVersion: number;
}

export const V4_BLOCK_HEADINGS = ['身份', '使用通道', '执行规则', '输出字段', '边界约束'] as const;

/**
 * v4 编译约定文本（external-spec）——供 prompt-compiler 的 LLM 编译与 /compile-spec 端点使用。
 * 由平台常量生成，唯一来源，取代历史 compiler-skill/compile-spec.md（v2 八段约定）。
 */
export function buildV4CompileSpecText(): string {
  const channelLines = (Object.entries(CORE_CHANNEL_DESCRIPTIONS) as Array<[CoreChannel, string]>)
    .map(([name, desc]) => `- ${name}：${desc}`)
    .join('\n');
  return `# v4 Prompt 编译约定（external-spec）

## 产物结构（五块，顺序固定）

1. ## 身份 —— 角色定位与能力边界，两三句 prose
2. ## 使用通道 —— 从六大材料池点名（见下），state 可推进时标注（可推进）
3. ## 执行规则 —— 编号行为规则（怎么推理、怎么填字段、冲突怎么仲裁）
4. ## 输出字段 —— 字段表，每行三要素：- 名称 · 类型 — 功能描述；当轮消费即弃的字段尾部标注（当轮）
5. ## 边界约束 —— 业务禁止事项清单

## 六大材料池（唯一合法通道集）

${channelLines}

## 字段表规则

- 类型受控词表：string | number | boolean | enum | object | object[] | string[]；后缀 ? 表示可缺省
- enum 的可选值列于功能描述中
- 功能描述即生成指令：写得具体（禁什么、引用什么证据、什么语气），产出就是什么样
- 嵌套对象的子字段用「· 子字段（类型）说明」缩进描述，不得伪装成顶层字段行
- 平台包装字段禁出：success / quality / stage / raw

## 编译器注入条款（平台统一追加，产物中不重复书写）

- JSON 输出：${INJECTED_JSON_CONSTRAINT}
- 非 JSON 输出：${INJECTED_NON_JSON_CONSTRAINT}
- Delta 模式（按需）：${INJECTED_DELTA_CONSTRAINT}

## 质量要求

- 规则具体、可执行、可检验，避免抽象口号
- 各块内容相互呼应、不矛盾；字段表的字段必须在执行规则中被正确使用
- 自洽完整，不留 TODO 或占位符`;
}


/** core.yaml → 五块 Runtime Prompt（确定性） */
export function compileCoreFile(core: CoreFile, options: CompileCoreOptions = {}): CompiledCorePrompt {
  const coreHash = computeCoreHash(core);
  const coreVersion = options.coreVersion ?? 1;

  const frontmatter = yaml.dump(
    {
      agentId: `skill:${core.skillId}`,
      coreHash,
      coreVersion,
      temperature: core.params.temperature,
      maxTokens: core.params.maxTokens,
      failurePolicy: core.params.failurePolicy,
      // §5.4 Delta 试验锚点：core → frontmatter → metadata → 运行时合并层
      ...(core.deltaOutput && core.outputMedia === 'json' ? { deltaOutput: true } : {}),
    },
    { lineWidth: -1 }
  ).trimEnd();

  const sections: string[] = [];

  // ## 身份
  sections.push(`## 身份\n\n${core.identity}`);

  // ## 使用通道（stateAdvance=true 时 state 标注"可推进"）
  const channelLines = core.channels.map((channel) => {
    const advance = channel === 'state' && core.stateAdvance ? '（可推进）' : '';
    return `- ${channel}${advance}：${CORE_CHANNEL_DESCRIPTIONS[channel]}`;
  });
  // §2.5 输入契约声明：渲染进同一块，按来源分类标注（skill 上游产物 / sandbox 编排注入 / user 用户平台）
  if (core.inputs?.length) {
    channelLines.push('');
    channelLines.push('输入契约声明（ref 前缀 = 来源分类：skill 上游模型输出 / sandbox 编排注入 / user 用户平台）：');
    for (const input of core.inputs) {
      const kindLabel = input.kind === 'sandbox'
        ? '（编排注入）'
        : input.kind === 'user'
          ? '（用户/平台）'
          : '';
      const nameType = input.name
        ? `「${input.name}${input.type ? `（${input.type}）` : ''}」`
        : '';
      const desc = input.desc || input.note;
      const suffix = desc ? ` — ${desc}` : '';
      channelLines.push(`- ${nameType}\`${input.ref}\`${kindLabel}${suffix}`);
    }
  }
  sections.push(`## 使用通道\n\n${channelLines.join('\n')}`);

  // ## 执行规则（编号平铺）
  const ruleLines = core.rules.map((rule, index) => `${index + 1}. ${rule}`);
  sections.push(`## 执行规则\n\n${ruleLines.join('\n')}`);

  // ## 输出字段（三要素；当轮字段尾部标注）
  const fieldLines = core.fields.map((field) => {
    const turn = field.turn ? '（当轮）' : '';
    return `- ${field.name} · ${field.type} — ${field.desc}${turn}`;
  });
  sections.push(`## 输出字段\n\n${fieldLines.join('\n')}`);

  // ## 边界约束（业务约束 + 编译器注入条款，按输出媒介分支）
  const constraintLines = core.constraints.map((constraint) => `- ${constraint}`);
  constraintLines.push(
    `- ${core.outputMedia === 'json' ? INJECTED_JSON_CONSTRAINT : INJECTED_NON_JSON_CONSTRAINT}`
  );
  if (core.deltaOutput && core.outputMedia === 'json') {
    constraintLines.push(`- ${INJECTED_DELTA_CONSTRAINT}`);
  }
  sections.push(`## 边界约束\n\n${constraintLines.join('\n')}`);

  const body = sections.join('\n\n');
  return {
    prompt: `---\n${frontmatter}\n---\n\n${body}\n`,
    body,
    coreHash,
    coreVersion,
  };
}

export interface GateIssue {
  code: string;
  message: string;
}

/**
 * 守门检查·结构合法（§4.2-1，正文部分）：
 * 正文恰好按序包含五个标准 H2 块。
 */
export function checkFiveBlockBody(systemPrompt: string): GateIssue[] {
  const issues: GateIssue[] = [];
  const normalized = systemPrompt.replace(/\r\n/g, '\n');
  const headingMatches = [...normalized.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
  if (headingMatches.length !== V4_BLOCK_HEADINGS.length) {
    issues.push({
      code: 'block-count-mismatch',
      message: `H2 块数量 ${headingMatches.length} ≠ ${V4_BLOCK_HEADINGS.length}（实际：${headingMatches.join('、') || '无'}）`,
    });
    return issues;
  }
  V4_BLOCK_HEADINGS.forEach((expected, index) => {
    if (headingMatches[index] !== expected) {
      issues.push({
        code: 'block-order-mismatch',
        message: `第 ${index + 1} 块应为「${expected}」，实际为「${headingMatches[index]}」`,
      });
    }
  });
  return issues;
}

/**
 * 守门检查·结构合法（§4.2-1，完整文件）：
 * frontmatter 携带 coreHash，正文符合五块结构。
 */
export function checkFiveBlockStructure(prompt: string): GateIssue[] {
  const issues: GateIssue[] = [];
  const normalized = prompt.replace(/^﻿/, '').replace(/\r\n/g, '\n');

  if (!/^---\n[\s\S]*?\n---\n?/.test(normalized)) {
    issues.push({ code: 'frontmatter-missing', message: '缺少 YAML frontmatter' });
  } else if (!/coreHash:/.test(normalized.split('---')[1] || '')) {
    issues.push({ code: 'corehash-missing', message: 'frontmatter 缺少 coreHash（v4 编译产物标记）' });
  }

  const body = normalized.replace(/^---\n[\s\S]*?\n---\n?/, '');
  return [...issues, ...checkFiveBlockBody(body)];
}

/** 从编译产物「输出字段」块解析字段表（名称与类型） */
export function parseCompiledFieldTable(prompt: string): Array<{ name: string; type: string }> {
  const normalized = prompt.replace(/\r\n/g, '\n');
  const blockMatch = /## 输出字段\s*\n([\s\S]*?)(?=\n## |\s*$)/.exec(normalized);
  if (!blockMatch) return [];
  const fields: Array<{ name: string; type: string }> = [];
  for (const line of blockMatch[1].split('\n')) {
    const m = /^-\s*([A-Za-z0-9_]+)\s*·\s*(\S+)\s*—\s*/.exec(line.trim());
    if (m) {
      fields.push({ name: m[1], type: m[2] });
    }
  }
  return fields;
}

/**
 * 守门检查·字段冻结（§4.2-2）：
 * 编译产物字段表与核心文件 fields 名/型逐一相等（顺序无关）。
 */
export function checkFieldFreeze(core: CoreFile, prompt: string): GateIssue[] {
  const issues: GateIssue[] = [];
  const compiled = parseCompiledFieldTable(prompt);
  const expected = new Map(core.fields.map((field) => [field.name, field.type]));
  const actual = new Map(compiled.map((field) => [field.name, field.type]));

  for (const [name, type] of expected) {
    if (!actual.has(name)) {
      issues.push({ code: 'field-missing', message: `产物缺少字段：${name}` });
    } else if (actual.get(name) !== type) {
      issues.push({
        code: 'field-type-mismatch',
        message: `字段 ${name} 类型不一致：核心文件 ${type} ≠ 产物 ${actual.get(name)}`,
      });
    }
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) {
      issues.push({ code: 'field-extra', message: `产物多出表外字段：${name}` });
    }
  }
  return issues;
}
