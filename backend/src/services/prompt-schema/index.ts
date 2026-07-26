/**
 * Prompt Schema 解析器 v2 (PROMPT_AUTHORING_PROTOCOL v1.1)
 * ============================================================
 * 把 skill prompt 文本解析为统一的结构化 schema，并支持：
 *   - 8 类块（identity/input/rules/state_machine/output/constraints/quality/examples）+ extras 兜底
 *   - H3 子段识别（rules 块下的「阶段定义/推进门槛」自动归为 state_machine）
 *   - wf-* fenced 结构块（wf-input / wf-output / wf-state）解析为字段表
 *   - 编号双兼容：旧 R-<PREFIX>-<NN> 与新 <BLOCK>-<NN>（RULE/OUT/STATE/CON/QC/IN）
 *   - 保真往返：parse → compose 对未改动部分等价
 *
 * 真相源仍是 prompts/*.md；本工具只在内存里拆/拼，便于运营按块编辑与可视化。
 *
 * 详见 doc/PROMPT_AUTHORING_PROTOCOL.md。
 *
 * ⚠️ 向后兼容：保留 v1 的 PromptSchema 字段（title/identity/rulesRaw/rules/output/
 *    extras/conformant/warnings）+ parsePromptSchema/composePromptSchema/parseRuleItems/
 *    nextRuleId/suggestRulePrefix 导出，prompt-ops.ts 等老消费方无需改动。
 */

// ============================================================
// 类型
// ============================================================

export type PromptSection =
  | 'identity'
  | 'input'
  | 'rules'
  | 'state_machine'
  | 'output'
  | 'constraints'
  | 'quality'
  | 'examples'
  | 'extras';

/** 协议模式 */
export type Archetype =
  | 'conversational'
  | 'generator'
  | 'extractor'
  | 'distiller'
  | 'copywriter'
  | 'code-only';

/** 耦合度 */
export type Coupling = 'prose' | 'contract' | 'flow';

/** 编号规则项（兼容旧 R-XX-NN 与新 BLOCK-NN） */
export interface PromptRuleItem {
  /** 完整 ID，如 "R-LG-01" 或 "RULE-01" */
  id: string;
  /** prefix，旧格式取字母段（LG），新格式取块前缀（RULE/OUT/...） */
  prefix: string;
  /** 序号 */
  index: number;
  /** 子序号（R-G-20.1 → 1；无子号为 undefined） */
  sub?: number;
  /** 规则正文（不含 ID 前缀） */
  text: string;
  /** 编号风格 */
  style: 'legacy' | 'block';
}

/** 自由 section（非标准块） */
export interface PromptExtraSection {
  heading: string;
  body: string;
  order: number;
}

/** wf-* 结构块里的一行字段 */
export interface WfField {
  /** 字段路径，如 understanding.surface_goal */
  path: string;
  /** 类型，如 string/number/enum(a|b|c)；wf-state 行无类型则为 null */
  valueType: string | null;
  /** 枚举值（valueType=enum(...) 时解析出来） */
  enumValues?: string[];
  /** 耦合度（省略时由 caller 自动推断） */
  coupling?: Coupling;
  /** 语义说明 */
  note: string;
}

/** 一个解析出的 wf-* fenced 块 */
export interface WfBlock {
  kind: 'wf-input' | 'wf-output' | 'wf-state';
  fields: WfField[];
  /** 块里 # 开头的注释行 */
  comments: string[];
  /** 原始 fence 内容（保真往返用） */
  raw: string;
}

/** 一个解析出的块 */
export interface PromptBlock {
  section: PromptSection;
  /** 原始 H2 标题（extras 用得到） */
  heading: string;
  /** 块正文（去掉标题行后的内容，原样） */
  body: string;
  /** 块内编号项 */
  rules: PromptRuleItem[];
  /** 块内 wf-* 结构块 */
  wfBlocks: WfBlock[];
  /** 是否由 rules 下的 H3 子段提升而来（如阶段定义） */
  promotedFromH3?: boolean;
  /** 出现顺序 */
  order: number;
}

export interface PromptSchema {
  // ---- v1 兼容字段 ----
  title: string | null;
  identity: string;
  rulesRaw: string;
  rules: PromptRuleItem[];
  output: string;
  extras: PromptExtraSection[];
  conformant: boolean;
  warnings: string[];

  // ---- v2 新增字段 ----
  /** frontmatter 声明的 archetype（解析器不读 frontmatter，由 caller 传入或留空） */
  archetype?: Archetype | null;
  /** 有序、带类型的块列表 */
  blocks: PromptBlock[];
  /** 所有 wf-* 结构块（跨块汇总，便于可视化） */
  wfBlocks: WfBlock[];
  /** 从 ## 输出规格 的 ```json``` 示例抽取的输出字段表（JSON schema 即字段真相源） */
  outputFields: WfField[];
  /** 从 ## 输入说明 的 ```json``` 示例抽取的输入字段表（可能为空） */
  inputFields: WfField[];
  /** input/state_machine/constraints/quality 的正文（v2 便捷访问） */
  input: string;
  stateMachine: string;
  constraints: string;
  quality: string;
}

// ============================================================
// 块标题归类
// ============================================================

const HEADING_ALIASES: Record<string, PromptSection> = {
  // identity
  身份定义: 'identity',
  身份说明: 'identity',
  角色定义: 'identity',
  // input
  输入说明: 'input',
  输入约定: 'input',
  输入会提供: 'input',
  // rules
  执行规则: 'rules',
  行为准则: 'rules',
  设计原则: 'rules',
  评估原则: 'rules',
  核心边界: 'rules',
  原则: 'rules',
  规则: 'rules',
  // state_machine
  状态机: 'state_machine',
  阶段定义: 'state_machine',
  阶段推进门槛: 'state_machine',
  // output
  输出规格: 'output',
  输出格式: 'output',
  输出说明: 'output',
  返回格式: 'output',
  // constraints
  边界约束: 'constraints',
  禁止事项: 'constraints',
  约束: 'constraints',
  // quality
  质量控制: 'quality',
  评分参考: 'quality',
  自检: 'quality',
  最终自检: 'quality',
  // examples
  示例: 'examples',
  样例: 'examples',
  例子: 'examples',
};

const STANDARD_HEADINGS: Record<PromptSection, string> = {
  identity: '身份定义',
  input: '输入说明',
  rules: '执行规则',
  state_machine: '状态机',
  output: '输出规格',
  constraints: '边界约束',
  quality: '质量控制',
  examples: '示例',
  extras: '',
};

/** 把任意中英文 H2/H3 标题归类 */
export function classifyHeading(heading: string): PromptSection {
  const trimmed = heading.trim();
  if (HEADING_ALIASES[trimmed]) return HEADING_ALIASES[trimmed];
  // 模糊匹配（顺序敏感：先 state_machine，避免「阶段」被 rules 抢）
  if (/阶段定义|阶段推进|状态机|阶段语义/.test(trimmed)) return 'state_machine';
  if (/身份|角色|定义/.test(trimmed)) return 'identity';
  if (/输入/.test(trimmed)) return 'input';
  if (/输出|返回|格式|响应|JSON/i.test(trimmed)) return 'output';
  if (/质量|自检|校验|评分参考/.test(trimmed)) return 'quality';
  if (/边界|禁止|约束/.test(trimmed)) return 'constraints';
  if (/示例|样例|例子/.test(trimmed)) return 'examples';
  if (/规则|准则|原则/.test(trimmed)) return 'rules';
  return 'extras';
}

/** 标题是否是“规范化”写法（在别名表里、即标准 H2，而非模糊命中或裸标题） */
export function isCanonicalHeading(heading: string): boolean {
  return Object.prototype.hasOwnProperty.call(HEADING_ALIASES, heading.trim());
}

// ============================================================
// Prompt 语法规范（机器可验证的契约 / 真相源）
// ============================================================
// 这是“什么是一个合法的 skill prompt”的唯一定义。
// 解析器按这张表归类（不靠正则猜），编辑器渲染按这张表，校验器按这张表判合规。
// 详见 doc/PROMPT_AUTHORING_PROTOCOL.md「强制契约」章节。

export interface ArchetypeSpec {
  /** 必需的 H2 段落（缺一即违规） */
  required: PromptSection[];
  /** 可选的 H2 段落 */
  optional: PromptSection[];
  /** 禁止出现的 H2 段落（出现即违规） */
  forbidden: PromptSection[];
  /** 输出规格段是否必须含 ```json``` 示例（字段真相源） */
  requireJsonOutput: boolean;
}

/** 段落的规范顺序（用于顺序校验；数字越小越靠前）—— 与协议 §3 对齐 */
export const SECTION_ORDER: Record<PromptSection, number> = {
  identity: 1,
  input: 2,
  rules: 3,
  state_machine: 4,
  output: 5,
  constraints: 6,
  quality: 7,
  examples: 8,
  extras: 99,
};

/**
 * 每个 archetype 的段落契约 —— 严格对应 doc/PROMPT_AUTHORING_PROTOCOL.md §3 矩阵：
 *   identity/input/rules/output : 全 archetype M（必含）
 *   state_machine : 仅 conversational M，其余 X（禁止）
 *   constraints   : conv/extractor/distiller/copywriter M，generator O
 *   quality/examples : 全 O（可选）
 */
export const ARCHETYPE_SPEC: Record<Archetype, ArchetypeSpec> = {
  conversational: {
    required: ['identity', 'input', 'rules', 'state_machine', 'output', 'constraints'],
    optional: ['quality', 'examples'],
    forbidden: [],
    requireJsonOutput: true,
  },
  generator: {
    required: ['identity', 'input', 'rules', 'output'],
    optional: ['quality', 'constraints', 'examples'],
    forbidden: ['state_machine'],
    requireJsonOutput: true,
  },
  extractor: {
    required: ['identity', 'input', 'rules', 'output', 'constraints'],
    optional: ['quality', 'examples'],
    forbidden: ['state_machine'],
    requireJsonOutput: true,
  },
  distiller: {
    required: ['identity', 'input', 'rules', 'output', 'constraints'],
    optional: ['quality', 'examples'],
    forbidden: ['state_machine'],
    requireJsonOutput: true,
  },
  copywriter: {
    required: ['identity', 'input', 'rules', 'output', 'constraints'],
    optional: ['quality', 'examples'],
    forbidden: ['state_machine'],
    requireJsonOutput: true,
  },
  'code-only': {
    // code-only 是纯逻辑 stub（PROMPT=''），豁免所有结构要求
    required: [],
    optional: [],
    forbidden: [],
    requireJsonOutput: false,
  },
};

export type LintLevel = 'error' | 'warning';
export interface LintIssue {
  level: LintLevel;
  code: string;
  message: string;
}
export interface LintResult {
  archetype: Archetype | null;
  compliant: boolean;
  issues: LintIssue[];
}

/**
 * 校验一个 prompt schema 是否符合规范。
 * archetype 由 caller 传入（来自 frontmatter）；缺省按 conversational 之外的通用规则校验。
 */
export function lintPromptSchema(
  schema: PromptSchema,
  archetype: Archetype | null,
  options: {
    inputTransport?: 'json' | 'tagged-text' | 'yaml' | 'mixed' | 'none';
    outputMedia?: 'json' | 'markdown' | 'text' | 'none';
  } = {}
): LintResult {
  const issues: LintIssue[] = [];

  // code-only 豁免
  if (archetype === 'code-only') {
    return { archetype, compliant: true, issues };
  }

  const spec = (archetype && ARCHETYPE_SPEC[archetype]) || ARCHETYPE_SPEC.generator;
  const presentSections = new Set(schema.blocks.map((b) => b.section));

  // 1) 必需段落
  for (const need of spec.required) {
    if (!presentSections.has(need)) {
      issues.push({
        level: 'error',
        code: 'MISSING_SECTION',
        message: `缺少必需段落「## ${STANDARD_HEADINGS[need]}」`,
      });
    }
  }

  // 1b) 禁止段落（如非 conversational 不得有状态机）
  for (const ban of spec.forbidden) {
    if (presentSections.has(ban)) {
      issues.push({
        level: 'error',
        code: 'FORBIDDEN_SECTION',
        message: `${archetype} 不允许出现段落「## ${STANDARD_HEADINGS[ban]}」`,
      });
    }
  }

  // 2) 段落顺序
  const ordered = schema.blocks
    .filter((b) => b.section !== 'extras')
    .map((b) => ({ section: b.section, order: SECTION_ORDER[b.section] }));
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].order < ordered[i - 1].order) {
      issues.push({
        level: 'error',
        code: 'SECTION_ORDER',
        message: `段落顺序错误：「${STANDARD_HEADINGS[ordered[i].section]}」不应排在「${STANDARD_HEADINGS[ordered[i - 1].section]}」之后`,
      });
      break;
    }
  }

  // 3) 输出规格必须含 JSON schema（字段真相源）
  if (spec.requireJsonOutput && (options.outputMedia || 'json') === 'json') {
    if (!presentSections.has('output')) {
      // 已由 MISSING_SECTION 覆盖
    } else if (schema.outputFields.length === 0) {
      issues.push({
        level: 'error',
        code: 'MISSING_JSON_SCHEMA',
        message: '「## 输出规格」缺少 ```json``` 示例（字段真相源），无法抽出字段表',
      });
    }
  }

  // 3b) 输入说明必须含 JSON schema（编译器输入字段真相源 — P-PROMPT-COMPILE.0）
  // 协议: 含 input 段的非 code-only prompt 必须在 ## 输入说明 段提供一个 ```json``` 示例,
  // 让编译器能从中抽出 inputFields[], 用于后续编译时合成输入字段路由.
  if (presentSections.has('input') && (options.inputTransport || 'json') === 'json' && schema.inputFields.length === 0) {
    issues.push({
      level: 'error',
      code: 'MISSING_INPUT_SCHEMA',
      message: '「## 输入说明」缺少 ```json``` 示例（编译器输入字段真相源），无法抽出输入字段表',
    });
  }

  // 4) 非规范标题（裸标题 / 模糊命中）→ 警告，建议改用标准 H2
  for (const b of schema.blocks) {
    if (b.section === 'extras') {
      issues.push({
        level: 'warning',
        code: 'NONCANONICAL_HEADING',
        message: `段落「## ${b.heading}」不在规范标题表内（归为 extras），建议改用标准段落名`,
      });
    } else if (!isCanonicalHeading(b.heading) && !b.promotedFromH3) {
      issues.push({
        level: 'warning',
        code: 'FUZZY_HEADING',
        message: `段落「## ${b.heading}」靠模糊匹配归为 ${b.section}，建议改用标准名「## ${STANDARD_HEADINGS[b.section]}」`,
      });
    }
  }

  const hasError = issues.some((i) => i.level === 'error');
  return { archetype, compliant: !hasError, issues };
}

// ============================================================
// 编号解析（双兼容）
// ============================================================

/** 旧格式 R-<PREFIX>-<NN>[.<M>]: text */
const LEGACY_RULE_PATTERN = /^\s*(R-([A-Z]+)-(\d+)(?:\.(\d+))?)\s*[:：]\s*(.+?)\s*$/;
/** 新格式 <BLOCK>-<NN>[.<M>]: text （BLOCK ∈ RULE/OUT/STATE/CON/QC/IN） */
const BLOCK_RULE_PATTERN = /^\s*((RULE|OUT|STATE|CON|QC|IN)-(\d+)(?:\.(\d+))?)\s*[:：]\s*(.+?)\s*$/;

/** 解析一行是否为编号项；不是返回 null */
function parseRuleLine(line: string): PromptRuleItem | null {
  const legacy = LEGACY_RULE_PATTERN.exec(line);
  if (legacy) {
    return {
      id: legacy[1],
      prefix: legacy[2],
      index: parseInt(legacy[3], 10),
      sub: legacy[4] ? parseInt(legacy[4], 10) : undefined,
      text: legacy[5],
      style: 'legacy',
    };
  }
  const block = BLOCK_RULE_PATTERN.exec(line);
  if (block) {
    return {
      id: block[1],
      prefix: block[2],
      index: parseInt(block[3], 10),
      sub: block[4] ? parseInt(block[4], 10) : undefined,
      text: block[5],
      style: 'block',
    };
  }
  return null;
}

/** 兼容旧导出：从一段文本里抽编号项（双格式） */
export function parseRuleItems(rulesRaw: string): PromptRuleItem[] {
  const lines = (rulesRaw || '').split('\n');
  const result: PromptRuleItem[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const item = parseRuleLine(line);
    if (item) result.push(item);
  }
  return result;
}

// ============================================================
// wf-* fenced 块解析
// ============================================================

const COUPLINGS = new Set<Coupling>(['prose', 'contract', 'flow']);

/** 解析 wf-* 块内的一行字段 */
function parseWfLine(line: string, kind: WfBlock['kind']): WfField | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx < 0) return null;
  const path = trimmed.slice(0, colonIdx).trim();
  const rest = trimmed.slice(colonIdx + 1);
  // rest 用 | 分段；但 enum(a|b|c) 内部的 | 不能拆 → 先占位保护
  const ENUM_PIPE = '\u0001';
  const protectedRest = rest.replace(/enum\(([^)]*)\)/g, (_m, inner) =>
    `enum(${inner.replace(/\|/g, ENUM_PIPE)})`
  );
  const parts = protectedRest
    .split('|')
    .map((p) => p.trim().replace(new RegExp(ENUM_PIPE, 'g'), '|'));

  if (kind === 'wf-state') {
    // 阶段名 : 耦合度 | 语义   （无类型列）
    let coupling: Coupling | undefined;
    let note = '';
    if (parts.length >= 2 && COUPLINGS.has(parts[0] as Coupling)) {
      coupling = parts[0] as Coupling;
      note = parts.slice(1).join(' | ');
    } else {
      note = parts.join(' | ');
    }
    return { path, valueType: null, coupling, note };
  }

  // wf-input / wf-output: 路径 : 类型 | 耦合度 | 语义
  const valueType = parts[0] || null;
  let coupling: Coupling | undefined;
  let note = '';
  if (parts.length >= 2 && COUPLINGS.has(parts[1] as Coupling)) {
    coupling = parts[1] as Coupling;
    note = parts.slice(2).join(' | ');
  } else {
    note = parts.slice(1).join(' | ');
  }
  const field: WfField = { path, valueType, coupling, note };
  const enumMatch = (valueType || '').match(/^enum\((.+)\)$/);
  if (enumMatch) {
    field.enumValues = enumMatch[1].split('|').map((v) => v.trim());
  }
  return field;
}

/** 从块正文里抽出所有 wf-* fenced 块 */
function extractWfBlocks(body: string): WfBlock[] {
  const result: WfBlock[] = [];
  const fenceRe = /```(wf-input|wf-output|wf-state)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(body)) !== null) {
    const kind = m[1] as WfBlock['kind'];
    const inner = m[2];
    const fields: WfField[] = [];
    const comments: string[] = [];
    for (const line of inner.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('#')) {
        comments.push(t.replace(/^#\s*/, ''));
        continue;
      }
      const f = parseWfLine(line, kind);
      if (f) fields.push(f);
    }
    result.push({ kind, fields, comments, raw: inner });
  }
  return result;
}

// ============================================================
// JSON schema → 字段表抽取
// ============================================================
// 核心理念：prompt 输出本就是 JSON，写在 ## 输出规格 里的示例 JSON
// （带 "a|b|c" 枚举、0-1/1-6 范围、"说明文字" 占位）本身就是 schema。
// 它一份东西两用：给 LLM 看（照着输出）+ 给机器读（生成字段表）。
// 不再需要 wf-* 块这第二份重复声明。

/** 把示例 JSON 的一个 value 推断为 WfField 的类型/枚举/语义 */
function inferFieldFromValue(value: any): {
  valueType: string | null;
  enumValues?: string[];
  note: string;
} {
  if (typeof value === 'string') {
    const s = value.trim();
    // "a|b|c" → enum
    if (/^[^|]+(\|[^|]+)+$/.test(s) && !/\s/.test(s)) {
      const enumValues = s.split('|').map((v) => v.trim());
      return { valueType: `enum(${enumValues.join('|')})`, enumValues, note: '' };
    }
    // "1-6" / "0-1" / "0-100" → number（范围进 note）
    if (/^\d+(\.\d+)?\s*-\s*\d+(\.\d+)?$/.test(s)) {
      return { valueType: 'number', note: `范围 ${s}` };
    }
    // 其余字符串：占位说明文字进 note
    return { valueType: 'string', note: s };
  }
  if (typeof value === 'number') return { valueType: 'number', note: '' };
  if (typeof value === 'boolean') return { valueType: 'boolean', note: '' };
  if (Array.isArray(value)) return { valueType: 'array', note: '' };
  if (value && typeof value === 'object') return { valueType: 'object', note: '' };
  return { valueType: null, note: '' };
}

/** 递归遍历示例 JSON，产出扁平字段列表（点路径 + 数组用 [] 表示） */
function flattenJsonSchema(obj: any, prefix: string, out: WfField[]): void {
  if (Array.isArray(obj)) {
    // 数组：取首元素作为元素结构样本
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
      flattenJsonSchema(obj[0], `${prefix}[]`, out);
    }
    return;
  }
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    const info = inferFieldFromValue(value);
    out.push({ path, valueType: info.valueType, enumValues: info.enumValues, note: info.note });
    // 递归嵌套对象/对象数组
    if (Array.isArray(value)) {
      if (value.length > 0 && value[0] && typeof value[0] === 'object') {
        flattenJsonSchema(value[0], `${path}[]`, out);
      }
    } else if (value && typeof value === 'object') {
      flattenJsonSchema(value, path, out);
    }
  }
}

/**
 * 宽松解析示例 JSON 文本为对象。
 * prompt 里的示例 JSON 含非法片段（a|b|c、0-1、1-6、注释、尾逗号），
 * 标准 JSON.parse 会失败，这里把这些“值模式”先转成带引号的字符串占位再 parse。
 */
function lenientParseJson(jsonText: string): any | null {
  let s = jsonText
    .replace(/\/\/[^\n]*/g, '') // 行注释
    .replace(/\/\*[\s\S]*?\*\//g, ''); // 块注释
  // 省略号占位：[ ... ] → []；裸 ... （作为值）→ "..."
  s = s.replace(/\[\s*\.\.\.\s*\]/g, '[]');
  s = s.replace(/:\s*\.\.\.\s*(?=[,\n}\]])/g, ': "..."');
  // 把裸的 数字范围 / 枚举管道值 包成字符串： : 1-6  : a|b|c
  // 仅处理冒号后、到逗号/换行/右括号前的裸值
  s = s.replace(/:\s*([0-9]+(?:\.[0-9]+)?\s*-\s*[0-9]+(?:\.[0-9]+)?)\s*(?=[,\n}\]])/g, ': "$1"');
  s = s.replace(/:\s*([A-Za-z_][\w]*(?:\|[A-Za-z_][\w]*)+)\s*(?=[,\n}\]])/g, ': "$1"');
  // 去掉尾逗号
  s = s.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 从一段正文里抽取第一个 ```json``` 块并解析为字段列表 */
function extractFieldsFromJson(body: string): WfField[] {
  const m = body.match(/```json\s*\n([\s\S]*?)```/);
  if (!m) return [];
  const obj = lenientParseJson(m[1]);
  if (!obj || typeof obj !== 'object') return [];
  const fields: WfField[] = [];
  flattenJsonSchema(obj, '', fields);
  return fields;
}

// ============================================================
// 主解析
// ============================================================

interface RawSection {
  heading: string;
  level: 2 | 3;
  body: string[];
}

/**
 * 把完整 prompt 文本拆成 schema（v2）
 */
export function parsePromptSchema(promptText: string): PromptSchema {
  const text = (promptText || '').replace(/\r\n/g, '\n').trim();

  // 提取顶部 H1
  let title: string | null = null;
  const firstLine = text.split('\n', 1)[0] || '';
  const h1Match = firstLine.match(/^#\s+(.+?)\s*$/);
  if (h1Match) title = h1Match[1];

  const lines = text.split('\n');

  // ---- 第一遍：按 H2 切块，并记录每个 H2 块的原始 body（含 H3） ----
  const h2Sections: Array<{ heading: string; body: string[] }> = [];
  let curHeading = '';
  let curBody: string[] = [];
  let inSection = false;
  const preludeLines: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跟踪代码围栏，避免把 fence 内的内容误判为标题
    if (/^```/.test(line.trim())) inFence = !inFence;
    const h2Match = !inFence ? line.match(/^##\s+(.+?)\s*$/) : null;
    if (h2Match) {
      if (inSection) h2Sections.push({ heading: curHeading, body: curBody });
      curHeading = h2Match[1].trim();
      curBody = [];
      inSection = true;
    } else if (inSection) {
      curBody.push(line);
    } else {
      if (i === 0 && h1Match) continue;
      preludeLines.push(line);
    }
  }
  if (inSection) h2Sections.push({ heading: curHeading, body: curBody });

  // ---- 第二遍：每个 H2 块归类；rules 块内若有「阶段*」H3 子段，提升为 state_machine ----
  const blocks: PromptBlock[] = [];
  let order = 0;

  for (const sec of h2Sections) {
    const cat = classifyHeading(sec.heading);
    const bodyText = sec.body.join('\n');

    if (cat === 'rules') {
      // 检查 rules 块下是否有「阶段*」H3，需要拆出 state_machine
      const split = splitRulesForStateMachine(sec.body);
      if (split.stateMachineBody !== null) {
        // 先 push rules 主体（去掉阶段子段）
        const rulesBody = split.rulesBody;
        blocks.push(makeBlock('rules', sec.heading, rulesBody, order++));
        // 再 push 提升出的 state_machine（保留 H3 标题在 body 内，标记 promoted）
        const smBlock = makeBlock(
          'state_machine',
          STANDARD_HEADINGS.state_machine,
          split.stateMachineBody,
          order++
        );
        smBlock.promotedFromH3 = true;
        blocks.push(smBlock);
        continue;
      }
    }

    blocks.push(makeBlock(cat, sec.heading, bodyText, order++));
  }

  // prelude（H1 后未归类的自由文本）当作 identity 兜底
  const preludeText = preludeLines.join('\n').trim();
  if (preludeText) {
    const idBlock = blocks.find((b) => b.section === 'identity');
    if (idBlock) {
      idBlock.body = (preludeText + '\n\n' + idBlock.body).trim();
    } else {
      blocks.unshift(makeBlock('identity', STANDARD_HEADINGS.identity, preludeText, -1));
    }
  }

  // ---- 汇总到 v1 兼容字段 ----
  const pick = (s: PromptSection) =>
    blocks.find((b) => b.section === s)?.body.trim() || '';

  const identity = pick('identity');
  const rulesRaw = pick('rules');
  const input = pick('input');
  const output = pick('output');
  const stateMachine = pick('state_machine');
  const constraints = pick('constraints');
  const quality = pick('quality');

  const extras: PromptExtraSection[] = blocks
    .filter((b) => b.section === 'extras')
    .map((b, i) => ({ heading: b.heading, body: b.body.trim(), order: b.order ?? i }));

  // 所有编号项（跨块汇总，供 v1 rules 字段）
  const allRules: PromptRuleItem[] = [];
  for (const b of blocks) allRules.push(...b.rules);

  const wfBlocks: WfBlock[] = [];
  for (const b of blocks) wfBlocks.push(...b.wfBlocks);

  // ---- 从 ```json``` 示例抽字段表（JSON schema 即真相源，替代 wf 块）----
  const outputFields = extractFieldsFromJson(output);
  const inputFields = extractFieldsFromJson(input);

  // ---- Lint ----
  const warnings: string[] = [];
  if (!identity) warnings.push('缺少 ## 身份定义 段落');
  if (!rulesRaw && !blocks.some((b) => b.section === 'rules'))
    warnings.push('缺少 ## 执行规则 段落');
  if (!output) warnings.push('缺少 ## 输出规格 段落');

  // 编号唯一性 + prefix 一致性（仅对 legacy 风格做 prefix 检查；block 风格天然按块）
  const seen = new Set<string>();
  for (const r of allRules) {
    if (seen.has(r.id)) warnings.push(`重复的规则编号：${r.id}`);
    seen.add(r.id);
  }
  const legacyPrefixes = new Set(
    allRules.filter((r) => r.style === 'legacy').map((r) => r.prefix)
  );
  if (legacyPrefixes.size > 1) {
    warnings.push(
      `同一 prompt 出现多个旧式 prefix：${Array.from(legacyPrefixes).join(', ')}（建议迁移到按块编号 RULE/OUT/...）`
    );
  }

  const conformant = !!identity && !!rulesRaw && !!output && allRules.length > 0;

  return {
    // v1 兼容
    title,
    identity,
    rulesRaw,
    rules: allRules,
    output,
    extras,
    conformant,
    warnings,
    // v2 新增
    archetype: null,
    blocks,
    wfBlocks,
    outputFields,
    inputFields,
    input,
    stateMachine,
    constraints,
    quality,
  };
}

/** 构造一个 block */
function makeBlock(
  section: PromptSection,
  heading: string,
  body: string,
  order: number
): PromptBlock {
  return {
    section,
    heading,
    body,
    rules: parseRuleItems(body),
    wfBlocks: extractWfBlocks(body),
    order,
  };
}

/**
 * 在 rules 块的 body 里找「阶段定义/推进门槛/状态机」H3 子段。
 * 若找到，返回拆分后的 rulesBody（去掉这些子段）和 stateMachineBody（这些子段拼接）。
 * 找不到则 stateMachineBody=null。
 */
function splitRulesForStateMachine(bodyLines: string[]): {
  rulesBody: string;
  stateMachineBody: string | null;
} {
  const isStateH3 = (h: string) => /阶段定义|阶段推进|状态机|阶段语义/.test(h.trim());

  // 把 body 按 H3 切成段
  type Seg = { h3: string | null; lines: string[]; isState: boolean };
  const segs: Seg[] = [];
  let cur: Seg = { h3: null, lines: [], isState: false };
  let inFence = false;
  for (const line of bodyLines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    const h3 = !inFence ? line.match(/^###\s+(.+?)\s*$/) : null;
    if (h3) {
      segs.push(cur);
      const heading = h3[1].trim();
      cur = { h3: heading, lines: [line], isState: isStateH3(heading) };
    } else {
      cur.lines.push(line);
    }
  }
  segs.push(cur);

  const hasState = segs.some((s) => s.isState);
  if (!hasState) {
    return { rulesBody: bodyLines.join('\n'), stateMachineBody: null };
  }

  const rulesSegs = segs.filter((s) => !s.isState);
  const stateSegs = segs.filter((s) => s.isState);
  return {
    rulesBody: rulesSegs
      .map((s) => s.lines.join('\n'))
      .join('\n')
      .trim(),
    stateMachineBody: stateSegs
      .map((s) => s.lines.join('\n'))
      .join('\n')
      .trim(),
  };
}

// ============================================================
// 拼回 markdown（保真往返）
// ============================================================

/**
 * 把 schema 拼回完整 markdown prompt 文本。
 * v2：按 blocks 顺序还原，保留各块原始 body（含 wf-* 块、H3 子段、代码块）。
 * 对未改动的 schema，parse → compose 应与原文（归一化空白后）等价。
 */
export function composePromptSchema(schema: PromptSchema): string {
  const parts: string[] = [];
  if (schema.title) {
    parts.push(`# ${schema.title}`);
    parts.push('');
  }

  // 优先按 v2 blocks 还原（保真）
  if (schema.blocks && schema.blocks.length > 0) {
    const ordered = [...schema.blocks].sort((a, b) => a.order - b.order);
    for (const b of ordered) {
      // promoted state_machine 的 body 已含 ### 标题，物理上属于 rules 块；
      // 还原时仍写回其 H3 内容，但不重复加 ## 标题（避免破坏原结构）。
      if (b.promotedFromH3) {
        if (b.body.trim()) {
          parts.push(b.body.trim());
          parts.push('');
        }
        continue;
      }
      const heading =
        b.section === 'extras' ? b.heading : STANDARD_HEADINGS[b.section] || b.heading;
      parts.push(`## ${heading}`);
      parts.push('');
      if (b.body.trim()) {
        parts.push(b.body.trim());
        parts.push('');
      }
    }
    return parts.join('\n').trim() + '\n';
  }

  // 回退：v1 字段拼接（老调用方手工构造 schema 时）
  if (schema.identity) {
    parts.push(`## ${STANDARD_HEADINGS.identity}`, '', schema.identity.trim(), '');
  }
  if (schema.rules && schema.rules.length > 0) {
    parts.push(`## ${STANDARD_HEADINGS.rules}`, '');
    const sorted = [...schema.rules].sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
      if (a.index !== b.index) return a.index - b.index;
      return (a.sub || 0) - (b.sub || 0);
    });
    for (const r of sorted) parts.push(`${r.id}: ${r.text}`);
    parts.push('');
  } else if (schema.rulesRaw) {
    parts.push(`## ${STANDARD_HEADINGS.rules}`, '', schema.rulesRaw.trim(), '');
  }
  if (schema.output) {
    parts.push(`## ${STANDARD_HEADINGS.output}`, '', schema.output.trim(), '');
  }
  for (const e of [...(schema.extras || [])].sort((a, b) => a.order - b.order)) {
    parts.push(`## ${e.heading}`, '', e.body.trim(), '');
  }
  return parts.join('\n').trim() + '\n';
}

// ============================================================
// 编号工具
// ============================================================

/**
 * 给定一组现有编号 + 块前缀，返回下一个可用编号。
 * 新风格用块前缀（RULE/OUT/...），旧风格用 R-<PREFIX>-。
 */
export function nextRuleId(
  existing: PromptRuleItem[],
  prefix: string,
  style: 'block' | 'legacy' = 'block'
): string {
  const max = existing
    .filter((r) => r.prefix === prefix)
    .reduce((m, r) => Math.max(m, r.index), 0);
  const next = (max + 1).toString().padStart(2, '0');
  return style === 'legacy' ? `R-${prefix}-${next}` : `${prefix}-${next}`;
}

/** 块类型 → 新编号前缀 */
export const BLOCK_RULE_PREFIX: Partial<Record<PromptSection, string>> = {
  input: 'IN',
  rules: 'RULE',
  state_machine: 'STATE',
  output: 'OUT',
  constraints: 'CON',
  quality: 'QC',
};

/**
 * 从 agentId 推荐 R prefix（保留兼容旧编辑器；新协议建议直接用块前缀）。
 */
export function suggestRulePrefix(agentId: string): string {
  const customMap: Record<string, string> = {
    'skill:label-generator': 'LG',
    'skill:goal-profile-inference': 'GI',
    'skill:dialogue-concept-extractor': 'DC',
    'skill:session-knowledge-distiller': 'SK',
    'skill:learning-pattern-distiller': 'LP',
    'skill:adaptive-guidance-copy': 'AG',
    'skill:path-scene-framing': 'PSF',
    'skill:peer-reinforcement': 'PR',
    'skill:stage-designer': 'SD',
    'skill:goal-conversation': 'GC',
    'skill:path-planning': 'PA',
    'skill:teaching-turn': 'TT',
    'skill:session-wrapup': 'SW',
  };
  if (customMap[agentId]) return customMap[agentId];

  const cleaned = agentId.replace(/^skill:/, '').replace(/[-_]agent$/, '');
  const parts = cleaned.split(/[-_]/);
  const acronym = parts
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
    .slice(0, 3);
  return acronym || 'R';
}
