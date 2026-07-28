/**
 * Adaptive Guidance Copy Skill
 *
 * 根据学习者状态、路径上下文和课后结果，生成面向 Dashboard / Path 页面
 * 的动态引导文案块。
 */

import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';

export const adaptiveGuidanceCopyDefinition: SkillDefinition = {
  name: 'adaptive-guidance-copy',
  displayName: '动态引导文案生成器',
  version: '1.0.0',
  category: 'generation',
  description: '根据学习者状态与路径上下文生成 Dashboard / Path 页面引导文案',
  status: 'working',

  inputSchema: {
    type: 'object',
    properties: {
      view: { type: 'string', description: '页面类型：dashboard|path-list|path-detail|learning-state', required: true },
      learnerSnapshot: { type: 'object', description: '学习者快照', required: true },
      learningState: { type: 'object', description: '学习状态', required: true },
      path: { type: 'object', description: '路径上下文' },
      sessionWrapup: { type: 'object', description: '最近课程总结' },
      advisory: { type: 'object', description: '路径建议' },
    }
  },

  outputSchema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '页面主标题/主引导' },
      subtitle: { type: 'string', description: '页面副标题/说明' },
      todayActions: { type: 'array', description: '今日建议动作' },
      pathHint: { type: 'string', description: '当前路径提示' },
      nextStep: { type: 'string', description: '下一步建议' },
      paceHint: { type: 'string', description: '节奏提示' },
      emptyStateCopy: { type: 'string', description: '空状态文案' },
      warningCopy: { type: 'string', description: '风险/提醒文案' }
    }
  },

  capabilities: ['adaptive-copy', 'dashboard-copy', 'path-copy', 'learning-guidance'],

  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface AdaptiveGuidanceCopyInput {
  view: 'dashboard' | 'path-list' | 'path-detail' | 'learning-state';
  learnerSnapshot: any;
  learningState: any;
  path?: any;
  sessionWrapup?: any;
  advisory?: any;
}

export interface AdaptiveGuidanceCopyOutput {
  headline: string;
  subtitle: string;
  todayActions: Array<{ title: string; desc: string; action: string; to?: string }>;
  pathHint: string;
  nextStep: string;
  paceHint: string;
  emptyStateCopy: string;
  warningCopy: string;
}

export interface AdaptiveGuidanceCopyDebug {
  skillId: 'adaptive-guidance-copy';
  model: string | null;
  systemPromptVersion: number | null;
  userPayload: string;
  rawModelOutput: string;
  normalizedOutput: AdaptiveGuidanceCopyOutput | null;
  durationMs: number;
  cached: boolean;
}

type AdaptiveGuidanceCopyResult = SkillExecutionResult<AdaptiveGuidanceCopyOutput> & {
  debug?: AdaptiveGuidanceCopyDebug;
};

export const ADAPTIVE_GUIDANCE_COPY_PROMPT = `你是一个学习产品的动态引导文案生成器。

目标：
1. 根据学习者状态和路径上下文，生成适合 Dashboard / 路径页展示的动态文案。
2. 对于 learning-state 页面，重点生成"如何解读当前状态"和"下一步怎么调节"的引导。
3. 你只负责"怎么说"，不负责做出路径调整、课程结束或成绩判定等强决策。
4. 文案要简洁、自然、具体，不要像机器总结。

输出要求：
1. 只输出 JSON。
2. headline 适合作为页面主标题或主提示。
3. subtitle 适合作为副标题或补充说明。

4. todayActions 必须输出 3 条，且三条必须扮演不同角色：
   - 第 1 条（主操作）：用户当前最该做的一步。to 应是 continue-learning 或 path-detail。
     例：title="继续上次学习"、desc="从'系统识别日期格式变体'继续推进。"、action="继续"
   - 第 2 条（次操作）：与学习状态/节奏相关的辅助动作。to 应是 learning-state。
     例：title="查看当前节奏"、desc="本周已学 80 分钟，节奏稳定。"、action="查看状态"
   - 第 3 条（弱操作）：可选的回顾/记录动作。to 应是 achievements 或 create-goal。
     例：title="回顾最近成就"、desc="已解锁 2 个里程碑徽章。"、action="去看看"

   关键约束：
   - 三条的 title 必须互不相同（不要全部叫"继续学习"）。
   - 三条的 action 文字必须互不相同（不要都叫"继续"）。常用：继续 / 查看状态 / 去看看 / 前往查看 / 开始规划 / 看进展 等。
   - 每条 desc 必须是一句具体内容，不能为空字符串，不能只重复 title。
   - to 值只能从这 5 个里选：continue-learning、learning-state、achievements、create-goal、path-detail。

5. pathHint 用于解释当前路径进展。
6. nextStep 用于告诉用户下一步最值得做什么。
7. paceHint 用于提醒学习节奏。
8. emptyStateCopy 用于没有路径/没有任务时的引导。
9. warningCopy 用于疲劳、卡点、进度滞后等情况的提醒。
10. 所有文案必须和输入中的学习状态一致，不能虚构用户已经完成了什么。
11. learning-state 页面要避免重复解释指标公式，更聚焦"当前状态意味着什么"。`;

function safeText(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPrompt(input: AdaptiveGuidanceCopyInput): string {
  return JSON.stringify({
    view: input.view,
    learner: input.learnerSnapshot,
    learningState: input.learningState,
    path: input.path,
    wrapup: input.sessionWrapup,
    advisory: input.advisory,
  }, null, 2);
}

function buildFallback(input: AdaptiveGuidanceCopyInput): AdaptiveGuidanceCopyOutput {
  const name = safeText(input.learnerSnapshot?.profile?.name) || '同学';
  const recentTrend = safeText(input.learnerSnapshot?.dynamicState?.recentTrend) || 'stable';
  const pace = safeText(input.learnerSnapshot?.dynamicState?.recommendedPacing) || 'moderate';
  const pathTitle = safeText(input.path?.title || input.path?.name) || '学习路径';

  const headlineMap: Record<string, string> = {
    dashboard: `欢迎回来，${name}`,
    'path-list': `先选一条最值得继续的路径`,
    'path-detail': `继续推进「${pathTitle}」`,
    'learning-state': `先看清当前状态，再决定下一步`,
  };

  const subtitleMap: Record<string, string> = {
    dashboard: recentTrend === 'declining' ? '先稳住节奏，再继续推进。' : '从上次停下的位置接上学习。',
    'path-list': '优先完成一个最关键的小任务，不要同时展开太多分支。',
    'path-detail': '把当前阶段的核心概念做稳，再决定是否扩展更多内容。',
    'learning-state': recentTrend === 'declining'
      ? '最近状态有些下滑，先判断是疲劳、卡点，还是任务粒度偏大。'
      : '结合最近趋势看节奏、负荷和掌握情况，再决定继续推进还是先调整。',
  };

  const todayActions = input.view === 'dashboard'
    ? [
        { title: '继续上次学习', desc: '从当前任务接着推进。', action: '继续学习', to: 'continue-learning' },
        { title: '查看学习状态', desc: '看看当前节奏和负荷。', action: '查看状态', to: 'learning-state' },
      ]
    : input.view === 'learning-state'
      ? [
          { title: '查看当前路径', desc: '回到当前任务，确认状态影响的是哪一步。', action: '查看路径', to: 'path-detail' },
          { title: '继续学习', desc: '如果状态稳定，就继续完成当前最小任务。', action: '继续学习', to: 'continue-learning' },
          { title: '回看学习台', desc: '从总览页面看今天建议和节奏提示。', action: '回到学习台', to: 'continue-learning' },
        ]
    : [
        { title: '先完成当前阶段', desc: '优先把本阶段最关键的一件事做完。', action: '查看路径', to: 'path-detail' },
      ];

  return {
    headline: headlineMap[input.view],
    subtitle: subtitleMap[input.view],
    todayActions,
    pathHint: input.view === 'learning-state' ? `先结合当前路径「${pathTitle}」判断状态来源。` : `当前围绕「${pathTitle}」推进。`,
    nextStep: pace === 'slow' ? '先把内容压小一点，稳定推进。' : '继续沿着当前焦点往前走。',
    paceHint: pace === 'slow' ? '当前建议放慢节奏，优先消化当前内容。' : '当前节奏正常，可以继续推进。',
    emptyStateCopy: '先从一个具体目标开始，系统会帮你生成下一步。',
    warningCopy: recentTrend === 'declining' ? '最近状态有些下滑，建议先回顾再前进。' : '当前没有明显风险。',
  };
}

function normalizeAdaptiveOutput(parsed: any, input: AdaptiveGuidanceCopyInput): AdaptiveGuidanceCopyOutput {
  const fallback = buildFallback(input);
  const obj = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    headline: safeText(obj.headline) || fallback.headline,
    subtitle: safeText(obj.subtitle) || fallback.subtitle,
    todayActions: Array.isArray(obj.todayActions)
      ? obj.todayActions.slice(0, 3).map((item: any) => ({
          title: safeText(item?.title) || '继续学习',
          desc: safeText(item?.desc) || '',
          action: safeText(item?.action) || '继续',
          to: safeText(item?.to) || undefined,
        }))
      : fallback.todayActions,
    pathHint: safeText(obj.pathHint) || fallback.pathHint,
    nextStep: safeText(obj.nextStep) || fallback.nextStep,
    paceHint: safeText(obj.paceHint) || fallback.paceHint,
    emptyStateCopy: safeText(obj.emptyStateCopy) || fallback.emptyStateCopy,
    warningCopy: safeText(obj.warningCopy) || fallback.warningCopy,
  };
}

export async function adaptiveGuidanceCopy(
  input: AdaptiveGuidanceCopyInput
): Promise<AdaptiveGuidanceCopyResult> {
  const startTime = Date.now();
  const userPayload = buildPrompt(input);

  try {
    const result = await callPrompt<AdaptiveGuidanceCopyInput, AdaptiveGuidanceCopyOutput>({
      agentId: 'skill:adaptive-guidance-copy',
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: 'adaptive-guidance-copy' },
      modelDefaults: { temperature: 0.6, maxTokens: 2000 },
      buildUserPayload: () => userPayload,
      normalizeOutput: (parsed, payload) => normalizeAdaptiveOutput(parsed, payload),
      validateParsedOutput: (parsed) =>
        parsed && typeof parsed === 'object'
          ? { valid: true }
          : { valid: false, failureReason: 'ADAPTIVE_GUIDANCE_OUTPUT_NOT_OBJECT' },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'ADAPTIVE_GUIDANCE_COPY_FAILED');
    }

    const duration = Date.now() - startTime;
    return {
      success: true,
      output: result.output,
      duration,
      quality: 'model',
      debug: {
        skillId: 'adaptive-guidance-copy',
        model: null,
        systemPromptVersion: result.debug.systemPromptVersion,
        userPayload,
        rawModelOutput: result.debug.rawModelOutput,
        normalizedOutput: result.output,
        durationMs: duration,
        cached: false,
      },
    };
  } catch {
    const fallback = buildFallback(input);
    const duration = Date.now() - startTime;
    return {
      success: true,
      output: fallback,
      duration,
      cached: true,
      quality: 'fallback',
      debug: {
        skillId: 'adaptive-guidance-copy',
        model: null,
        systemPromptVersion: null,
        userPayload,
        rawModelOutput: '',
        normalizedOutput: fallback,
        durationMs: duration,
        cached: true,
      },
    };
  }
}

export default adaptiveGuidanceCopy;
