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
        buildUserPayload: (payload) => payload,
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
      const raw = (result.output as { figure?: unknown }).figure ?? result.output;
      const normalized = normalizeTeachingFigureForProbe(flattenPositionLineSpec(raw));
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
