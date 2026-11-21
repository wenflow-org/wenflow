/**
 * 虚拟学习者跑数 · 终态 / 阶段范围 / 功能证据（纯函数，不触网、不读库）。
 *
 * 目的（2026-11-21 虚拟学习者两种用途改造）：
 * - **功能验证**与**效果评估**用同一套终态口径：批跑、续跑、报告都引用本模块，
 *   避免 run 侧把「观察天数用尽」误记成失败、report 侧再按 exitCode 二次猜测。
 * - 功能证据只记录「声明了什么 / 实际发生了什么 / 确定性检查结果」，**不读任何效果分**。
 *   因此低分样本不会被排除；是否进入效果汇总只取决于阶段覆盖、数据完整性与配置一致性。
 * - 阶段覆盖必须基于**截断前的完整轨迹**计算；裁判输入可以另行压缩。
 *
 * run-harness（TS）与 campaign 脚本（CJS，见 backend/scripts/campaign-outcomes.cjs）
 * 各有一份最小实现，但口径（outcome 枚举、expectedTerminal 映射）保持一致。
 */

export const OBSERVED_STAGES = ['goal', 'path', 'teaching', 'completed', 'error'] as const;
export type ObservedStage = (typeof OBSERVED_STAGES)[number];

/** 报告/功能验证显式声明的阶段范围（比轨迹 stage 多了 settlement/review 两个评估环节）。 */
export const RUN_STAGE_SCOPES = ['goal', 'path', 'teaching', 'completion', 'review'] as const;
export type RunStageScopeName = (typeof RUN_STAGE_SCOPES)[number];

export type RunOutcome =
  /** 正常完成：会话终态 completed，且到达声明终点 */
  | 'completed'
  /** 声明为不排课（answer-only / oneoff / referral 物理边界）且 goal 正常收尾 */
  | 'expected-no-path'
  /** 学习者主动结束（离场/放弃）；不是平台失败，但可能不满足声明终点 */
  | 'learner-ended'
  /** 观察天数用尽：跑完了声明的观察窗口，但未到达 path/teaching 终点 */
  | 'observation-exhausted'
  /** 可重试问题（传输/租约/模型抖动）等满预算后放弃 */
  | 'retry-exhausted'
  /** 进程被中断/被杀；状态仍在，可续跑 */
  | 'interrupted'
  /** 平台/契约失败（需人看） */
  | 'failed';

export const RUN_OUTCOMES: readonly RunOutcome[] = [
  'completed',
  'expected-no-path',
  'learner-ended',
  'observation-exhausted',
  'retry-exhausted',
  'interrupted',
  'failed',
];

export type ExpectedTerminal =
  | 'completed'
  | 'no-path'
  | 'learner-ended'
  | 'observation-exhausted'
  | 'any';

export interface StageScope {
  /** 声明的预期终态；用于功能验证的确定性检查 */
  expectedTerminal: ExpectedTerminal;
  /** 本 case 明确要求覆盖的阶段（未列出的阶段留空，不按失败处理） */
  stages: RunStageScopeName[];
  /** 声明的观察周期（模拟天数）；null = 未声明 */
  observationDays: number | null;
}

export interface RunFindingLike {
  code?: string;
  detail?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** stage 别名归一：轨迹/案例里的不同叫法收敛到同一评估阶段。 */
export function normalizeStageScopeName(value: unknown): RunStageScopeName | null {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'goal') return 'goal';
  if (raw === 'path') return 'path';
  if (raw === 'teaching' || raw === 'classroom' || raw === 'lesson') return 'teaching';
  if (raw === 'completed' || raw === 'completion' || raw === 'settlement' || raw === 'mastery') return 'completion';
  if (raw === 'review' || raw === 'retention' || raw === 'due-review') return 'review';
  return null;
}

/**
 * 把案例声明归一成显式的阶段范围。
 *
 * 默认值刻意保守：
 * - expectNoPath=true → 只声明 goal（不要求 path/teaching）；
 * - 否则 → goal/path/teaching/completion（review 必须由案例显式声明）。
 * 调用方可以用 `stages` 精确覆盖；未知/空集合回退默认，避免「声明为空 = 什么都能过」。
 */
export function normalizeStageScope(input: {
  expectNoPath?: boolean;
  expectedTerminal?: ExpectedTerminal | null;
  stages?: unknown[] | null;
  observationDays?: number | null;
} = {}): StageScope {
  const expectedTerminal: ExpectedTerminal = input.expectedTerminal
    || (input.expectNoPath ? 'no-path' : 'completed');
  const declared = Array.isArray(input.stages)
    ? input.stages.map(normalizeStageScopeName).filter((item): item is RunStageScopeName => item !== null)
    : [];
  const deduped = [...new Set(declared)];
  const fallback: RunStageScopeName[] = input.expectNoPath
    ? ['goal']
    : ['goal', 'path', 'teaching', 'completion'];
  return {
    expectedTerminal,
    stages: deduped.length ? deduped : fallback,
    observationDays: typeof input.observationDays === 'number' && Number.isFinite(input.observationDays)
      ? Math.max(0, Math.floor(input.observationDays))
      : null,
  };
}

/** 轨迹条目 → 观测阶段；不合法/未知返回 null（未知阶段不能冒充覆盖）。 */
export function normalizeObservedStage(value: unknown): ObservedStage | null {
  const raw = asString(value).trim().toLowerCase();
  return (OBSERVED_STAGES as readonly string[]).includes(raw) ? (raw as ObservedStage) : null;
}

export interface StageCoverageResult {
  /** 与 LearnerObservation['stage'] 同键，true = 完整轨迹里至少出现一次 */
  stageCoverage: Record<ObservedStage, boolean>;
  observedCounts: Record<ObservedStage, number>;
  /** 完整（未截断）轨迹条数 */
  traceCount: number;
  /** 始终为 full-trace：调用方必须在 compactTrace 之前调用本函数 */
  coverageSource: 'full-trace';
}

/**
 * 从**完整轨迹**计算阶段覆盖。
 *
 * 入参既接受 `{ observation: { stage } }`（公开轨迹），也接受 `{ stage }`；
 * 非法条目只计 total，不让任何阶段被点亮。调用方不得先截断再调用。
 */
export function computeStageCoverage(entries: unknown[]): StageCoverageResult {
  const observedCounts = Object.fromEntries(OBSERVED_STAGES.map((stage) => [stage, 0])) as Record<ObservedStage, number>;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const record = asRecord(entry);
    const observation = asRecord(record.observation);
    const stage = normalizeObservedStage(observation.stage ?? record.stage);
    if (stage) observedCounts[stage] += 1;
  }
  const stageCoverage = Object.fromEntries(
    OBSERVED_STAGES.map((stage) => [stage, observedCounts[stage] > 0])
  ) as Record<ObservedStage, boolean>;
  return {
    stageCoverage,
    observedCounts,
    traceCount: Array.isArray(entries) ? entries.length : 0,
    coverageSource: 'full-trace',
  };
}

export interface RunTerminalInput {
  /** simulate-learner-e2e 的运行结果；campaign 旧结果可能没有 */
  result?: 'completed' | 'failed' | 'exhausted' | null;
  /** goal 驱动结果 */
  goalOutcome?: 'advanced' | 'no-path' | 'learner-left' | 'failed' | null;
  /** 案例声明「预期不排课」 */
  expectNoPath?: boolean;
  findings?: RunFindingLike[] | null;
  /** 已完成的模拟日轮数 */
  round?: number | null;
  maxDays?: number | null;
  /** 进程中断（信号/未知退出） */
  interrupted?: boolean;
  /** 上游已经算好的终态（state.json 里的 outcome）优先 */
  stateOutcome?: RunOutcome | null;
}

/**
 * 统一终态分类（run / resume / report 共用同一口径）。
 *
 * 关键区分：
 * - observation-exhausted ≠ failed：观察窗口跑满但路径还没走完，是有效观测；
 * - learner-ended ≠ failed：学习者主动结束是产品行为，不是平台故障；
 * - retry-exhausted / interrupted 单列，报告可以据此区分「平台失败」与「可续跑」。
 */
export function classifyRunTerminal(input: RunTerminalInput = {}): RunOutcome {
  if (input.stateOutcome && (RUN_OUTCOMES as readonly string[]).includes(input.stateOutcome)) {
    return input.stateOutcome;
  }
  if (input.interrupted) return 'interrupted';

  const codes = new Set(
    (Array.isArray(input.findings) ? input.findings : [])
      .map((item) => asString(item?.code || ''))
      .filter(Boolean)
  );

  if (codes.has('interrupted') || codes.has('runner-interrupted')) return 'interrupted';
  if (codes.has('retry-exhausted')) return 'retry-exhausted';

  const reachedCap = input.result === 'exhausted'
    || codes.has('max-days-reached')
    || (input.result == null && typeof input.round === 'number' && typeof input.maxDays === 'number'
      && input.maxDays > 0 && input.round >= input.maxDays);
  if (reachedCap) return 'observation-exhausted';

  if (codes.has('goal-ended-without-path')) {
    if (input.expectNoPath) return 'expected-no-path';
    return input.goalOutcome === 'learner-left' ? 'learner-ended' : 'failed';
  }

  if (input.result === 'completed') {
    if (input.goalOutcome === 'no-path' || input.goalOutcome === 'learner-left') {
      return input.expectNoPath ? 'expected-no-path' : 'learner-ended';
    }
    return 'completed';
  }

  if (input.goalOutcome === 'no-path' || input.goalOutcome === 'learner-left') {
    if (input.expectNoPath) return 'expected-no-path';
    return input.goalOutcome === 'learner-left' ? 'learner-ended' : 'failed';
  }

  return 'failed';
}

/** 声明终态是否命中实际终态（no-path 允许 learner-ended 作为等价主动收尾）。 */
export function expectedTerminalMatches(expected: ExpectedTerminal, actual: RunOutcome): boolean {
  switch (expected) {
    case 'completed':
      return actual === 'completed';
    case 'no-path':
      return actual === 'expected-no-path' || actual === 'learner-ended';
    case 'learner-ended':
      return actual === 'learner-ended' || actual === 'expected-no-path';
    case 'observation-exhausted':
      return actual === 'observation-exhausted';
    case 'any':
      return actual !== 'failed' && actual !== 'retry-exhausted' && actual !== 'interrupted';
    default:
      return false;
  }
}

export interface FunctionalCheck {
  code: string;
  ok: boolean;
  detail: string;
}

export interface FunctionalStageEvidence {
  stage: RunStageScopeName;
  declared: boolean;
  reached: boolean;
  /** null = 未声明/未要求（不按失败处理） */
  dataComplete: boolean | null;
  terminalValid: boolean | null;
  missing: string[];
}

export interface FunctionalEvidence {
  /** 声明（预期终态 / 显式阶段 / 观察周期） */
  declared: StageScope;
  /** 实际发生（与效果分完全解耦） */
  actual: {
    terminal: RunOutcome;
    stagesReached: RunStageScopeName[];
    rounds: number;
    maxDays: number | null;
    sessionStatus: string | null;
    currentStage: string | null;
  };
  stages: FunctionalStageEvidence[];
  checks: FunctionalCheck[];
  /** 证据本身不参与通过/不通过打分；是否纳入效果汇总由 report 的完整性门决定 */
  scoreIndependent: true;
}

export interface BuildFunctionalEvidenceInput {
  scope: StageScope;
  terminal: RunOutcome;
  stagesReached: RunStageScopeName[];
  rounds: number;
  maxDays?: number | null;
  sessionStatus?: string | null;
  currentStage?: string | null;
  findings?: RunFindingLike[] | null;
  /** RunState 版本；只接受版本 1（否则视为数据不可信） */
  stateVersion?: number | null;
  /** 整体数据完整性（必填字段/会话标识是否齐全）；false → 证据仍保存但标缺失 */
  dataComplete?: boolean | null;
  /** 每个声明阶段的必要数据是否齐全；缺省 = 未检查（null，不按失败处理） */
  stageData?: Partial<Record<RunStageScopeName, boolean | null>> | null;
}

/**
 * 构造功能验证证据。
 *
 * - 只记录声明/实际/确定性检查，不读取裁判分或任何效果指标；
 * - 未覆盖阶段留空（reached=false + missing=stage-not-observed），不排除样本；
 * - 无效版本 / 缺失数据只让对应 check 失败并写明 missing，不丢证据。
 */
export function buildFunctionalEvidence(input: BuildFunctionalEvidenceInput): FunctionalEvidence {
  const scope = normalizeStageScope({
    expectedTerminal: input.scope?.expectedTerminal,
    stages: input.scope?.stages,
    observationDays: input.scope?.observationDays,
  });
  const declared = new Set(scope.stages);
  const reachedSet = new Set(
    (Array.isArray(input.stagesReached) ? input.stagesReached : [])
      .map(normalizeStageScopeName)
      .filter((item): item is RunStageScopeName => item !== null)
  );
  const stageData = input.stageData || {};
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const versionValid = input.stateVersion === 1;
  const dataComplete = input.dataComplete === false ? false : input.dataComplete === true ? true : null;

  const stages: FunctionalStageEvidence[] = (RUN_STAGE_SCOPES as readonly RunStageScopeName[])
    .filter((stage) => declared.has(stage) || reachedSet.has(stage))
    .map((stage) => {
      const isDeclared = declared.has(stage);
      const reached = reachedSet.has(stage);
      const data = isDeclared && stageData[stage] !== undefined ? stageData[stage] ?? null : null;
      const missing: string[] = [];
      if (isDeclared && !reached) missing.push('stage-not-observed');
      if (isDeclared && data === false) missing.push('stage-data-missing');
      return {
        stage,
        declared: isDeclared,
        reached,
        dataComplete: data,
        terminalValid: isDeclared ? expectedTerminalMatches(scope.expectedTerminal, input.terminal) : null,
        missing,
      };
    });

  const uncovered = stages.filter((item) => item.declared && !item.reached).map((item) => item.stage);
  const platformFailure = input.terminal === 'failed' || input.terminal === 'retry-exhausted';
  const checks: FunctionalCheck[] = [
    {
      code: 'state-version-valid',
      ok: versionValid,
      detail: versionValid ? 'RunState.version=1' : `unexpected RunState.version=${input.stateVersion ?? 'null'}`,
    },
    {
      code: 'declared-terminal-reached',
      ok: expectedTerminalMatches(scope.expectedTerminal, input.terminal),
      detail: `expected=${scope.expectedTerminal} actual=${input.terminal}`,
    },
    {
      code: 'stage-scope-covered',
      ok: uncovered.length === 0,
      detail: uncovered.length ? `uncovered=${uncovered.join(',')}` : `covered=${scope.stages.join(',')}`,
    },
    {
      code: 'terminal-not-interrupted',
      ok: input.terminal !== 'interrupted',
      detail: input.terminal,
    },
    {
      code: 'no-platform-failure',
      ok: !platformFailure,
      detail: platformFailure ? input.terminal : 'ok',
    },
    {
      code: 'data-complete',
      ok: dataComplete !== false,
      detail: dataComplete === false ? 'required run data missing' : 'ok',
    },
    ...scope.stages.map((stage): FunctionalCheck => {
      const entry = stages.find((item) => item.stage === stage);
      return {
        code: `stage:${stage}:coverage`,
        ok: !!entry?.reached,
        detail: entry?.reached ? 'observed' : 'stage-not-observed',
      };
    }),
  ];

  return {
    declared: scope,
    actual: {
      terminal: input.terminal,
      stagesReached: [...reachedSet],
      rounds: Number.isFinite(input.rounds) ? Math.max(0, Math.floor(input.rounds)) : 0,
      maxDays: typeof input.maxDays === 'number' && Number.isFinite(input.maxDays)
        ? Math.max(0, Math.floor(input.maxDays))
        : null,
      sessionStatus: input.sessionStatus ?? null,
      currentStage: input.currentStage ?? null,
    },
    stages,
    checks,
    scoreIndependent: true,
  };
}

/** 只用于诊断：把 findings 按 code 计数（不参与终态判定）。 */
export function countFindingCodes(findings: RunFindingLike[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of Array.isArray(findings) ? findings : []) {
    const code = asString(item?.code);
    if (!code) continue;
    out[code] = (out[code] || 0) + 1;
  }
  return out;
}
