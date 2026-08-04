/**
 * v4 核心文件 canonical 序列化器（表单模式回写）
 *
 * 职责：
 * - serializeCoreFile：CoreFile → 确定性 YAML 文本（固定键序 + 标准文件头），
 *   输出保证可被 parseCoreFile 重新解析（round-trip）。
 * - normalizeCoreFormInput：网页表单提交的松散 JSON → CoreFile 形状，
 *   仅做类型矫正与兜底；语义校验仍由 parseCoreFile 单点承担。
 */
import yaml from 'js-yaml';
import {
  CORE_CHANNELS,
  CORE_FAILURE_POLICIES,
  CORE_FIELD_TYPES,
  CORE_OUTPUT_MEDIA,
  parseInputRef,
  type CoreChannel,
  type CoreFailurePolicy,
  type CoreFile,
  type CoreFileIssue,
  type CoreOutputMedia,
} from './core-file-loader';

/** 表单提交的核心文件松散形状（全部可选，缺省由 normalize 兜底） */
export interface CoreFormInput {
  skillId?: unknown;
  baseVersion?: unknown;
  identity?: unknown;
  channels?: unknown;
  stateAdvance?: unknown;
  inputs?: unknown;
  rules?: unknown;
  fields?: unknown;
  constraints?: unknown;
  examples?: unknown;
  params?: unknown;
  deltaOutput?: unknown;
  outputMedia?: unknown;
}

function asTrimmedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : fallback;
}

/**
 * 表单 JSON → CoreFile。
 * 注意：这里不做语义校验（键名/类型词表/必填由 parseCoreFile 复核），
 * 只把输入矫正到可序列化的形状；明显无法矫正的字段返回 diagnostics。
 */
export function normalizeCoreFormInput(
  input: unknown,
  skillId: string
): { ok: boolean; core: CoreFile; diagnostics: CoreFileIssue[] } {
  const diagnostics: CoreFileIssue[] = [];
  const raw = (input && typeof input === 'object' ? input : {}) as CoreFormInput;

  const channels = asTrimmedStringList(raw.channels).filter((c) =>
    (CORE_CHANNELS as readonly string[]).includes(c)
  ) as CoreChannel[];

  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .filter((field) => field && typeof field === 'object')
    .map((field) => {
      const item = field as Record<string, unknown>;
      const baseType = String(item.type ?? 'string').trim().replace(/\?$/, '');
      const type = (CORE_FIELD_TYPES as readonly string[]).includes(baseType)
        ? `${baseType}${String(item.type ?? '').trim().endsWith('?') ? '?' : ''}`
        : String(item.type ?? 'string').trim();
      return {
        name: String(item.name ?? '').trim(),
        type,
        optional: type.endsWith('?'),
        desc: String(item.desc ?? '').trim(),
        turn: item.turn === true,
      };
    })
    .filter((field) => field.name || field.desc);

  const rawParams = (raw.params && typeof raw.params === 'object' ? raw.params : {}) as Record<string, unknown>;
  const failurePolicy = (CORE_FAILURE_POLICIES as readonly string[]).includes(String(rawParams.failurePolicy))
    ? (String(rawParams.failurePolicy) as CoreFailurePolicy)
    : 'retry';
  const maxTokensRaw = asFiniteNumber(rawParams.maxTokens, 8000);
  const maxTokens = Number.isInteger(maxTokensRaw) && maxTokensRaw > 0 ? maxTokensRaw : 8000;

  const outputMedia = (CORE_OUTPUT_MEDIA as readonly string[]).includes(String(raw.outputMedia))
    ? (String(raw.outputMedia) as CoreOutputMedia)
    : 'json';

  const inputs = (Array.isArray(raw.inputs) ? raw.inputs : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const entry = item as Record<string, unknown>;
      const ref = String(entry.ref ?? '').trim();
      const note = String(entry.note ?? '').trim();
      return { ref, note };
    })
    .filter((entry) => entry.ref)
    .map((entry) => {
      const parts = parseInputRef(entry.ref);
      return {
        ref: entry.ref,
        skill: parts?.skill || '',
        fieldPath: parts?.fieldPath || '',
        ...(entry.note ? { note: entry.note } : {}),
      };
    });

  const examples = asTrimmedStringList(raw.examples);

  const core: CoreFile = {
    skillId,
    baseVersion: Math.max(1, Math.floor(asFiniteNumber(raw.baseVersion, 1))),
    identity: String(raw.identity ?? '').trim(),
    channels,
    stateAdvance: raw.stateAdvance === true,
    ...(inputs.length ? { inputs } : {}),
    rules: asTrimmedStringList(raw.rules),
    fields,
    constraints: asTrimmedStringList(raw.constraints),
    params: {
      temperature: asFiniteNumber(rawParams.temperature, 0.5),
      maxTokens,
      failurePolicy,
    },
    ...(examples.length ? { examples } : {}),
    deltaOutput: raw.deltaOutput === true,
    outputMedia,
  };

  // 语义校验（必填/词表/键名）由路由侧 parseCoreFile 单点复核；此处只负责形状矫正
  return { ok: true, core, diagnostics };
}

/**
 * CoreFile → 确定性 YAML。
 * 键序固定；多行字符串由 js-yaml 自动使用块标量；可选键缺省不输出。
 * headerComment：原文件的头部注释块（逐 # 行原样保留，如 M1 基准血缘信息）；
 * 缺省使用标准头。
 */
export function serializeCoreFile(core: CoreFile, headerComment?: string): string {
  const doc: Record<string, unknown> = {
    skillId: core.skillId,
    baseVersion: core.baseVersion,
    identity: core.identity,
    channels: core.channels,
    stateAdvance: core.stateAdvance,
    ...(core.inputs?.length
      ? { inputs: core.inputs.map((input) => ({ ref: input.ref, ...(input.note ? { note: input.note } : {}) })) }
      : {}),
    rules: core.rules,
    fields: core.fields.map((field) => ({
      name: field.name,
      type: field.type,
      desc: field.desc,
      ...(field.turn ? { turn: true } : {}),
    })),
    constraints: core.constraints,
    ...(core.examples && core.examples.length ? { examples: core.examples } : {}),
    params: {
      temperature: core.params.temperature,
      maxTokens: core.params.maxTokens,
      failurePolicy: core.params.failurePolicy,
    },
    deltaOutput: core.deltaOutput,
    outputMedia: core.outputMedia,
  };
  const body = yaml.dump(doc, {
    lineWidth: -1,
    noRefs: true,
    noCompatMode: true,
    quotingType: '"',
  });
  const header = headerComment?.trim()
    ? `${headerComment.trimEnd()}\n`
    : [
        `# v4 核心文件：${core.skillId}（SKILL_PROTOCOL_V4 §2）`,
        `# 由 Skill 设计页「协议」表单生成；编译产物为 prompts/skill.${core.skillId}.md`,
        '',
      ].join('\n');
  return `${header}${body}`;
}

/** 提取 YAML 文本开头的连续注释块（# 行，允许行间空行），无则返回 undefined */
export function extractHeaderComment(yamlText: string): string | undefined {
  const lines = yamlText.split('\n');
  const header: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      header.push(line);
      continue;
    }
    if (trimmed === '' && header.length > 0) {
      // 注释块内的空行保留，但若之后没有更多注释行会在末尾裁剪
      header.push(line);
      continue;
    }
    break;
  }
  while (header.length && header[header.length - 1].trim() === '') header.pop();
  return header.length ? header.join('\n') : undefined;
}
