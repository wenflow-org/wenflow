/**
 * Prompt 运营 · 模拟评测引擎（2026-10-24 架构优化批 1 自 routes/admin/prompt-ops.ts 迁出，逐字未改）。
 * 目标对话模拟 / 技能用例执行 / 检查项计算 / 版本解析——由 prompt-ops 路由的 run-eval 等处理器调用。
 */
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { executeSkill } from '../../skills';
import { callPrompt } from '../../composers/prompt-composer';
import { goalConversationAgentDefinition } from '../../skills/goal-conversation';
import { validatePathPlanningOutput } from '../../skills/path-planning';
import { validateStageDesignerOutput, withLoadTargetForMilestone } from '../../skills/stage-designer';
import { virtualLearnerGoalDialogueSimulatorDefinition } from '../../skills/virtual-learner-goal-dialogue-simulator';
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import { resolveStorySessionDemand } from '../../virtual-lab/story-demand';
import { findProfileById } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { findAgentPromptById, findAgentPromptByVersion, findActiveAgentPrompt } from '../admin/prompt-ops.repo';
export function extractJson(text: string): any {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Skill 评估调用器（adapter 分发）：
 * - goal-conversation：走 executeSkill（多轮对话，校验结构化输出 + 期望字段）
 * - path-planning / stage-designer：直接 callPrompt（systemPromptOverride=被评估版本）+ 契约字段校验
 * 返回 { result, parsed }，parsed 为模型原始输出 JSON（供 validator 检查）
 */
// ============================================================
// 虚拟学习者模拟输入（mode:simulated）
// ============================================================

const SIM_EVAL_FRICTION_OPTIONS = ['none', 'low', 'normal', 'high', 'stress_test'] as const;

interface SimEvalConfig {
  mode: 'simulated';
  scenario?: string;
  personaId?: string;
  dialogueRounds: number;
  frictionBudget: (typeof SIM_EVAL_FRICTION_OPTIONS)[number];
  convergeRequires: string[];
}

export function extractSimConfig(expectations: any): SimEvalConfig | null {
  if (!expectations || expectations.mode !== 'simulated') return null;
  return {
    mode: 'simulated',
    scenario: typeof expectations.scenario === 'string' ? expectations.scenario : undefined,
    personaId: typeof expectations.personaId === 'string' ? expectations.personaId : undefined,
    dialogueRounds: Math.max(0, Math.min(5, Number(expectations.dialogueRounds) || 1)),
    frictionBudget: SIM_EVAL_FRICTION_OPTIONS.includes(expectations.frictionBudget)
      ? (expectations.frictionBudget as SimEvalConfig['frictionBudget'])
      : 'normal',
    convergeRequires: Array.isArray(expectations.convergeRequires)
      ? expectations.convergeRequires.map((s: any) => String(s).trim()).filter(Boolean)
      : [],
  };
}

/**
 * 构造模拟学习者（learner）与当次学生诉求（demandText）。
 * 来源①：已有虚拟人（virtual_learner_profiles）；②：场景描述即时生成（persona-designer）。
 */
export async function resolveSimulatedEvalInput(sim: {
  personaId?: string;
  scenario?: string;
}): Promise<{ learner: any; story: any; demandText: string; source: string }> {
  let personaSeed: any = null;
  let story: any = null;

  if (sim.personaId) {
    const profile = await findProfileById(sim.personaId);
    if (!profile) throw new Error(`模拟学习者 ${sim.personaId} 不存在`);
    const profileData = safeParse<any>(profile.profile, {});
    personaSeed =
      profileData?.personaSeed && typeof profileData.personaSeed === 'object'
        ? profileData.personaSeed
        : (profileData || null);
    const storyPool = Array.isArray(profileData?.storyPool) ? profileData.storyPool : [];
    story = storyPool[0] || null;
  }

  if (!personaSeed && sim.scenario?.trim()) {
    try {
      // executeSkill 返回 output 本身（personaSeed 顶层）
      const personaOut: any = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
        recentPersonaHints: [sim.scenario.trim()],
      });
      personaSeed = personaOut?.personaSeed || null;
    } catch (e: any) {
      logger.warn('[prompt-ops] persona-designer 生成失败，使用最小人设兜底', {
        error: e?.message,
      });
      personaSeed = {
        nameHint: '模拟学生',
        background: sim.scenario.trim(),
        motivationType: 'necessity',
        learningStyle: 'doing',
        availableTime: 'moderate',
        communicationStyle: '日常口语',
      };
    }
  }

  if (!story && sim.scenario?.trim()) {
    story = {
      id: `eval_story_${randomUUID().slice(0, 8)}`,
      visibleOpening: sim.scenario.trim(),
      goalSeed: { surfaceGoal: sim.scenario.trim(), realProblem: sim.scenario.trim() },
    };
  }

  const demand = resolveStorySessionDemand({ story, profileLearningGoal: null });
  if (!demand.text) {
    throw new Error('模拟输入无法生成学生诉求（需要 scenario，或该虚拟学习者的故事池非空）');
  }
  return {
    learner: personaSeed || {},
    story,
    demandText: demand.text,
    source: demand.source || 'scenario',
  };
}

export interface SimulatedEvalPartition<TCase> {
  keptCases: TCase[];
  /** 与 keptCases 下标一一对应 */
  keptSimConfigs: Array<SimEvalConfig | null>;
  keptSimInputs: Array<{ learner: any; story: any } | null>;
  skipped: Array<{ caseId: string; caseName: string; reason: string }>;
}

/**
 * 批量评估的模拟输入展开：逐用例解析模拟输入，单用例失败（典型：引用的
 * 模拟学习者已被删除）→ 跳过该用例并记入 skipped，不让整批失败。
 * keptSimConfigs / keptSimInputs 与 keptCases 下标一一对应。
 */
export async function partitionSimulatedEvalCases<TCase extends {
  id: string;
  name: string;
  messages: any[];
  expectations: any;
}>(
  cases: TCase[],
  resolveInput: (sim: { personaId?: string; scenario?: string }) => Promise<{
    learner: any;
    story: any;
    demandText: string;
    source: string;
  }>,
): Promise<SimulatedEvalPartition<TCase>> {
  const keptCases: TCase[] = [];
  const keptSimConfigs: Array<SimEvalConfig | null> = [];
  const keptSimInputs: Array<{ learner: any; story: any } | null> = [];
  const skipped: Array<{ caseId: string; caseName: string; reason: string }> = [];

  for (let ci = 0; ci < cases.length; ci += 1) {
    const item = cases[ci];
    const sim = extractSimConfig(item.expectations);
    if (!sim) {
      keptCases.push(item);
      keptSimConfigs.push(null);
      keptSimInputs.push(null);
      continue;
    }
    try {
      const input = await resolveInput({ personaId: sim.personaId, scenario: sim.scenario });
      // 用模拟出的学生诉求替换首条 user 消息
      const firstUser = item.messages.find((m: any) => m.role === 'user');
      if (firstUser) firstUser.content = input.demandText;
      else item.messages.unshift({ role: 'user', content: input.demandText });
      item.expectations = { ...(item.expectations || {}), ...sim };
      keptCases.push(item);
      keptSimConfigs.push(sim);
      keptSimInputs.push({ learner: input.learner, story: input.story });
    } catch (e: any) {
      skipped.push({ caseId: item.id, caseName: item.name, reason: e?.message || '模拟输入解析失败' });
    }
  }
  return { keptCases, keptSimConfigs, keptSimInputs, skipped };
}

/** goal-conversation 的字段检查（既有逻辑提取，供单轮/多轮共用） */
export function computeGoalChecks(result: any, expectations: any): Record<string, boolean> {
  const userVisible = String(result?.userVisible || '');
  const checks: Record<string, boolean> = {
    structuredOutputValid: result?.debug?.structuredOutputValid === true,
    stageValid: !!result?.internal?.core?.stage,
  };
  if (Array.isArray(expectations.mustIncludeFields)) {
    for (const field of expectations.mustIncludeFields) {
      checks[`mustInclude:${field}`] = JSON.stringify(result).includes(String(field));
    }
  }
  if (Array.isArray(expectations.mustContainText)) {
    for (const phrase of expectations.mustContainText) {
      checks[`mustContain:${phrase}`] = userVisible.includes(String(phrase));
    }
  }
  if (Array.isArray(expectations.mustNotInclude)) {
    for (const phrase of expectations.mustNotInclude) {
      checks[`mustNotInclude:${phrase}`] = !userVisible.includes(String(phrase));
    }
  }
  if (typeof expectations.expectedStage === 'string' && expectations.expectedStage) {
    checks.expectedStage = result?.internal?.core?.stage === expectations.expectedStage;
  }
  return checks;
}

export function deriveGoalSimPhase(
  round: number,
  totalRounds: number
): 'opening' | 'understanding' | 'proposal_evaluation' {
  if (round <= 1) return 'opening';
  if (round < totalRounds) return 'understanding';
  return 'proposal_evaluation';
}

/** 提取 goal 输出的结构化字段明细（评估核心），只保留展示所需键 */
export function pickGoalCoreFields(core: any): Record<string, unknown> | null {
  if (!core || typeof core !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const k of ['stage', 'emotion', 'need', 'understanding', 'real_problem', 'confirmedProposal', 'confidence', 'goalReadiness']) {
    const v = core[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** 虚拟学习者人设摘要（供结果区展示"输入"侧） */
export function pickPersonaSummary(learner: any): Record<string, unknown> | null {
  if (!learner || typeof learner !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const k of ['nameHint', 'age', 'occupation', 'background', 'knownConcepts', 'struggleConcepts', 'learningStyle', 'availableTime', 'motivationType', 'adversarialPattern']) {
    const v = learner[k];
    if (v !== undefined && v !== null && v !== '') {
      out[k] = Array.isArray(v) ? v.slice(0, 4) : v;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * goal-conversation 多轮模拟评估。
 * 被测 skill 与虚拟学生交替：逐轮记录字段检查（round 前缀）+ 全局文字期望（allTurns，任一轮命中即过）+ 收敛门禁。
 */
export async function runSimulatedGoalLoop(params: {
  systemPrompt: string;
  caseItem: any;
  simConfig: SimEvalConfig;
  simInput: { learner: any; story: any };
}): Promise<{
  transcript: any[];
  result: any;
  parsed: any;
  checks: Record<string, boolean>;
  passed: boolean;
  studentTurns: number;
  converged: boolean;
}> {
  const { systemPrompt, caseItem, simConfig, simInput } = params;
  const expectations = caseItem.expectations || {};
  const { dialogueRounds, frictionBudget, convergeRequires } = simConfig;

  const transcript: any[] = [];
  const allAgentReplies: string[] = [];
  const checks: Record<string, boolean> = {};
  let previousLearnerState: any = null;
  let finalResult: any = null;
  let finalParsed: any = null;
  let studentTurns = 0;

  let currentMessages: any[] = (caseItem.messages || []).map((m: any) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: String(m.content || ''),
  }));

  for (let round = 1; round <= dialogueRounds; round += 1) {
    const adapter = await runSkillEvalCase({
      skillId: 'skill:goal-conversation',
      systemPrompt,
      caseItem: { ...caseItem, messages: currentMessages },
    });
    finalResult = adapter.result;
    finalParsed = adapter.parsed;
    const userVisible = String(finalResult?.userVisible || '');
    allAgentReplies.push(userVisible);
    transcript.push({
      round,
      role: 'goal_agent',
      content: userVisible,
      checks: computeGoalChecks(finalResult, expectations),
      stage: finalResult?.internal?.core?.stage || null,
      // 结构化字段明细：评估的核心（stage/need/real_problem/confirmedProposal 等）
      fields: pickGoalCoreFields(finalResult?.internal?.core),
    });

    if (round > 1 && previousLearnerState?.readyToProceed === true) break;
    if (round >= dialogueRounds) break;

    // executeSkill 返回 output 本身（reply/emotion/learnerState），失败 throw
    let simOut: any = null;
    try {
      simOut = await executeSkill(virtualLearnerGoalDialogueSimulatorDefinition, {
        learner: simInput.learner,
        story: simInput.story,
        visibleContext: {
          history: currentMessages
            .filter((m) => m.content)
            .map((m) => ({
              role: m.role === 'assistant' ? ('goal_agent' as const) : ('learner' as const),
              content: m.content,
            })),
          lastGoalAgentMessage: userVisible,
        },
        currentPhase: deriveGoalSimPhase(round, dialogueRounds),
        previousLearnerState,
        frictionBudget,
      });
    } catch (e: any) {
      const err = String(e?.message || e || 'simulator-failed');
      logger.warn('[prompt-ops] goal-dialogue-simulator 调用失败', { error: err });
      transcript.push({ round, role: 'learner', content: '[模拟器失败，提前结束]', degraded: true, error: err });
      break;
    }
    const learnerReply = String(simOut?.reply || '').trim();
    if (!learnerReply) {
      transcript.push({ round, role: 'learner', content: '[模拟器失败，提前结束]', degraded: true, error: 'empty learner reply' });
      break;
    }
    previousLearnerState = simOut?.learnerState || null;
    studentTurns += 1;
    transcript.push({
      round,
      role: 'learner',
      content: learnerReply,
      emotion: simOut?.emotion || null,
      learnerState: previousLearnerState,
    });
    currentMessages = [...currentMessages, { role: 'user' as const, content: learnerReply }];
  }

  // 逐轮结构检查（round 前缀，可定位第几轮失败）
  for (const t of transcript) {
    if (t.role !== 'goal_agent') continue;
    for (const [k, v] of Object.entries<boolean>(t.checks || {})) {
      checks[`round${t.round}:${k}`] = v;
    }
  }
  // 全局文字期望：任意助手回复命中即过（多轮对话语义）
  const joined = allAgentReplies.join('\n');
  if (Array.isArray(expectations.mustContainText)) {
    for (const phrase of expectations.mustContainText) {
      checks[`allTurns:mustContain:${phrase}`] = joined.includes(String(phrase));
    }
  }
  if (Array.isArray(expectations.mustNotInclude)) {
    for (const phrase of expectations.mustNotInclude) {
      checks[`allTurns:mustNotInclude:${phrase}`] = !joined.includes(String(phrase));
    }
  }
  // 收敛门禁（仅配置时参与）
  const converged =
    previousLearnerState?.readyToProceed === true ||
    (finalResult?.internal?.core?.stage === 'confirmed' && dialogueRounds > 1);
  if (convergeRequires.length) {
    for (const field of convergeRequires) {
      checks[`converge:${field}`] = joined.includes(String(field));
    }
  }

  const passed = Object.values(checks).every(Boolean);
  return { transcript, result: finalResult, parsed: finalParsed, checks, passed, studentTurns, converged };
}

export async function runSkillEvalCase(params: {
  skillId: string;
  systemPrompt: string;
  caseItem: { messages: any[]; previousState?: any; inputPayload?: any };
  input?: any;
}): Promise<{ result: any; parsed: any }> {
  const { skillId, systemPrompt, caseItem, input } = params;
  const lastUser = [...caseItem.messages].reverse().find((m: any) => m.role === 'user');
  const userInput = String(lastUser?.content || '');
  const history = caseItem.messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content }));
  const previousState = caseItem.previousState || {};

  if (skillId === 'skill:goal-conversation') {
    const result = await executeSkill(goalConversationAgentDefinition, {
      input: userInput,
      userId: 'admin-prompt-ops',
      conversationHistory: history,
      previousUnderstanding: previousState?.understanding || {},
      previousStage: previousState?.stage || 'understanding',
      previousState,
      maxFormatRetries: 2,
      systemPromptOverride: systemPrompt,
    });
    return { result, parsed: null };
  }

  // path / stage：用 callPrompt 直接评估被指定版本的 prompt（不依赖 ACTIVE）
  if (skillId === 'skill:path-planning') {
    const promptInput = input || caseItem.inputPayload || {
      type: 'path',
      goal: userInput,
      currentLevel: previousState?.currentBaseline?.level || 'beginner',
      metadata: { availableTime: previousState?.resources?.timeBudget || null },
      confirmedProposal: previousState?.confirmedProposal || null,
      conversationHistory: history,
    };
    // 若调用方指定期望里程碑数（等同 coordinator 的 targetMilestones 注入），拼进 user 文本强制
    const expectedFromInput = Number.isInteger((promptInput as any)?.expectedMilestones)
      ? (promptInput as any).expectedMilestones
      : null;
    const milestoneDirective = expectedFromInput !== null
      ? `\n\n【结构规模硬约束】本次规划必须且只能输出恰好 ${expectedFromInput} 个 milestone（数量精确，不是范围建议，不得增减）。`
      : '';
    // userPayload 复用 generatePath 的文本模板（goal + 结构化输入），指令作为前缀注入
    const userPayloadText = `原始学习目标：${promptInput.goal || userInput}
${milestoneDirective}

路径前置清洗结果（高优先级参考输入）：
${JSON.stringify({
  learnerProfile: { currentBaseline: { level: promptInput.currentLevel || 'beginner' } },
  resources: { timeBudget: promptInput.metadata?.availableTime || null },
  confirmedProposal: promptInput.confirmedProposal || null,
  planningHints: {
    targetMilestones: expectedFromInput,
    milestoneRange: expectedFromInput !== null ? [expectedFromInput, expectedFromInput] : null,
  },
}, null, 2)}

【重要】请把以上清洗结果视为上游已整理好的正式输入，据此设计路径。`;
    const promptResult = await callPrompt<any, any>({
      agentId: 'skill:path-planning',
      defaultSystemPrompt: systemPrompt,
      requireActivePrompt: false,
      caller: { agentId: 'path-agent', skillId: 'path-planning' },
      buildUserPayload: () => userPayloadText,
      parseRawOutput: (raw) => {
        const parsed = extractJson(raw);
        return { parsed, extractedJson: parsed ? JSON.stringify(parsed) : null };
      },
      normalizeOutput: (parsed) => ({ parsed }),
      validateParsedOutput: () => ({ valid: true }),
      retryStrategy: { maxAttempts: 2 },
    }, { ...promptInput, systemPromptOverride: systemPrompt });
    return { result: promptResult, parsed: promptResult?.output?.parsed || null };
  }

  if (skillId === 'skill:stage-designer') {
    const promptInput = input || caseItem.inputPayload || {
      milestone: { stageNumber: 1, title: '示例阶段' },
      previousMilestone: null,
      cognitiveCore: { cognitiveDomain: '示例', coreConcepts: [] },
      normalizedInput: null,
      repairHints: null,
      // 默认带一份最小资料包：否则试跑永远走不到 materialRefs 分支（有资料才要求逐字引用）
      materials: [{
        title: '示例资料',
        sourceUrl: 'https://example.com/doc',
        sections: [{ id: 's-1', title: '第一章 概述' }],
        keyPoints: [{ text: '示例要点', cite: '第一章 概述' }],
      }],
    };
    // 若调用方指定期望子任务数（等同 coordinator 的 targetSubtasksPerStage 注入），
    // 写进 normalizedInput.planningHints 供 prompt 强制读取
    const expectedFromInput = Number.isInteger((promptInput as any)?.expectedSubtaskCount)
      ? (promptInput as any).expectedSubtaskCount
      : null;
    const enrichedNormalizedInput =
      promptInput.normalizedInput && typeof promptInput.normalizedInput === 'object'
        ? {
            ...promptInput.normalizedInput,
            planningHints: expectedFromInput !== null
              ? {
                  ...(promptInput.normalizedInput.planningHints || {}),
                  targetSubtasksPerStage: expectedFromInput,
                  subtasksPerStageRange: [expectedFromInput, expectedFromInput],
                }
              : (promptInput.normalizedInput.planningHints || null),
          }
        : expectedFromInput !== null
          ? { planningHints: { targetSubtasksPerStage: expectedFromInput, subtasksPerStageRange: [expectedFromInput, expectedFromInput] } }
          : null;
    const promptResult = await callPrompt<any, any>({
      agentId: 'skill:stage-designer',
      defaultSystemPrompt: systemPrompt,
      requireActivePrompt: false,
      caller: { skillId: 'stage-designer' },
      buildUserPayload: () => ({
        milestone: withLoadTargetForMilestone(promptInput.milestone, promptInput.cognitiveCore),
        previousMilestone: promptInput.previousMilestone || null,
        cognitiveCore: promptInput.cognitiveCore,
        normalizedInput: enrichedNormalizedInput,
        materials: promptInput.materials || null,
        repairHints: promptInput.repairHints || null,
        __promptOverridden: true,
      }),
      parseRawOutput: (raw) => {
        const parsed = extractJson(raw);
        return { parsed, extractedJson: parsed ? JSON.stringify(parsed) : null };
      },
      normalizeOutput: (parsed) => ({ parsed }),
      validateParsedOutput: () => ({ valid: true }),
      retryStrategy: { maxAttempts: 2 },
    }, { ...promptInput, systemPromptOverride: systemPrompt });
    return { result: promptResult, parsed: promptResult?.output?.parsed || null };
  }

  throw new Error(`不支持的评估 skill: ${skillId}`);
}

/**
 * Skill 契约校验（path/stage 复用 validator；goal 结构化校验）
 * 返回 checks 供前端逐项展示；goal 返回空 checks（由调用方基于 executeSkill result 计算）
 */
export async function runSkillChecks(params: {
  skillId: string;
  parsed: any;
  expectations: any;
  caseItem: { messages: any[]; previousState?: any; inputPayload?: any };
}): Promise<{ checks: Record<string, boolean>; parsed: any }> {
  const { skillId, parsed, expectations, caseItem } = params;
  const checks: Record<string, boolean> = {};

  if (skillId === 'skill:goal-conversation') {
    return { checks, parsed };
  }

  const expect = expectations || {};
  if (!parsed) {
    checks.parsed = false;
    return { checks, parsed };
  }
  checks.parsed = true;

  if (skillId === 'skill:path-planning') {
    const expectedMilestones = typeof expect.expectedMilestones === 'number' ? expect.expectedMilestones : null;
    const validation = validatePathPlanningOutput(parsed, expectedMilestones);
    checks.contractValid = validation.valid;
    checks.milestoneCount = Array.isArray(parsed.milestones) ? parsed.milestones.length : 0;
    if (expectedMilestones !== null) {
      checks.milestoneCountMatchesExpected = checks.milestoneCount === expectedMilestones;
    }
    checks.namePresent = typeof parsed.name === 'string' && parsed.name.trim().length > 0;
    checks.milestonesPresent = Array.isArray(parsed.milestones) && parsed.milestones.length > 0;
    checks.cognitiveCorePresent = !!parsed.cognitiveCore;
    if (Array.isArray(expect.mustIncludeFields)) {
      for (const field of expect.mustIncludeFields) {
        checks[`mustInclude:${field}`] = JSON.stringify(parsed).includes(String(field));
      }
    }
    // 人话检查：输出中必须出现的文字（覆盖 name/title/描述等自然语言内容）
    if (Array.isArray(expect.mustContainText)) {
      for (const phrase of expect.mustContainText) {
        checks[`mustContain:${phrase}`] = JSON.stringify(parsed).includes(String(phrase));
      }
    }
  }

  if (skillId === 'skill:stage-designer') {
    const validation = validateStageDesignerOutput(parsed);
    checks.contractValid = validation.valid;
    checks.subtaskCount = Array.isArray(parsed.subtasks) ? parsed.subtasks.length : 0;
    if (typeof expect.expectedSubtaskCount === 'number') {
      checks.subtaskCountMatchesExpected = checks.subtaskCount === expect.expectedSubtaskCount;
    }
    checks.subtasksPresent = Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0;
    if (Array.isArray(expect.mustIncludeFields)) {
      for (const field of expect.mustIncludeFields) {
        checks[`mustInclude:${field}`] = JSON.stringify(parsed).includes(String(field));
      }
    }
    // 人话检查：输出中必须出现的文字
    if (Array.isArray(expect.mustContainText)) {
      for (const phrase of expect.mustContainText) {
        checks[`mustContain:${phrase}`] = JSON.stringify(parsed).includes(String(phrase));
      }
    }
  }

  return { checks, parsed };
}

export async function resolvePrompt(
  canonicalAgentId: string,
  payload: any
): Promise<{
  systemPrompt: string;
  source: 'custom' | 'version' | 'active';
  promptVersion: number | null;
  model: string | null;
}> {
  if (typeof payload.customPrompt === 'string' && payload.customPrompt.trim()) {
    return {
      systemPrompt: payload.customPrompt,
      source: 'custom',
      promptVersion: null,
      model: payload.model || null,
    };
  }

  if (typeof payload.promptVersionId === 'string' && payload.promptVersionId) {
    const row = await findAgentPromptById(payload.promptVersionId);
    if (!row) throw new Error(`promptVersionId ${payload.promptVersionId} 不存在`);
    return {
      systemPrompt: row.systemPrompt,
      source: 'version',
      promptVersion: row.version,
      model: payload.model || null,
    };
  }

  if (typeof payload.promptVersion === 'number') {
    const row = await findAgentPromptByVersion(canonicalAgentId, payload.promptVersion);
    if (!row) throw new Error(`promptVersion ${payload.promptVersion} 不存在`);
    return {
      systemPrompt: row.systemPrompt,
      source: 'version',
      promptVersion: row.version,
      model: payload.model || null,
    };
  }

  const active = await findActiveAgentPrompt(canonicalAgentId);
  if (!active) throw new Error(`agent ${canonicalAgentId} 当前没有 ACTIVE prompt`);
  return {
    systemPrompt: active.systemPrompt,
    source: 'active',
    promptVersion: active.version,
    model: payload.model || null,
  };
}

/**
 * skill-catalog — 用于前端可视化字段选择器 (SkillFieldPicker)
 * GET /admin/prompt-ops/skill-catalog
 *
 * 返回三级树:
 *   [
 *     {
 *       agentId: 'goal-agent',
 *       agentName: '目标 Agent',
 *       skills: [
 *         {
 *           skillId: 'skill:goal-conversation',
 *           skillName: 'goal-conversation',
 *           inputFields: [{ path, valueType, note }, ...],   // 从 ## 输入说明 json 抽
 *           outputFields: [{ path, valueType, note }, ...],  // 从 ## 输出规格 json 抽
 *         }
 *       ]
 *     }
 *   ]
 *
 * 数据源:
 *   - agent → skill 嵌套: agent-manifest.service
 *   - 字段表: 从每个 skill 的 DB ACTIVE prompt 调 parsePromptSchema 抽
 *
 * 注: 跨 stage 字段引用 (例如 path-agent 引用 goal-agent 的 surface_goal) 走 outputFields,
 * 当前 stage 内部引用 (例如 path-planning 引用上游 normalizedInput) 走 inputFields.
 */
export function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

