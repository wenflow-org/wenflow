/**
 * 视觉节点（2026-11-26 契约层拆分）：把 teaching-turn 的**视觉意图**翻译成一张图。
 *
 * 为什么单独一步：模型不应该在一轮里同时当老师和前端绘图工程师。teaching-turn 只交
 * `{need, relation, focus}`；这里复用已有的 teaching-board-design 单图模式（同一套归一化、
 * 图型白名单、答案泄漏与退化拦截），失败 fail-open——没有图，课堂照常。
 *
 * 只在 `visualOpportunity.suggested` 的回合被调用（一节 1–2 次），不是逐轮开销。
 */
import { designBoard, type BoardDesignRequest } from './teaching-board-design.service';
import { decideBoardIntent } from './board-intent';
import type { TeachingFigure, TeachingVisualIntent } from '../../skills/teaching-turn';
import { logger } from '../../utils/logger';

const PLAN_TIMEOUT_MS = 25_000;

/** relation → 推荐图型（模型没给 kindHint 时用；绘图节点仍可拒绝/换型）。 */
const RELATION_KIND: Record<TeachingVisualIntent['relation'], string | null> = {
  position: 'position-line',
  range: 'range-bar',
  trajectory: 'cartesian-plot',
  split: 'split-compare',
  overlap: 'venn',
  hierarchy: 'tree',
  cycle: 'cycle',
  matrix: 'matrix',
  structure: 'concept-map',
  none: null,
};

/** relation → 给绘图员的一句话（只说关系，不说画法细节——细节在图型契约里）。 */
const RELATION_INSTRUCTION: Record<TeachingVisualIntent['relation'], string> = {
  position: '画一条位置线：谁在前/后、朝哪个方向、相距多少，用材料里的真实数值。',
  range: '画并排的数值区间/范围（每组上下限），不要画成时间轴。',
  trajectory: '画二维坐标图：横纵轴是什么量、曲线/轨迹怎么走，数值用材料里的真实量纲。',
  split: '画正误并排对照：左右是同一动作的两种走法、逐行对齐、标出分叉在第几步。',
  overlap: '画两个概念的交集与各自独有部分。',
  hierarchy: '画层级/分类树：空间位置只表示层级，不表示方位或先后。',
  cycle: '画首尾相接的闭环。',
  matrix: '画二维对账矩阵（有/无/重复/同一项），不要放逐格数值数据表。',
  structure: '按内容的真实结构画：节点是学科实体，每条边写清关系名。',
  none: '不需要视觉介入。',
};

/** kind → relation 的反查（模型没交 visualIntent 时，用编排层的判据还原意图）。 */
const KIND_RELATION: Record<string, TeachingVisualIntent['relation']> = {
  'position-line': 'position',
  'range-bar': 'range',
  'cartesian-plot': 'trajectory',
  'split-compare': 'split',
  venn: 'overlap',
  tree: 'hierarchy',
  cycle: 'cycle',
  matrix: 'matrix',
  'concept-map': 'structure',
  'state-strip': 'structure',
};

/**
 * 编排层已判定「本轮该出图」时，模型没交 `visualIntent` 的兜底：
 * 从 opportunity 的 kindHint / ruleWhy / matched 还原一个意图。
 *
 * 为什么需要：出图时机本来就是代码判据（`buildVisualOpportunity`），模型只负责补关系与焦点。
 * 实测 flash 会漏掉这个可选字段；漏了不等于时机不存在——否则「代码判了要画、课堂却没图」
 * 就成了新的知行不合一。模型显式给了 need=false 时不走这里（尊重模型的否定）。
 */
export function intentFromOpportunity(
  opportunity: { kindHint?: string | null; ruleWhy?: string | null; matched?: string[] | null } | null | undefined,
): TeachingVisualIntent | null {
  if (!opportunity) return null;
  const kind = String(opportunity.kindHint || '').trim();
  const relation = KIND_RELATION[kind] || 'structure';
  const focus = String(opportunity.ruleWhy || '').trim()
    || (opportunity.matched?.length ? opportunity.matched.join('；') : '本轮内容的结构关系');
  return {
    need: true,
    relation,
    focus: focus.slice(0, 120),
    kindHint: kind || null,
  };
}

/**
 * 「整课结构图」在点名/建构阶段暂不给机会：这一阶段正在一段一段建，预先画全图把后几段的
 * 关系提前摆出来，分段与时间邻近一起破。整合/迁移/审错再画才是总结图。
 * 学生驱动的时机（位置线/时间轴/字符结构）不在这里判——那张图核验的是学生自己刚说的话。
 */
export function shouldDeferWholeStructureFigure(input: {
  phase?: string | null;
  hasBoard: boolean;
  reason?: string | null;
}): boolean {
  if (input.hasBoard || input.reason !== 'task-structure') return false;
  return input.phase === 'orient' || input.phase === 'build';
}

export interface VisualPlanInput {
  intent: TeachingVisualIntent;
  task: { title: string; description: string; taskType: string; material?: string | null };
  scenario: { subject: string; topic: string; learnerLevel: string };
  studentSays: string;
  lastTeacherReply?: string | null;
  /** 编排层 visualOpportunity 的原话（含「必须出图」等承诺） */
  opportunityInstruction?: string | null;
  context: { userId?: string; sessionId?: string; taskId?: string };
}

export interface VisualPlanResult {
  figure: TeachingFigure | null;
  reason: string;
}

export async function planVisualFigure(input: VisualPlanInput): Promise<VisualPlanResult> {
  const relation = input.intent.relation || 'structure';
  const kindHint = String(input.intent.kindHint || '').trim() || RELATION_KIND[relation] || null;
  const questionIntent = decideBoardIntent({
    taskType: input.task.taskType,
    kind: kindHint,
    studentText: input.studentSays,
    lastTeacherText: input.lastTeacherReply ?? null,
    boardNumbers: [],
  });
  const instruction = [
    '只画这一张图，不要画整课板书；画完即止。',
    RELATION_INSTRUCTION[relation],
    input.intent.focus ? `本轮要讲清的关系：${input.intent.focus}` : '',
    input.opportunityInstruction ? `编排层补充：${input.opportunityInstruction}` : '',
    '图里不要出现本轮学生要自己产出的答案（句子/步骤/结论/要算的数）；标签用学科真指，不要写「项目 1」。',
    '只用本轮正文和对话里已经出现过的句子/组；材料里本轮还没讲到的段落不要画，也不要替后面的段提前画。',
  ].filter(Boolean).join('\n');
  const request: BoardDesignRequest = {
    task: input.task,
    scenario: input.scenario,
    studentSays: input.studentSays,
    kindHint,
    questionIntent,
    lastTeacherReply: input.lastTeacherReply ?? null,
    instruction,
  };
  const timeout = new Promise<VisualPlanResult>((resolve) => {
    const timer = setTimeout(() => resolve({ figure: null, reason: 'visual-plan timeout' }), PLAN_TIMEOUT_MS);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([designBoard(request, input.context, { lessonPlan: false }), timeout]);
    if (!result.figure) {
      logger.info('[AITeaching] 视觉节点未产出图（fail-open）', {
        sessionId: input.context.sessionId,
        taskId: input.context.taskId,
        relation,
        kindHint,
        reason: result.reason,
      });
    }
    return result;
  } catch (error) {
    logger.warn('[AITeaching] 视觉节点调用失败（fail-open）', {
      sessionId: input.context.sessionId,
      taskId: input.context.taskId,
      relation,
      error: error instanceof Error ? error.message : String(error),
    });
    return { figure: null, reason: 'visual-plan failed' };
  }
}
