/**
 * Prompt 文件加载器
 *
 * 设计原则（File-as-Truth）：
 * - prompts/ 目录下的 .md 文件是 prompt 的唯一权威源（进 git）
 * - 每个文件 = 一个能力单元（agent/skill）的当前 active prompt
 * - 文件顶部使用 YAML frontmatter 声明元数据（agentId / 参数等），正文为 systemPrompt
 * - DB 仅作运行时镜像与统计载体，由启动/手动 sync 从文件刷新，可随时重建
 *
 * 文件命名：agentId 中的冒号(:)在文件名中用点(.)替代，
 * 例如 agentId "skill:peer-reinforcement" -> 文件 "skill.peer-reinforcement.md"
 * 但 frontmatter 中的 agentId 字段才是权威标识。
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

export interface PromptFileMeta {
  /** 权威标识，对应 agent_prompts.agentId */
  agentId: string;
  /** 基础名称（不含 vN- 版本前缀），用于生成 agent_prompts.name */
  name: string;
  description?: string;
  temperature?: number;
  maxTokens?: number;
  /** 兼容历史 agentId（如 goal-conversation / skill:goal-conversation） */
  acceptableAgentIds?: string[];
  /** 协议模式（PROMPT_AUTHORING_PROTOCOL）：conversational/generator/extractor/distiller/copywriter/code-only */
  archetype?: string;
}

export interface PromptFile extends PromptFileMeta {
  /** 文件正文，即 systemPrompt */
  systemPrompt: string;
  /** 文件绝对路径 */
  filePath: string;
}

/**
 * prompts 目录解析
 * - 位于仓库根目录 wenflow/prompts/（与 wenflow/backend, wenflow/frontend 同级）
 * - 可通过环境变量 PROMPTS_DIR 覆盖
 */
export const PROMPTS_DIR = process.env.PROMPTS_DIR
  ? path.resolve(process.env.PROMPTS_DIR)
  : path.resolve(__dirname, '../../../../prompts');

/** agentId -> 文件名（不含扩展名） */
export function agentIdToFileBase(agentId: string): string {
  return agentId.replace(/:/g, '.');
}

interface ParsedFrontmatter {
  meta: Record<string, any>;
  body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) {
    return { meta: {}, body: normalized.trim() };
  }
  const meta = (yaml.load(match[1]) as Record<string, any>) || {};
  return { meta, body: match[2].trim() };
}

function toNumberOrUndefined(value: any): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toStringArrayOrUndefined(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.map((v) => String(v).trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/** 解析单个文件内容为 PromptFile */
export function parsePromptFile(filePath: string, raw: string): PromptFile {
  const { meta, body } = parseFrontmatter(raw);

  const fileBase = path.basename(filePath).replace(/\.md$/i, '');
  // frontmatter 中的 agentId 优先；缺失时由文件名反推（. -> :）
  const agentId = (typeof meta.agentId === 'string' && meta.agentId.trim())
    ? meta.agentId.trim()
    : fileBase.replace(/\./g, ':');

  const name = (typeof meta.name === 'string' && meta.name.trim())
    ? meta.name.trim().replace(/^v\d+-/, '')
    : `default-${fileBase}`;

  return {
    agentId,
    name,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    temperature: toNumberOrUndefined(meta.temperature),
    maxTokens: toNumberOrUndefined(meta.maxTokens),
    acceptableAgentIds: toStringArrayOrUndefined(meta.acceptableAgentIds),
    archetype: typeof meta.archetype === 'string' ? meta.archetype.trim() : undefined,
    systemPrompt: body,
    filePath,
  };
}

/** 加载所有 prompt 文件 */
export function loadAllPromptFiles(): PromptFile[] {
  if (!fs.existsSync(PROMPTS_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(PROMPTS_DIR, { withFileTypes: true });
  const files: PromptFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.md$/i.test(entry.name)) continue;
    if (entry.name.startsWith('_')) continue; // 约定：下划线开头为非 prompt 辅助文件

    const filePath = path.join(PROMPTS_DIR, entry.name);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parsePromptFile(filePath, raw);

    if (!parsed.systemPrompt) {
      // 空 prompt 视为无效，跳过以免覆盖 DB 现有内容
      continue;
    }
    files.push(parsed);
  }

  return files.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/** 按 agentId 加载单个 prompt 文件（找不到返回 null） */
export function loadPromptFile(agentId: string): PromptFile | null {
  const fileBase = agentIdToFileBase(agentId);
  const filePath = path.join(PROMPTS_DIR, `${fileBase}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parsePromptFile(filePath, raw);
}

/** 将 PromptFile 元数据 + 正文序列化回 .md 文本（供导出/回写脚本使用） */
export function serializePromptFile(file: Omit<PromptFile, 'filePath'>): string {
  const meta: Record<string, any> = {
    agentId: file.agentId,
    name: file.name,
  };
  if (file.description) meta.description = file.description;
  if (file.archetype) meta.archetype = file.archetype;
  if (file.temperature !== undefined) meta.temperature = file.temperature;
  if (file.maxTokens !== undefined) meta.maxTokens = file.maxTokens;
  if (file.acceptableAgentIds && file.acceptableAgentIds.length > 0) {
    meta.acceptableAgentIds = file.acceptableAgentIds;
  }

  const frontmatter = yaml.dump(meta, { lineWidth: -1 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${file.systemPrompt.trim()}\n`;
}
