/**
 * 教学配图（课堂内联的生成图）—— owner 口径 2026-09-23：**「图片是一种特殊的文字，放在教学中」**。
 *
 * 三条原则：
 *   ① **文本是唯一真相源**：图由老师给的**文字描述**（`visual.prompt`）生成，prompt 即原文，可回溯；
 *   ② **图内联在课堂消息流里**，像一段文字一样（不是附件区、不是弹窗）；
 *   ③ **文本脱离图也成立**：图只是辅助，`reply` 必须自洽——"不得依赖图片推进"的既有规则不推翻，
 *      只是加一条"允许附图作辅助"（提示词侧有硬规则，这里不重复）。
 *
 * 分工（与全仓纪律一致）：**LLM 只"请求"**（teaching-turn 输出可选 `visual` 块），
 * **代码裁决要不要真的画**——闸门都在这里：
 *   - 开关 `TEACHING_VISUAL_DISABLED=1` → 一律不生成（灰度回滚）；
 *   - 每会话 ≤ `TEACHING_VISUAL_MAX_PER_SESSION`（默认 6）张（单回合天然 ≤1）；
 *   - prompt 过短/空白 → 不生成；
 *   - 生成失败/超时 → 只告警，**绝不阻断课堂**（fail-open，与 material-collector 同款）。
 *
 * 成本提示：单张实测约 12s 且计费，故必须有上限；上限可 env 调。
 */

import { logger } from '../../utils/logger';
import { generateImages } from '../image';
import { ImageError, type ImageRatio } from '../image/types';
import type { TeachingImage, TeachingSessionMessage } from './TeachingSessionRepository';

/** 老师请求的配图（teaching-turn 输出的可选顶层块 `visual`）。 */
export interface TeachingVisualRequest {
  /** 画面描述（必填）：要画什么，取自当前教学内容的文字 */
  prompt: string;
  /** 图的说明文字（学生可见；可空） */
  caption?: string | null;
  /** 图类型（示意图/插画/对比图…）：仅作 prompt 润色与留痕 */
  kind?: string | null;
}

export type { TeachingImage };

export const DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION = 6;
/** 每个任务（= 一个教学会话）最多几张：**代码硬闸门**（此前只在提示词里，模型可自行绕过）。 */
export const DEFAULT_TEACHING_VISUAL_MAX_PER_TASK = 1;
/** 生图超时（毫秒）：实测单张约 12s，给足余量但不无限等。 */
export const DEFAULT_TEACHING_VISUAL_TIMEOUT_MS = 60_000;
/** 画面描述最短长度（太短无信息量，不值得画）。 */
const MIN_VISUAL_PROMPT_CHARS = 6;
const MAX_VISUAL_PROMPT_CHARS = 800;

/** 开关：`TEACHING_VISUAL_DISABLED=1` 时课堂一律不配图（灰度回滚）。 */
export function isTeachingVisualEnabled(): boolean {
  return process.env.TEACHING_VISUAL_DISABLED !== '1';
}

/** 每会话上限（正整数；非法值回落默认并告警）。 */
export function resolveTeachingVisualMaxPerSession(value = process.env.TEACHING_VISUAL_MAX_PER_SESSION): number {
  if (!value || String(value).trim() === '') return DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`[teaching-visual] TEACHING_VISUAL_MAX_PER_SESSION 无效（${value}），使用默认 ${DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION}`);
    return DEFAULT_TEACHING_VISUAL_MAX_PER_SESSION;
  }
  return parsed;
}

/**
 * 每**任务**上限（默认 1）。一个教学会话 = 一个任务，所以判据就是"本会话已有几张图"。
 * 这是**代码硬闸门**：此前"同一任务最多配一次"只写在提示词里，实测模型会自行绕过（一次任务出了 3 张）。
 */
export function resolveTeachingVisualMaxPerTask(value = process.env.TEACHING_VISUAL_MAX_PER_TASK): number {
  if (!value || String(value).trim() === '') return DEFAULT_TEACHING_VISUAL_MAX_PER_TASK;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`[teaching-visual] TEACHING_VISUAL_MAX_PER_TASK 无效（${value}），使用默认 ${DEFAULT_TEACHING_VISUAL_MAX_PER_TASK}`);
    return DEFAULT_TEACHING_VISUAL_MAX_PER_TASK;
  }
  return parsed;
}

/** 课堂里已有的配图数量（用于上限判定）。 */
export function countTeachingVisuals(messages: TeachingSessionMessage[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message) => sum + (Array.isArray(message?.images) ? message.images.length : 0), 0);
}

/**
 * 组最终生图 prompt：**风格前缀 + 老师的描述**。
 * 风格前缀固定（教学示意图口径），描述原样保留——prompt 即"图所渲染的那段文字"。
 */
export function composeTeachingVisualPrompt(request: TeachingVisualRequest): string {
  const kind = String(request?.kind || '').trim();
  const subject = String(request?.prompt || '').trim().slice(0, MAX_VISUAL_PROMPT_CHARS);
  const style = [
    '教学示意图（课堂辅助用）',
    kind ? `类型：${kind}` : null,
    '要求：白底、简洁、线条清晰、结构明确，只画描述里说的内容；不要多余的装饰与无关文字',
    '如画面需要标注，用简短中文',
    '构图：横向关系用横向构图，纵向层级用纵向构图，画面留白充足',
  ].filter(Boolean).join('；');
  return `${style}。画面内容：${subject}`;
}

/**
 * 教学配图规格：`kind`/`prompt` → **精确尺寸（主）+ 同向 ratio（兜底）**（代码裁决，不让模型自选）。
 *
 * 实测矩阵（本仓网关 = 自建 new-api，`IMAGE_API_URL`）：
 * - 精确尺寸（`1312x736`）：**透传开/关都生效**（`1024x768`→就近档位 1152x864）；
 * - 文档写法 `size:'1K' + ratio`：透传开启后生效，但 **`2K` + ratio 不生效**（回 2048x2048 方图）；
 * - `size` 与 `ratio` **冲突时 size 胜**（`1312x736`+`ratio:3:4` → 仍 1312x736）。
 * 故以精确尺寸为准、同向 ratio 作兜底：既确定，又能在"网关忽略精确尺寸"时靠 ratio 兜住。
 *
 * 默认 1:1；横向结构（位置线/流程/时间轴）给 16:9——否则信息被压扁。
 * 判据同时看 `kind` 与 `prompt`：**实测老师常把 kind 写成笼统的"示意图"**，方向线索其实在 prompt 里
 * （提示词已要求横向关系在 prompt 里注明"横向构图"）。未命中回落 1:1，绝不抛错。
 */
export function resolveTeachingVisualSpec(
  kind?: string | null,
  prompt?: string | null
): { size: string; ratio: ImageRatio } {
  const text = `${String(kind || '')} ${String(prompt || '')}`;
  // 显式方向优先（提示词已要求横向关系在 prompt 里注明"横向构图"）；
  // 弱词（竖直/层级）**不作强信号**——实测"用一条竖直虚线标出间隔距离"会把横向位置线误判成纵向。
  if (/横向|水平|横着|从左到右|从左往右/.test(text)) return { size: '1312x736', ratio: '16:9' };
  if (/纵向|垂直|剖面|树形|自上而下|从上到下/.test(text)) return { size: '864x1152', ratio: '3:4' };
  if (/流程|时序|时间轴|位置|过程|循环|链条|步骤|线路|方向/.test(text)) {
    return { size: '1312x736', ratio: '16:9' };
  }
  if (/对比|对照|并列|比较/.test(text)) return { size: '1152x864', ratio: '4:3' };
  if (/层级|结构|装配|组织|分类/.test(text)) return { size: '864x1152', ratio: '3:4' };
  return { size: '1024x1024', ratio: '1:1' };
}

/** 描述是否值得画（空白/过短直接不画）。 */
export function isUsableVisualPrompt(request: TeachingVisualRequest | null | undefined): boolean {
  const text = String(request?.prompt || '').trim();
  return text.length >= MIN_VISUAL_PROMPT_CHARS;
}

/** ASCII 结构图特征字符：箭头 / 方框 / 圆点 / 长横线 —— 老师"用字符硬画结构"的痕迹。 */
const ASCII_STRUCTURE_CHARS = /[→←↑↓─━│┃┌┐└┘├┤┬┴┼●○■□▲▼◆◇]/g;

/**
 * 老师是否在本轮回复里**用字符画结构**（ASCII 示意）。
 *
 * 这是"这里本来需要一张图"的**高精度可观测信号**（2026-09-23 实测：小学"位置线"课上，
 * 老师画出了 `甲（前）●———→ 方向 →`、`┌────┬───────┬───────┐`、`（前面）小明 → 走的方向 → （后面）小红`
 * 这类字符图，却不会主动请求 `visual`）。
 *
 * 判据：结构字符 **≥2 个**即视为"在摆结构"——单个箭头出现在行文里（"甲→乙"）不算；
 * 而位置线/链条/方框/流程都会 ≥2。（首版要求"≥3 个且≥2 种"，实测漏掉了 `A → … → B` 这种纯箭头结构。）
 */
export function detectAsciiStructure(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  if (!value) return false;
  const hits = value.match(ASCII_STRUCTURE_CHARS) || [];
  return hits.length >= 2;
}

/** 本轮"配图时机"信号（喂给教学回合的**显式**输入，见 buildVisualOpportunity 注释）。 */
export interface VisualOpportunity {
  suggested: true;
  reason: 'ascii-structure';
  /** 给模型的**显式、正向**要求 */
  instruction: string;
}

/**
 * 算本轮的配图时机（**代码裁决**，2026-09-23）。
 *
 * 为什么由代码算、且要写进**本轮输入**：实测同一个 system prompt + 同一份输入，
 * 埋在 2 万字 prompt 里的规则（三档加码）全被忽略，而**把要求显式放进该轮输入**一次就生效。
 * 所以时机必须由代码判定后**显式送进去**，模型只负责"画什么"。
 *
 * 当前信号（S1，高精度）：**上一轮老师用字符画了结构**（ASCII 示意）——那正是"这里本来需要图"的证据。
 * 且本任务尚未配过图（一个教学会话 = 一个任务）。
 */
export function buildVisualOpportunity(messages: TeachingSessionMessage[] | null | undefined): VisualOpportunity | null {
  if (!isTeachingVisualEnabled()) return null;
  const list = Array.isArray(messages) ? messages : [];
  if (countTeachingVisuals(list) > 0) return null;
  const lastAssistant = [...list].reverse().find((message) => message?.role === 'assistant');
  if (!detectAsciiStructure(lastAssistant?.content)) return null;
  return {
    suggested: true,
    reason: 'ascii-structure',
    instruction:
      '上一轮你用了箭头/方框/字符在 reply 里"画"结构——那说明这里本来就需要一张图。'
      + '本轮请改为输出顶层块 visual：在 prompt 里把这张图画清楚（主体与关系），caption 写一句给学生看的说明；'
      + 'reply 里不必再用字符画结构。',
  };
}

export interface GenerateTeachingVisualDeps {
  /** 注入生图（测试用）；缺省走真实 provider 链。 */
  generate?: typeof generateImages;
  now?: () => Date;
}

export interface GenerateTeachingVisualInput {
  request: TeachingVisualRequest | null | undefined;
  /** 该会话**已落库**的消息（用于上限判定）。 */
  messages?: TeachingSessionMessage[] | null;
  signal?: AbortSignal;
  deps?: GenerateTeachingVisualDeps;
}

/**
 * 按闸门决定是否生成一张教学配图；**任何失败都返回 null，绝不抛**（课堂不能被图拖垮）。
 */
export async function generateTeachingVisual(input: GenerateTeachingVisualInput): Promise<TeachingImage | null> {
  if (!isTeachingVisualEnabled()) return null;
  const request = input.request;
  if (!isUsableVisualPrompt(request)) return null;

  const used = countTeachingVisuals(input.messages);
  // ① 每任务（= 本教学会话）硬闸门：默认 1 张——"同一任务最多配一次"不能只靠提示词
  const maxPerTask = resolveTeachingVisualMaxPerTask();
  if (used >= maxPerTask) {
    logger.info('[teaching-visual] 本任务已达配图上限，本轮跳过', { used, maxPerTask });
    return null;
  }
  // ② 每会话上限（外圈兜底）
  const max = resolveTeachingVisualMaxPerSession();
  if (used >= max) {
    logger.info('[teaching-visual] 已达每会话配图上限，本轮跳过', { used, max });
    return null;
  }

  const prompt = composeTeachingVisualPrompt(request as TeachingVisualRequest);
  const visualSpec = resolveTeachingVisualSpec(request?.kind, request?.prompt);
  const generate = input.deps?.generate ?? generateImages;
  try {
    const result = await generate(
      {
        prompt,
        n: 1,
        // 精确尺寸（主）+ 同向 ratio（兜底）：横向结构不再被压成方图
        size: visualSpec.size,
        ratio: visualSpec.ratio,
        responseFormat: 'url',
        purpose: 'classroom-visual-aid',
      },
      { signal: input.signal, timeoutMs: DEFAULT_TEACHING_VISUAL_TIMEOUT_MS },
    );
    const first = result.images.find((image) => image?.url || image?.b64Json);
    const url = first?.url || (first?.b64Json ? `data:image/png;base64,${first.b64Json}` : '');
    if (!url) return null;
    const createdAt = (input.deps?.now?.() ?? new Date()).toISOString();
    logger.info('[teaching-visual] 课堂配图已生成', {
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      kind: request?.kind ?? null,
    });
    return {
      url,
      caption: String(request?.caption || '').trim() || null,
      prompt,
      provider: result.provider,
      model: result.model,
      kind: String(request?.kind || '').trim() || null,
      createdAt,
    };
  } catch (error) {
    logger.warn('[teaching-visual] 课堂配图生成失败（不阻断课堂）', {
      code: error instanceof ImageError ? error.code : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
