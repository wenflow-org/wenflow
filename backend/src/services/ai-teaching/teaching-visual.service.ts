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
 *   - 同 prompt 本会话已画过 → 不重复生成（不重复计费，2026-09-26）；
 *   - 生成失败/超时 → 只告警，**绝不阻断课堂**（fail-open，与 material-collector 同款）；
 *     瞬时失败（超时/不可用/5xx/空结果）且失败得快 → 有界重试一次（2026-09-26）。
 *
 * 成本提示：单张实测约 12s 且计费，故必须有上限；上限可 env 调。
 */

import { logger } from '../../utils/logger';
import { generateImages } from '../image';
import { ImageError, type ImageErrorCode, type ImageRatio } from '../image/types';
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
/**
 * 每个**任务**（= 一个教学会话）的配图上限：owner 口径 2026-09-25 **放开每任务 1 张的限制**——
 * 图该出就出，由外圈每会话上限（6）兜底防失控。设 `TEACHING_VISUAL_MAX_PER_TASK` 可再收紧（回滚用），
 * 0 或负数 = 不限。历史背景：此闸门曾因"提示词挡不住模型自发出图"而代码化为 1；现在改为只拦会话级总量。
 */
export const DEFAULT_TEACHING_VISUAL_MAX_PER_TASK = Number.POSITIVE_INFINITY;
/** 生图超时（毫秒）：实测单张约 12s，给足余量但不无限等。 */
export const DEFAULT_TEACHING_VISUAL_TIMEOUT_MS = 60_000;
/** 画面描述最短长度（太短无信息量，不值得画）。 */
const MIN_VISUAL_PROMPT_CHARS = 6;
const MAX_VISUAL_PROMPT_CHARS = 800;

/** 开关：`TEACHING_VISUAL_DISABLED=1` 时课堂一律不配图（灰度回滚）。 */
export function isTeachingVisualEnabled(): boolean {
  // owner 终审 2026-09-27（设计文档 §九）：扩散生图**停用**——「我没感觉这些图有任何的教育意义」
  // （17 样本实测：语义全在 caption、结构类还会语义反转）。默认关闭；仅显式设
  // TEACHING_VISUAL_ENABLED=1 时启用（实验/回放用，生产不设）。
  return process.env.TEACHING_VISUAL_ENABLED === '1';
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
 * 每**任务**上限（**默认不限**；0/负数 = 不限）。一个教学会话 = 一个任务，所以判据就是"本会话已有几张图"。
 * owner 口径 2026-09-25：放开"每任务 1 张"，图该出就出，由每会话上限兜底；env 设正整数可再收紧（回滚用）。
 * 历史背景：闸门因"提示词挡不住模型自发出图（一次 3 张）"而代码化为 1，现仅保留会话级总量控制。
 */
export function resolveTeachingVisualMaxPerTask(value = process.env.TEACHING_VISUAL_MAX_PER_TASK): number {
  if (!value || String(value).trim() === '') return DEFAULT_TEACHING_VISUAL_MAX_PER_TASK;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return Number.POSITIVE_INFINITY;
  return parsed === 0 ? Number.POSITIVE_INFINITY : parsed;
}

/** 课堂里已有的配图数量（用于上限判定）。 */
export function countTeachingVisuals(messages: TeachingSessionMessage[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message) => sum + (Array.isArray(message?.images) ? message.images.length : 0), 0);
}

/**
 * 组最终生图 prompt：**风格前缀 + 老师的描述**。
 * owner 口径 2026-09-24：图是"特殊的文字字符"——它呈现教学内容的**抽象关系**，但**不以文字形态出现**。
 * 实测（doc/re_test/img-audit）：生图模型图内中文必坏（6 处标注 6 处乱码），故硬禁图内文字；
 * 说明职责交给图下方 caption/reply（真实文本渠道）。
 */
export function composeTeachingVisualPrompt(request: TeachingVisualRequest): string {
  const kind = String(request?.kind || '').trim();
  const subject = String(request?.prompt || '').trim().slice(0, MAX_VISUAL_PROMPT_CHARS);
  const style = [
    '教学示意图（课堂辅助用）',
    kind ? `类型：${kind}` : null,
    '要求：简洁、线条清晰、结构明确，只画描述里说的内容；不要多余的装饰与无关文字',
    '画面里不要出现任何文字：不要标签、不要对话气泡、不要表格与编号；要说明的内容由图下方的说明文字承担，至多保留极少量数字符号',
    '画关系不画故事：画面呈现的是顺序/层级/包含/对比/变化这类抽象关系；状态差异要画出可见区别（如满/半、开/合）',
    '构图：横向关系用横向构图，纵向层级用纵向构图，画面留白充足',
  ].filter(Boolean).join('；');
  // 收尾再钉一次"无字"：老师的描述里常自带"标注××"类要求，放在末尾压过它（图像模型对尾部指令权重高）
  return `${style}。画面内容：${subject}。再次强调：画面内不出现文字与标注，只画图形与关系。`;
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

/**
 * 回复是否在同轮布置了「由学生自己排出/画出该结构」的练习——此时配图 = 把答案先画给学生（答案泄漏）。
 *
 * 为什么代码化（2026-09-24 配图审计，doc/re_test/img-audit）：提示词例外句实测压不过"配图时机"信号
 * （同一 payload 三次重放均仍出图），与 maxPerTask"提示词会被忽略→代码硬闸门"同思路。
 * 判据刻意收紧（请你在纸上/把它排成/动手排这类明确指令），只拦真泄漏；宁漏不误——少配一张图无害。
 */
const EXERCISE_LEAK_PATTERNS: RegExp[] = [
  /请你在(纸上|这里|下面)[^。！？\n]{0,24}(排|画|摆|写)/,
  /请你(把|将)(它|这些|上面|刚才)[^。！？\n]{0,12}(排|画|摆)(一|成|出)/,
  /在(纸上|草稿上)[^。！？\n]{0,24}(排|画|摆)(一|成|出|个)/,
  /(你|先|来|动手|自己)(排|画|摆)一(排|遍|下|个)/,
  /横着排(一|一遍)/,
];

export function detectExerciseLeakInReply(reply: string | null | undefined): boolean {
  const text = String(reply ?? '');
  if (!text) return false;
  return EXERCISE_LEAK_PATTERNS.some((pattern) => pattern.test(text));
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

/** 本轮"结构图/配图时机"信号（喂给教学回合的**显式**输入，见 buildVisualOpportunity 注释）。 */
export interface VisualOpportunity {
  suggested: true;
  reason: 'ascii-structure' | 'position-description';
  /** 给模型的**显式、正向**要求 */
  instruction: string;
}

/**
 * 学生用文字描述**空间位置关系**的语言特征（位置/方向/距离/先后）。
 * 判据：≥2 种特征词、或 ≥3 处命中——单个「后面」这种日常用词不算（宁漏不误）。
 */
const POSITION_LANGUAGE = /(相距|追及|追上|相遇|同向|相向|背向|在前|在后|前面|后面|左边|右边|左侧|右侧|左端|右端|往右|往左|向东|向西|向南|向北|速度差|先出发|位置线|起点|终点)/g;

export function detectPositionDescription(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  if (!value) return false;
  const hits = value.match(POSITION_LANGUAGE) || [];
  return new Set(hits).size >= 2 || hits.length >= 3;
}

/** 位置线图每会话上限（默认 4；防"每轮都摆一遍"）。 */
const DEFAULT_FIGURE_MAX_PER_SESSION = 4;

export function resolveFigureMaxPerSession(value = process.env.TEACHING_FIGURE_MAX_PER_SESSION): number {
  if (!value || String(value).trim() === '') return DEFAULT_FIGURE_MAX_PER_SESSION;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    logger.warn(`[teaching-visual] TEACHING_FIGURE_MAX_PER_SESSION 无效（${value}），使用默认 ${DEFAULT_FIGURE_MAX_PER_SESSION}`);
    return DEFAULT_FIGURE_MAX_PER_SESSION;
  }
  return parsed;
}

/** 本会话已摆过的位置线图数量（上限判定用）。 */
export function countTeachingFigures(messages: TeachingSessionMessage[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message) => sum + (Array.isArray(message?.figures) ? message.figures.length : 0), 0);
}

/** 上一轮老师已经摆过位置线 → 本轮不再重复摆（判据天然带节奏）。 */
function lastAssistantHasFigure(messages: TeachingSessionMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === 'assistant');
  return Boolean(lastAssistant && Array.isArray(lastAssistant.figures) && lastAssistant.figures.length);
}


/**
 * 算本轮的"结构图时机"（**代码裁决**，2026-09-23 建、2026-09-27 双通道重构）。
 *
 * 为什么由代码算、且要写进**本轮输入**：实测同一个 system prompt + 同一份输入，
 * 埋在 2 万字 prompt 里的规则（三档加码）全被忽略，而**把要求显式放进该轮输入**一次就生效。
 * 所以时机必须由代码判定后**显式送进去**，模型只负责"画什么"。
 *
 * 当前信号（S1，高精度）：**上一轮老师用字符画了结构**（ASCII 示意）——那正是"这里本来需要图"的证据。
 * owner 口径 2026-09-25 放开"每任务一次"后允许重复触发：只要**紧邻上一轮**又画了字符结构就再提示
 * （判据天然带节奏——不画结构的轮次不会触发）；总量仍由每会话上限兜底。
 *
 * 2026-09-27 重构要点：去向从"扩散生图（visual）"改为**确定性渲染（diagram/mermaid）**——
 * 字符画本身就是最精简的结构图，翻成扩散生图会丢语义精度（断口丢失事故）且图内不能标字；
 * mermaid 零乱码、图内可写中文标签、毫秒渲染零成本（owner 终审拍板双通道，设计文档 §七-§十）。
 */
export function buildVisualOpportunity(messages: TeachingSessionMessage[] | null | undefined): VisualOpportunity | null {
  if (!isTeachingVisualEnabled() && !isTeachingDiagramOpportunityEnabled()) return null;
  const list = Array.isArray(messages) ? messages : [];
  const lastAssistant = [...list].reverse().find((message) => message?.role === 'assistant');
  if (detectAsciiStructure(lastAssistant?.content)) {
    return {
      suggested: true,
      reason: 'ascii-structure',
      instruction:
        '上一轮你用了箭头/方框/字符在 reply 里"画"结构——那说明这里本来就需要一张图，而且**别再用字符画**。'
        + '**先判断**：若本轮正要布置「由学习者自己排出/画出这个结构」的练习（答案泄漏，2026-09-24 实测），'
        + '则本轮**不要**输出 diagram/figure，直接布置练习，把图留到学生完成后的下一轮总结印证时再用；'
        + '**再分流**：内容是**空间位置关系**（谁在前谁在后、朝哪走、隔多远、追及/相遇）→ 输出 `figure`（位置线图，'
        + '数值域 + 对象 + 朝向箭头 + 区间标注，mermaid 画不出位置）；其余结构类（流程/层级/时序/对比）→ 输出 `diagram`：'
        + 'engine 用 mermaid，把这段结构画成 flowchart（流程/层级/对比）或 sequenceDiagram（时序）——'
        + '**图内要写中文标签**（节点名、关键量、方向词），标签就是教学信息本身；'
        + 'caption 写一句给学生看的说明；reply 里不必再用字符画结构。',
    };
  }
  // 位置线时机（Scope B，2026-09-27 语料实证的"正当时机①：学生描述完 → 外化其描述以核验"）：
  // 学生上一轮在用文字描述位置关系（谁在前谁在后、朝哪走、隔多远）——那正是位置线该出场的时候。
  // 上一轮老师已摆过 / 本会话已达上限 → 不再触发（判据天然带节奏）。
  const lastUser = [...list].reverse().find((message) => message?.role === 'user');
  if (detectPositionDescription(lastUser?.content)) {
    if (lastAssistantHasFigure(list)) return null;
    if (countTeachingFigures(list) >= resolveFigureMaxPerSession()) return null;
    return {
      suggested: true,
      reason: 'position-description',
      instruction:
        '学生正在用文字描述**空间位置关系**（谁在前谁在后、朝哪走、隔多远）——把他说的话**摆成一条位置线**给他核验，'
        + '这是这类课的共同坐标系。**先判断**：若本轮正要布置「由学习者自己画/摆出这条位置线」的练习（答案泄漏），'
        + '则本轮**不要**输出 figure，直接布置练习；否则输出顶层块 `figure`（kind 用 position-line，'
        + 'marks 写学生的对象与朝向、spans 写他提到的距离、guides 写追及点/相遇点这类参考位置），'
        + '**图内标签写学科实指**（甲/乙/小明/追及点）；caption 一句给学生看的话；**不要**改用 mermaid（节点-边画不出位置）。'
        + 'reply 里不必再复述位置关系。',
    };
  }
  return null;
}

/** 结构图时机开关（新通道，默认开启；env 可关用于回放对照）。 */
export function isTeachingDiagramOpportunityEnabled(): boolean {
  return process.env.TEACHING_DIAGRAM_DISABLED !== '1';
}

export interface GenerateTeachingVisualDeps {
  /** 注入生图（测试用）；缺省走真实 provider 链。 */
  generate?: typeof generateImages;
  now?: () => Date;
}

/**
 * 同 prompt 去重（2026-09-26）：本会话已经生成过**一模一样 composed prompt** 的图就不再生成——
 * 生成约 12s 且计费，老师反复请求同一张图（学生没看懂再讲一遍）不应重复扣费。
 * 返回 null 是安全的：文本自洽原则（③）本就要求 reply 不依赖图。
 */
export function hasIdenticalVisualPrompt(
  messages: TeachingSessionMessage[] | null | undefined,
  prompt: string
): boolean {
  if (!Array.isArray(messages) || !prompt) return false;
  return messages.some((message) =>
    Array.isArray(message?.images) ? message.images.some((image) => image?.prompt === prompt) : false
  );
}

/** 瞬时失败有界重试（2026-09-26）：只重试"快速失败"的瞬错误，失败耗时超预算（≈真超时）不重试。 */
const VISUAL_RETRY_ELAPSED_BUDGET_MS = 15_000;
const RETRYABLE_IMAGE_CODES: ReadonlySet<ImageErrorCode> = new Set<ImageErrorCode>([
  'IMAGE_UPSTREAM_TIMEOUT',
  'IMAGE_UPSTREAM_UNAVAILABLE',
  'IMAGE_EMPTY_RESULT',
]);

function isRetryableImageError(error: unknown): boolean {
  if (!(error instanceof ImageError)) return false;
  if (RETRYABLE_IMAGE_CODES.has(error.code)) return true;
  // HTTP 错误只重试 5xx（上游抖动）；4xx 是请求本身的问题，重试必然复现
  return error.code === 'IMAGE_UPSTREAM_HTTP_ERROR' && (error.status === undefined || error.status >= 500);
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
  // ③ 同 prompt 去重：本会话画过一模一样的图就不重复计费
  if (hasIdenticalVisualPrompt(input.messages, prompt)) {
    logger.info('[teaching-visual] 本会话已生成过同 prompt 配图，跳过（不重复计费）');
    return null;
  }
  const visualSpec = resolveTeachingVisualSpec(request?.kind, request?.prompt);
  const generate = input.deps?.generate ?? generateImages;
  const imageRequest = {
    prompt,
    n: 1,
    // 精确尺寸（主）+ 同向 ratio（兜底）：横向结构不再被压成方图
    size: visualSpec.size,
    ratio: visualSpec.ratio,
    responseFormat: 'url',
    purpose: 'classroom-visual-aid',
  } as const;
  const generateOptions = { signal: input.signal, timeoutMs: DEFAULT_TEACHING_VISUAL_TIMEOUT_MS };
  // 可注入时钟统一成毫秒数（deps.now 返回 Date；缺省 Date.now 返回 number——重试预算只做差值比较）
  const depsClock = (): number => {
    const value = (input.deps?.now ?? Date.now)();
    return value instanceof Date ? value.getTime() : value;
  };
  const attemptStartedAt = depsClock();
  try {
    let result;
    try {
      result = await generate(imageRequest, generateOptions);
    } catch (error) {
      // 瞬时失败（超时/上游不可用/空结果/5xx）且**失败得够快** → 有界重试一次。
      // 预算检查保证重试只发生在快速失败上（真超时 60s 的重试会把课堂拖到 2 分钟，绝不重试）。
      const elapsedMs = depsClock() - attemptStartedAt;
      if (!isRetryableImageError(error) || elapsedMs > VISUAL_RETRY_ELAPSED_BUDGET_MS) throw error;
      logger.warn('[teaching-visual] 配图瞬时失败，有界重试一次', {
        code: error instanceof ImageError ? error.code : undefined,
        elapsedMs,
      });
      result = await generate(imageRequest, generateOptions);
    }
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
