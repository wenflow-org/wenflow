/**
 * 板书绘图调用（2026-10-28 接线）：把 board-probe 里跑通的 board-designer 接进生产引擎。
 *
 * 与探针的差异：
 * - 走正式的 callPrompt（ACTIVE prompt / 模型路由 / 遥测 / 重试），不直连模型；
 * - 出口仍用 teaching-turn 的归一化（白名单图型 + spec 契约），保证前端渲染安全；
 * - 失败 fail-open：返回 null，由引擎保持旧板/无板，不阻断课堂。
 */
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { normalizeTeachingFigureForProbe, type TeachingFigure } from '../../skills/teaching-turn';
import { FIGURE_KIND_GUIDE } from './teaching-visual.service';
import type { BoardIntent } from './board-intent';

const BOARD_DESIGNER_PROMPT = loadPromptFile('skill:board-designer')?.systemPrompt || '';
// 图型契约（每种 kind 的 spec 字段）原本只在 teaching-turn 的 system prompt 里；board-designer
// 自己那份只讲「画到哪为止」。不拼进来，模型会照着脑补的 `states` 画 state-strip，归一化直接拒绝。
const BOARD_DESIGNER_SYSTEM = BOARD_DESIGNER_PROMPT
  ? `${BOARD_DESIGNER_PROMPT}\n\n${FIGURE_KIND_GUIDE}`
  : '';
/**
 * board-designer 是 teaching-turn 的视觉翻译器，跑在同一档对话模型上。
 * 不配置时路由会落到平台默认模型（当前是 deepseek-v4.1-flash-JUDGE，评测专用、无可用渠道），
 * 绘图调用会 503；这里显式钉回教学对话模型，保持两段调用同一视觉/语言水平。
 */
const BOARD_DESIGNER_MODEL = process.env.BOARD_DESIGNER_MODEL || 'deepseek-v4.1-flash';

export interface BoardDesignRequest {
  task: { title: string; description: string; taskType: string };
  scenario: { subject: string; topic: string; learnerLevel: string };
  studentSays: string;
  kindHint?: string | null;
  questionIntent: BoardIntent;
  lastTeacherReply?: string | null;
  instruction: string;
}

/**
 * 载荷投影（2026-11-08 全 skill 缓存调查）：提示词的「输入说明」只声明了
 * task / scenario / studentSays / kindHint / questionIntent / lastTeacherReply
 * （另加退板契约用的顶层 instruction），而 questionIntent 里还挂着 reason——
 * 那是给日志与老师侧看的**确定性解释串**（见 board-intent.ts 的 reasonParts），
 * 提示词零引用，属审计元数据泄漏进载荷，逐轮剥掉。
 */
function toBoardDesignPayload(request: BoardDesignRequest): Record<string, unknown> {
  const { reason: _reason, ...intent } = (request.questionIntent || {}) as BoardIntent & { reason?: string };
  return { ...request, questionIntent: intent };
}

/**
 * board-designer 的输出规格统一是 `{kind, spec}`，但 position-line 的契约（以及 teaching-turn
 * 的归一化器）要求 axis/marks/spans 在**顶层**。模型按统一规格把它们塞进 spec，归一化会
 * 整块拒绝（f10 实测：消费金额排队那张板因此没上墙）。这里只对 position-line 做拆包。
 */
function flattenPositionLineSpec(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const figure = raw as Record<string, unknown>;
  if (String(figure.kind ?? '') !== 'position-line') return raw;
  const spec = figure.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return raw;
  if (figure.axis || figure.marks || figure.spans || figure.guides) return raw;
  const merged: Record<string, unknown> = { ...figure };
  delete merged.spec;
  return { ...merged, ...(spec as Record<string, unknown>) };
}

/**
 * 解析 board-designer 的输出。
 *
 * `{"figure": null, "reason": "…"}` 是**合法且被鼓励**的一种回答（2026-11-02 实测驱动）：
 * 当任务的学习对象本身就是一组待读/待标注的句子、段落、题目时，板书只能退化成
 * 「把材料概括成结论短语 + 截断原文」——实测一节「在 6 个句子上标时间标志词」的课，
 * 板上 6 格写成「1 报告已完成 / 2 工作未决定…」，英文原句被截成「I have already finish…」，
 * 学生既读不到句子、又白拿了结论，板子对这节课是负价值。
 *
 * 必须**先判 null 再取 `?? output`**：`figure: null` 会被 `??` 当成 nullish 而回退到整个对象，
 * 归一化器收到 `{figure:null, reason}` 只会判 rejected-by-normalizer，然后白白重试一次。
 */
export function resolveBoardDesignerOutput(output: unknown):
  | { outcome: 'declined'; reason: string }
  | { outcome: 'figure'; figure: unknown } {
  const record = output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
  if (record && 'figure' in record && record.figure === null) {
    return { outcome: 'declined', reason: typeof record.reason === 'string' && record.reason.trim() ? record.reason.trim() : 'board-designer declined' };
  }
  return { outcome: 'figure', figure: record?.figure ?? output };
}

/** 材料条目：任务描述里「1. …」「2. …」这类编号原文（≥3 条才算成组材料） */
function numberedMaterialItems(taskDescription: string): string[] {
  const text = String(taskDescription || '');
  const items = text
    .split(/(?=(?:^|\s)\d{1,2}\s*[.、)]\s)/)
    .map((chunk) => chunk.replace(/^\s*\d{1,2}\s*[.、)]\s*/, '').trim())
    .filter((item) => item.length >= 20);
  return items.length >= 3 ? items : [];
}

/**
 * 材料被「概括成结论」的板（确定性拒绝，2026-11-02）：
 * 板面 ≥3 格用「编号 + 短语」的形态摆着（如「1 报告已完成」），但每格都没带上对应编号的材料原文——
 * 这正是把待读材料当成「图」的失败形态：学生读不到材料，结论反倒先给了。
 * 与提示词里的既有口径一致（board-designer 规则 4「只是把句子装进框的，不要画」；
 * 图型指南「表格、清单、分栏、步骤这类内容写在正文里」），这里把它变成不会漏的判据。
 * 只在「任务描述里确有 ≥3 条成组编号材料」时生效——普通讲解板不受影响。
 */
export function declinesParaphrasedMaterialBoard(taskDescription: string, figure: TeachingFigure | null): boolean {
  if (!figure) return false;
  const items = numberedMaterialItems(taskDescription);
  if (items.length < 3) return false;
  const labels: string[] = [];
  const collect = (value: unknown, depth = 0): void => {
    if (depth > 6 || !value) return;
    if (Array.isArray(value)) { value.forEach((v) => collect(v, depth + 1)); return; }
    if (typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // 只看 label（实体的名字），不看 sub——sub 正是被截断的那一层，不构成材料本体
      if (key === 'label' && typeof v === 'string') labels.push(v.trim());
      else collect(v, depth + 1);
    }
  };
  collect((figure as { spec?: unknown }).spec);
  const indexed = labels
    .map((label) => ({ label, index: Number(label.match(/^\s*(\d{1,2})\s*[.、)]?\s/)?.[1] ?? NaN) }))
    .filter((entry) => Number.isInteger(entry.index));
  if (indexed.length < 3) return false;
  const verbatim = indexed.some(({ label }) => items.some((item) => label.includes(item.slice(0, 12)) || item.includes(label)));
  return !verbatim;
}

export async function designBoard(
  request: BoardDesignRequest,
  context: { userId?: string; sessionId?: string; taskId?: string },
): Promise<{ figure: TeachingFigure | null; reason: string }> {
  if (!BOARD_DESIGNER_SYSTEM) return { figure: null, reason: 'board-designer prompt missing' };
  let lastReason = 'board-designer call failed';
  // 归一化拒绝（图型契约不成立/两栏逐行相同）是模型选错了形状，不是调用失败：
  // 换一条纠偏指令重画一次，仍不行才 fail-open。温度随重试抬高，避免 0 温稳定复现同一种错。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestForAttempt = attempt === 0 ? request : {
      ...request,
      instruction: `${request.instruction}\n上一次板面被系统校验拒绝（${lastReason}）：两栏每行文字完全相同、或结构契约不成立。请重画——左右两栏必须逐行能看出差异；若两栏只是同一批数据的两种排版，改用 position-line / range-bar / matrix 这类能承载真实关系的图型。`,
      questionIntent: {
        ...request.questionIntent,
        instruction: `${request.questionIntent.instruction}\n上一次板面被系统校验拒绝（${lastReason}），请换一种能真正承载当前关系的图型重画。`,
      },
    };
    try {
      const result = await callPrompt<BoardDesignRequest, { figure?: unknown }>({
        agentId: 'skill:board-designer',
        defaultSystemPrompt: BOARD_DESIGNER_PROMPT,
        requireActivePrompt: true,
        caller: { skillId: 'board-designer' },
        buildUserPayload: (payload) => toBoardDesignPayload(payload),
        normalizeOutput: (parsed) => parsed,
      }, requestForAttempt, {
        ...context,
        // 拼上图型契约后必须走 override：DB ACTIVE prompt 只存绘图员正文，不含 guide。
        systemPromptOverride: BOARD_DESIGNER_SYSTEM,
        // 板图 spec 本身只有一两千字，但该模型会先花几千 reasoning token；ACTIVE prompt 的
        // 4000 预算会被推理吃满、正文为空（finishReason=length），必须留出正文空间。
        generationOverride: {
          model: BOARD_DESIGNER_MODEL,
          temperature: attempt === 0 ? 0.2 : 0.45,
          maxTokens: 16_000,
        },
      });
      if (!result.success || !result.output) {
        return { figure: null, reason: result.error?.message || 'board-designer call failed' };
      }
      const resolved = resolveBoardDesignerOutput(result.output);
      if (resolved.outcome === 'declined') {
        // 明确声明「这块不该画板」：不重试（重试只会逼它硬画一张）。
        return { figure: null, reason: `board-designer declined: ${resolved.reason}` };
      }
      const normalized = normalizeTeachingFigureForProbe(flattenPositionLineSpec(resolved.figure));
      if (normalized.figure && declinesParaphrasedMaterialBoard(request.task.description, normalized.figure)) {
        // 材料被概括成结论短语的板对这节课是负价值：撤板，让材料回到对话正文里（老师侧有
        // 「无 boardContext → reply 必须纯文本自足」的既有闸兜住）。
        return { figure: null, reason: 'material-paraphrase-board（板面把编号材料概括成短语，学生读不到材料本体）' };
      }
      if (normalized.figure || normalized.reason !== 'rejected-by-normalizer' || attempt === 1) {
        return normalized;
      }
      lastReason = normalized.reason;
    } catch (error) {
      return { figure: null, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return { figure: null, reason: lastReason };
}
