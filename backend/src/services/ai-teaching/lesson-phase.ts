/* eslint-disable @typescript-eslint/no-explicit-any -- 边界解析 LLM/JSON 动态载荷，形状由上游契约与运行时校验兜底 */
/**
 * 课堂阶段协议（2026-11-26 课堂重设计）。
 *
 * 一句话：**课的结构由代码定，阶段内的教学由模型定。**
 *
 * 为什么要有它（课堂实录 + 三路独立外审的共同结论）：
 *  - 此前课堂没有「课」的概念，只有「回合」——每回合模型自己决定讲什么、要不要出题；
 *    而契约又要求独立证据，于是 `forceCheckpoint` 每轮逼它出题：13 条教师回复 13 道题，
 *    46% 的提问答案已经讲过，0 次整合、0 次收束（「小测跑步机」）。
 *  - 图每轮重画、轴一直换，学生无法把它当参照物；老师还会指着不存在的行列讲课。
 *
 * 生命周期（一节任务课）：
 *   orient（点名部件：只命名、不讲机制，让学生先猜）
 *   → build × K（分段建构：一段一图一句，讲完就停；板上每段露一行）
 *   → integrate（整合：学生把各段连起来讲一遍；第 1 道题）
 *   → transfer（迁移：新情境里用刚建的口径判断；第 2 道题）
 *   → audit（审错：给一个错误说法让学生挑错；第 3 道题）
 *   → close（收束：学生 3 句话总结 + 对照验收标准；终检由既有课末终检负责）
 *
 * 出题只发生在 integrate / transfer / audit 三个阶段，每阶段至多 1 道（卡上可重答 1 次）。
 * 这是「检查替代教学」的结构性修法：不是加一句提示词劝模型少出题，而是让它没有出题的时机。
 *
 * 依据：分段（segmenting d≈0.70）、预训练（pre-training d≈0.46）、预测—揭晓（productive failure
 * 须配 consolidation）、ICAP（填空是 Active，成句解释才是 Constructive）。详见
 * docs/research/multimedia-diagram-tutoring-research.md §11。
 *
 * 本模块全部是纯函数（无 IO、无模型调用），供 engine 每回合调用两次：
 *   `resolveLessonPhaseTurn`（回合开始：算出本轮所处阶段、能否出题、板书露到哪一段、给老师的阶段指令）
 *   `settleLessonPhase`（回合结束：记下本轮结果，持久化进 teachingState.lessonPhase）。
 */
import type { LessonContract, LessonEvidence } from './lesson-contract';
import { evaluateLessonContract, isKcMentioned } from './lesson-contract';
import type { LessonAnchor } from './lesson-anchor';

export type LessonPhase = 'orient' | 'build' | 'integrate' | 'transfer' | 'audit' | 'close';

/** 教学段：板书的一行组（或没有板时的一个核心知识点）。 */
export interface LessonSegment {
  /** 1 基 */
  index: number;
  title: string;
  /** matrix 行下标（0 基） */
  rows?: number[];
  /** state-strip 帧下标（0 基） */
  frames?: number[];
}

/** full = 完整六阶段；compact = 单段小课（点名 → 建构 → 迁移 → 收束） */
export type LessonProfile = 'full' | 'compact';

export interface LessonPhaseState {
  version: 1;
  profile: LessonProfile;
  exploratory: boolean;
  phase: LessonPhase;
  /** 当前阶段已过的教师回合数 */
  phaseTurns: number;
  /** 本课已过的教师回合数 */
  totalTurns: number;
  /** build：当前段序号（1 基） */
  segment: number;
  segments: LessonSegment[];
  /** 当前阶段已出的题数 */
  checksInPhase: number;
  /** 当前阶段的检查已通过（含学生质疑成立而作废） */
  phasePassed: boolean;
  /** 上一轮教师声明「本段讲完了」（回合开始时消费） */
  segmentDone: boolean;
  passedPhases: LessonPhase[];
  /** 学生质疑题目并成立（作废）的次数：正向证据，结课报告可见 */
  challengesUpheld: number;
  /** 本课各道检查已经考核过的核心知识点（按考核先后）：新检查优先考还没考过的 */
  targetedKcs: string[];
}

export const LESSON_PHASE_TURN_CAP = 30;
/** 一段最多讲几个教师回合（学生持续追问时不无限停留） */
const BUILD_SEGMENT_TURN_CAP = 3;
/** 收束阶段最多等几轮学生总结 */
const CLOSE_TURN_CAP = 3;

const FULL_SEQUENCE: LessonPhase[] = ['orient', 'build', 'integrate', 'transfer', 'audit', 'close'];
const COMPACT_SEQUENCE: LessonPhase[] = ['orient', 'build', 'transfer', 'close'];

export const CHECK_PHASES: readonly LessonPhase[] = ['integrate', 'transfer', 'audit'];

const PHASE_LABEL: Record<LessonPhase, string> = {
  orient: '点名部件',
  build: '分段建构',
  integrate: '整合',
  transfer: '迁移',
  audit: '审错',
  close: '收束',
};

export function isLessonPhase(value: unknown): value is LessonPhase {
  return typeof value === 'string' && (FULL_SEQUENCE as readonly string[]).includes(value);
}

export function lessonPhaseLabel(phase: LessonPhase): string {
  return PHASE_LABEL[phase];
}

function normalizeSegment(raw: unknown, index: number): LessonSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return null;
  const nums = (value: unknown) => (Array.isArray(value)
    ? value.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0)
    : []);
  return {
    index,
    title: title.slice(0, 40),
    ...(Array.isArray(record.rows) ? { rows: nums(record.rows) } : {}),
    ...(Array.isArray(record.frames) ? { frames: nums(record.frames) } : {}),
  };
}

/** 由板书分段（matrix 的 rowSegments / state-strip 的 frameSegments）派生教学段。 */
export function segmentsFromBoard(
  spec: Record<string, unknown> | null | undefined,
  titles?: unknown,
): LessonSegment[] {
  if (!spec) return [];
  const perItem = Array.isArray(spec.rowSegments)
    ? { key: 'rows', values: spec.rowSegments }
    : Array.isArray(spec.frameSegments)
      ? { key: 'frames', values: spec.frameSegments }
      : null;
  if (!perItem) return [];
  const groups = new Map<number, number[]>();
  perItem.values.forEach((segment, itemIndex) => {
    const seg = Number(segment);
    if (!Number.isInteger(seg) || seg < 1) return;
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg)!.push(itemIndex);
  });
  const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]).slice(0, 4);
  const labels = Array.isArray(spec.rowLabels) ? spec.rowLabels as unknown[]
    : Array.isArray((spec.frames as unknown[] | undefined)) ? (spec.frames as Array<{ label?: unknown }>).map((f) => f?.label) : [];
  const titleList = Array.isArray(titles) ? titles : [];
  return sorted.map(([seg, items], i) => {
    // 一段可能盖多行（板书行数 > 4 段上限时由设计端合并）：标题要把本段的行都点出来。
    // 2026-11-26 B7 实录：段 1 含「泰勒斯」「赫拉克利特」两行，标题只写第一行，
    // 老师以为本段只有一行，讲完泰勒斯就跳到下一段的柏拉图，第二行整段没人讲。
    const segmentLabels = items
      .map((itemIndex) => labels[itemIndex])
      .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
      .map((label) => label.trim());
    const fallbackTitle = segmentLabels.length > 1
      ? segmentLabels.slice(0, 3).join('、').slice(0, 40)
      : segmentLabels[0] || `第 ${seg} 段`;
    const titled = titleList.find((entry) => entry && typeof entry === 'object' && Number((entry as { index?: unknown }).index) === seg) as { title?: unknown } | undefined;
    return {
      index: i + 1,
      title: typeof titled?.title === 'string' && titled.title.trim() ? titled.title.trim().slice(0, 40) : fallbackTitle,
      [perItem.key]: items,
    };
  });
}

/** 没有板书分段时：每个核心知识点一段；再没有就用任务标题兜一段。 */
export function segmentsFromKcs(kcNames: string[], taskTitle: string): LessonSegment[] {
  const names = kcNames.map((name) => String(name || '').trim()).filter(Boolean);
  if (names.length > 0) return names.slice(0, 4).map((title, index) => ({ index: index + 1, title }));
  return [{ index: 1, title: String(taskTitle || '').trim() || '本课内容' }];
}

export function normalizeLessonPhaseState(raw: unknown): LessonPhaseState | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isLessonPhase(record.phase)) return null;
  const segments = Array.isArray(record.segments)
    ? record.segments.map((item, index) => normalizeSegment(item, index + 1)).filter((item): item is LessonSegment => !!item)
    : [];
  if (segments.length === 0) return null;
  const profile: LessonProfile = record.profile === 'compact' || segments.length <= 1 ? 'compact' : 'full';
  const sequence = profile === 'compact' ? COMPACT_SEQUENCE : FULL_SEQUENCE;
  const phase: LessonPhase = sequence.includes(record.phase) ? record.phase : 'build';
  return {
    version: 1,
    profile,
    exploratory: record.exploratory === true,
    phase,
    phaseTurns: Math.max(0, Number(record.phaseTurns) || 0),
    totalTurns: Math.max(0, Number(record.totalTurns) || 0),
    segment: Math.min(segments.length, Math.max(1, Number(record.segment) || 1)),
    segments,
    checksInPhase: Math.max(0, Number(record.checksInPhase) || 0),
    phasePassed: record.phasePassed === true,
    segmentDone: record.segmentDone === true,
    passedPhases: Array.isArray(record.passedPhases)
      ? record.passedPhases.filter(isLessonPhase)
      : [],
    challengesUpheld: Math.max(0, Number(record.challengesUpheld) || 0),
    targetedKcs: Array.isArray(record.targetedKcs)
      ? record.targetedKcs.filter((item): item is string => typeof item === 'string' && !!item.trim())
      : [],
  };
}

/**
 * 学生对「材料/任务本身」发懵的信号（2026-11-27 真课：开场说「用的是两小段示意转述」
 * 却一句都没摆出来，学生回「我都不知道是什么事情啊」，阶段机照样推进到建构）。
 * 只用于点名阶段：那里的「不知道」只可能是听不懂课，不可能是答不出题。
 */
export function isLearnerConfusionSignal(text: string): boolean {
  const value = String(text || '').trim();
  if (!value || value.length > 40) return false;
  if (/(我知道|明白了|懂了|知道了)/.test(value)) return false;
  return /(不知道|不明白|不懂|没懂|没看懂|没听明白|啥意思|什么意思|看不明白|一头雾水|好懵|懵了|晕)/.test(value);
}

export interface LessonPhaseTurnContext {
  /** 本回合之前已有的教师教学回复数（不含开场欢迎语） */
  teachingTurns: number;
  isResume: boolean;
  /** 本回合是检查点作答（卡片提交） */
  isSubmission: boolean;
  /** 本回合作答的代码裁决；非作答回合为 null */
  verdictPassed: boolean | null;
  /** 本回合之前有待答检查点（且本回合不是在提交它） */
  pendingCheckpoint: boolean;
  endIntent: boolean;
  /** 学生明确要求跳过讲解直接练/考 */
  learnerSkipRequested: boolean;
  studentMessage: string;
  contract: LessonContract | null;
  /** 本回合之前的证据（作答回合已并入本次作答） */
  evidence: LessonEvidence[];
  segments: LessonSegment[];
  exploratory: boolean;
  /** 本课已出现的教师可见文本 + 板面文字（点名检查用） */
  taughtText: string;
  /** 任务验收标准（收束时让学生对照） */
  acceptanceCriteria: string | null;
  /** 课堂锚（主问题 + 自然过关判据 + 学习者基线） */
  anchor?: LessonAnchor | null;
  /** 本回合是否已强制收口（契约终检额度用尽等） */
  forcedClose?: boolean;
  /**
   * 本课板书的形态：null = 没有板书；segmentCount = 0 = 不能分段的整块板（开课即全图）；
   * segmentCount > 0 = 可分段的板（点名阶段只露行列名骨架）。
   */
  board?: { segmentCount: number } | null;
}

export type LessonCheckKind = 'integrate' | 'transfer' | 'audit';

export interface LessonPhaseTurnView {
  state: LessonPhaseState;
  /** 本轮 controls.emitCheckpoint */
  emitCheckpoint: boolean;
  checkKind: LessonCheckKind | null;
  /** 本轮若出题，题目考核的核心知识点（契约缺口按顺序轮转） */
  targetKc: string | null;
  /** 尚无独立证据的核心知识点 */
  gapKcs: string[];
  /** 本课至今一次都没被提到的核心知识点（讲解时必须带到） */
  untaughtKcs: string[];
  /** 板书露到第几段：0 = 只有骨架；segments.length = 全图 */
  revealLevel: number;
  /**
   * 本轮学生屏幕上的板：none 没有板书 / whole 不能分段的整块板（开课即全图）/
   * skeleton 只有行列名 / partial 露到某一段 / full 全图
   */
  boardReveal: 'none' | 'whole' | 'skeleton' | 'partial' | 'full';
  /** 收束阶段学生已给出总结：本轮进入课末终检 / 完成判定 */
  completionDue: boolean;
  /** 给老师的阶段指令（注入本轮载荷尾部） */
  directive: string;
}

function initialLessonPhaseState(segments: LessonSegment[], exploratory: boolean): LessonPhaseState {
  return {
    version: 1,
    profile: segments.length <= 1 ? 'compact' : 'full',
    exploratory,
    phase: 'orient',
    phaseTurns: 0,
    totalTurns: 0,
    segment: 1,
    segments,
    checksInPhase: 0,
    phasePassed: false,
    segmentDone: false,
    passedPhases: [],
    challengesUpheld: 0,
    targetedKcs: [],
  };
}

function sequenceOf(profile: LessonProfile): LessonPhase[] {
  return profile === 'compact' ? COMPACT_SEQUENCE : FULL_SEQUENCE;
}

function enterPhase(state: LessonPhaseState, phase: LessonPhase, segment: number): LessonPhaseState {
  return {
    ...state,
    phase,
    segment,
    phaseTurns: 0,
    checksInPhase: 0,
    phasePassed: false,
    segmentDone: false,
  };
}

function nextPhaseOf(state: LessonPhaseState, phase: LessonPhase): LessonPhase {
  const sequence = sequenceOf(state.profile);
  const at = sequence.indexOf(phase);
  return sequence[Math.min(sequence.length - 1, at + 1)];
}

const SKIP_REQUEST_PATTERN =
  /(直接|先|就|不用.{0,4}讲|别讲|跳过.{0,6}讲解|跳过.{0,4}直接)[^。！？\n]{0,8}(考|练|测|出题|做题|上题|检验)|我(已经|都)?(会|懂|掌握|学过)了|直接(考|练|测|出题|做题|上题)/;

/** 学生明确要求「别讲了直接练/考」：尊重节奏请求，跳到检查阶段。 */
export function detectLearnerSkipRequest(message: string): boolean {
  return SKIP_REQUEST_PATTERN.test(String(message || ''));
}

function isSubstantiveSummary(message: string): boolean {
  const text = String(message || '').replace(/[^\p{L}\p{N}]/gu, '');
  return text.length >= 12;
}

/**
 * 本轮检查考核哪个核心知识点：契约缺口里**还没考过**的第一个（按契约顺序）。
 * 每道检查换一个知识点，证据才铺得开；上一道没过不会让下一道追打同一个点。
 * 同样没考过的里面，**这节课讲到过的优先**——没讲过的点出题就是考没教过的东西；
 * 缺口全都考过了（都在补测）→ 回到第一个缺口。
 */
function pickTargetKc(gapKcs: string[], targetedKcs: string[], taughtText: string): string | null {
  if (gapKcs.length === 0) return null;
  const fresh = gapKcs.filter((name) => !targetedKcs.includes(name));
  return fresh.find((name) => isKcMentioned(name, taughtText))
    ?? fresh[0]
    ?? gapKcs[0];
}

function segmentTitle(state: LessonPhaseState, index: number): string {
  return state.segments.find((segment) => segment.index === index)?.title ?? '';
}

/**
 * 回合开始：算出本轮所处的阶段与给老师的指令。
 *
 * `previous` 为 null 且本课还没开始（teachingTurns === 0）→ 新建；`previous` 为 null 但课已上过若干轮
 * → 返回 null（存量课堂沿用旧节奏，不半路换课型）。
 */
export function resolveLessonPhaseTurn(
  previous: LessonPhaseState | null,
  ctx: LessonPhaseTurnContext,
): LessonPhaseTurnView | null {
  if (!previous) {
    if (ctx.teachingTurns > 0) return null;
    previous = initialLessonPhaseState(ctx.segments, ctx.exploratory);
  }

  let state: LessonPhaseState = { ...previous };
  const skip = ctx.learnerSkipRequested && !ctx.isResume;
  const forcedClose = ctx.forcedClose === true;

  const advanceFrom = (phase: LessonPhase): LessonPhaseState => {
    const next = nextPhaseOf(state, phase);
    return enterPhase(state, next, state.segment);
  };

  if (ctx.forcedClose) {
    state = enterPhase(state, 'close', state.segment);
  } else if (!ctx.isResume && ctx.endIntent && state.phase !== 'close') {
    state = enterPhase(state, 'close', state.segment);
  } else if (state.phase === 'orient') {
    // 困惑不消耗点名的唯一一轮：学生说「不知道/啥意思」时先在点名里把材料摆出来，
    // 下一轮再进入建构（最多多留一轮，phaseTurns>=2 强制推进，避免卡在点名）。
    if (!ctx.isResume
      && (skip
        || state.phaseTurns >= 2
        || (state.phaseTurns >= 1 && !isLearnerConfusionSignal(ctx.studentMessage)))) {
      state = skip
        ? enterPhase(state, state.profile === 'compact' ? 'transfer' : 'integrate', state.segments.length)
        : enterPhase(state, 'build', 1);
    }
  } else if (state.phase === 'build') {
    const holdNoviceCompact = state.profile === 'compact'
      && ctx.anchor?.learnerBaseline === 'novice'
      && state.phaseTurns < 2;
    if (!ctx.isResume && skip) {
      state = enterPhase(state, state.profile === 'compact' ? 'transfer' : 'integrate', state.segments.length);
    } else if (!ctx.isResume && !holdNoviceCompact && (state.phaseTurns >= BUILD_SEGMENT_TURN_CAP || state.segmentDone)) {
      state = state.segment < state.segments.length
        ? enterPhase(state, 'build', state.segment + 1)
        : advanceFrom('build');
    }
  } else if (CHECK_PHASES.includes(state.phase)) {
    if (state.totalTurns >= LESSON_PHASE_TURN_CAP) {
      state = enterPhase(state, 'close', state.segments.length);
    } else if (!ctx.isResume && !ctx.isSubmission && !ctx.pendingCheckpoint && (state.phasePassed || state.checksInPhase >= 1)) {
      // 提交轮（反馈轮）仍留在本阶段：通过与否都在反馈之后、下一回合开始时才推进
      state = advanceFrom(state.phase);
    }
  }

  if (!forcedClose && state.phase !== 'close' && state.totalTurns >= LESSON_PHASE_TURN_CAP) {
    state = enterPhase(state, 'close', state.segments.length);
  }

  const segmentCount = state.segments.length;
  const inCheck = CHECK_PHASES.includes(state.phase) ? state.phase as LessonCheckKind : null;
  const evaluation = ctx.contract
    ? evaluateLessonContract({ contract: ctx.contract, evidence: ctx.evidence, teachingTurns: ctx.teachingTurns })
    : null;
  const independent = new Set((evaluation?.independentKcs ?? []).map((name) => name.trim()));
  const coreKcs = (ctx.contract?.coreKcs ?? []).map((kc) => kc.name);
  const gapKcs = coreKcs.filter((name) => !independent.has(name.trim()));
  const untaughtKcs = coreKcs.filter((name) => !isKcMentioned(name, ctx.taughtText));
  const emitCheckpoint = inCheck !== null
    && state.checksInPhase === 0
    && !ctx.isSubmission
    && !ctx.isResume
    && !ctx.pendingCheckpoint
    && !ctx.endIntent;
  const targetKc = emitCheckpoint ? pickTargetKc(gapKcs, state.targetedKcs, ctx.taughtText) : null;

  const revealLevel = state.phase === 'orient'
    ? 0
    : state.phase === 'build'
      ? Math.max(1, state.segment)
      : segmentCount;

  const boardReveal: LessonPhaseTurnView['boardReveal'] = !ctx.board
    ? 'none'
    : ctx.board.segmentCount <= 0
      ? 'whole'
      : revealLevel === 0
        ? 'skeleton'
        : revealLevel >= ctx.board.segmentCount
          ? 'full'
          : 'partial';

  const completionDue = state.phase === 'close'
    && (state.phaseTurns >= CLOSE_TURN_CAP
      || (state.phaseTurns >= 1 && !ctx.isResume && isSubstantiveSummary(ctx.studentMessage)));

  const directive = buildDirective(state, {
    inCheck,
    emitCheckpoint,
    targetKc,
    gapKcs,
    untaughtKcs,
    ctx,
    completionDue,
    boardReveal,
  });

  return {
    state,
    emitCheckpoint,
    checkKind: inCheck,
    targetKc,
    gapKcs,
    untaughtKcs,
    revealLevel,
    boardReveal,
    completionDue,
    directive,
  };
}

function buildDirective(
  state: LessonPhaseState,
  params: {
    inCheck: LessonCheckKind | null;
    emitCheckpoint: boolean;
    targetKc: string | null;
    gapKcs: string[];
    untaughtKcs: string[];
    ctx: LessonPhaseTurnContext;
    completionDue: boolean;
    boardReveal: LessonPhaseTurnView['boardReveal'];
  },
): string {
  const { inCheck, emitCheckpoint, targetKc, gapKcs, untaughtKcs, ctx, completionDue, boardReveal } = params;
  const head = `【课堂阶段】${lessonPhaseLabel(state.phase)}${state.phase === 'build' ? ` · 第 ${state.segment}/${state.segments.length} 段` : ''}`;
  const segmentNames = state.segments.map((segment) => `「${segment.title}」`).join('');
  const segmented = boardReveal === 'skeleton' || boardReveal === 'partial' || (boardReveal === 'full' && (ctx.board?.segmentCount ?? 0) > 0);
  // 指板用语跟着学生屏幕上真实有什么走：没板不许提「板」，整块板不说「这一行刚露出」
  const where = boardReveal === 'none'
    ? '本课没有板书：不要提「板/图/看上面」。'
    : segmented
      ? '板上是按行分段的表：没露出的行在屏幕上是空的，不要指、不要提前讲。'
      : '板上是一整块图（不按段露出）：指板只指本段对应的部位，其它部位不要展开。';

  if (state.phase === 'orient') {
    if (isLearnerConfusionSignal(ctx.studentMessage)) {
      // 困惑回退（2026-11-27 真课）：学生说「我都不知道是什么事情啊」，老师给完背景仍在问
      // 「没有连接词还有没有结论」这种抽象题——他连要拆的句子都没见过。本轮不考预测，
      // 先把材料里第一组逐字摆出来，再用大白话给一个不需要术语的判断动作。
      return [
        head,
        '学生这句话是在说「材料/任务本身没听懂」，不是在答题。本轮不推进到建构，也不考预测。',
        '本轮只做三件事：',
        '① 先把本课材料里要判断的那一组**逐字**摆出来（只摆第一组，后面的组先别倒出来）；确实没有可摆的原文时，才用一句大白话讲清：谁在跟谁争什么。',
        '② 用一句白话把这个任务翻译成本轮动作：一句话里，有的话是**结论**（说这话的人想让你信的那句），有的话是**前提**（拿来撑它的）。不要一上来堆「论证骨架/前提结论」这些术语。',
        '③ 只问一个不需要术语、看得着材料的判断：「这两句里，哪一句是在给另一句撑腰？」或「去掉哪一句，另一句就站不住？」——不要问「没有连接词还有没有结论」这种离开材料的抽象题。',
        '4–6 句；不出小测、不讲机制、不亮答案。',
      ].join('\n');
    }
    const anchor = ctx.anchor;
    const isNovice = anchor?.learnerBaseline === 'novice';
    const anchorLine = anchor
      ? `本节主问题：「${anchor.mainQuestion}」。${isNovice ? `学生未接触过本材料/零基础${anchor.baselineNote ? `（${anchor.baselineNote}）` : ''}：先用 2–3 句大白话交代背景语境（作者在解决什么问题、本节在全篇的起点位置），不要假设他看过原书/学过前序概念。` : ''}`
      : '';
    return [
      head,
      anchorLine,
      '本轮只做三件事（教师主导领读：先立语境与指路，不讲机制）：',
      `① 先用一句话接住学生这句话，不展开讲"为什么"；禁止把后台短标签（如「还原某根据」）当口号念出来，**禁止把后台验收标准当考纲清单逐条念给学生**（如「这节要做的就两件事：一是…二是…至少一个具体依据」）；若本课带材料，明确指明「现在先只看哪一句/哪一小段」，由你带着走，不要让零基础学生对着整段原文自己摸；`,
      boardReveal === 'none' ? '本课没有板书：不要提「板/图/看上面」。' : '',
      boardReveal === 'skeleton'
        ? `② 板上现在只有行列名的空骨架（格子会随讲解一行一行填上）：对着行列名把本课的几个部件点名——${segmentNames}，只说名字和它们在板上的位置，不讲谁产生谁、谁决定谁；`
        : boardReveal === 'none'
          ? `② 把本课的几个部件点名：${segmentNames}——只说名字，不讲谁产生谁、谁决定谁；`
          : `② 板上已是全图：逐个指认本课的几个部件——${segmentNames}——只说名字和位置，不讲它们之间的关系；`,
      boardReveal === 'whole' || boardReveal === 'full'
        ? '③ 抛一个聚焦的开放式思考问题（只问板上读不出来的关系或作者意图，不要问板上已经写明的事实——那是查表，不是思考；不要用「猜错没关系：是A还是B」式送分二选一）。'
        : '③ 抛一个聚焦的开放式思考问题，让学生用自己的话先说第一反应（这是用来打开思路的，不是检测；不要用「猜错没关系：是A还是B」式送分二选一）。',
      '本轮不出小测、不讲机制、不亮结论；4–6 句。',
      '不要把上一句刚讲明的关系，换一个同义问法再问一遍（2026-11-27 真课：「后面那半句是被理由撑着的，还是拿来撑别人的？」——上一行刚说完「后面那半句是他想让你认下的」）。要问就问一个需要新判断的对象：材料里的另一组、换一个说法、或换个条件。',
    ].join('\n');
  }

  if (state.phase === 'build') {
    const title = segmentTitle(state, state.segment);
    const rowsInSegment = state.segments[state.segment - 1]?.rows?.length ?? 0;
    const nextTitle = state.segment < state.segments.length ? segmentTitle(state, state.segment + 1) : '';
    const lastSegment = state.segment >= state.segments.length;
    // 每段收尾的学生动作按段轮转（2026-11-26 真课实录）：原来三段都写「用自己的话复述这一段」，
    // 模型照着连问三次「你用自己的话说一遍：X 这一行在回答什么问题」——同一动作逐行过堂，
    // 学生只是在换台词重复同一件事。预测 → 复述 → 换例判断，三种动作用在不同段上。
    const isNovice = ctx.anchor?.learnerBaseline === 'novice';
    const preferOpenBuild = !isNovice || state.segment > 1 || ctx.studentMessage.trim().length >= 16;
    const askAction = lastSegment
      ? '给一个本课材料里换个对象或条件的小例子，让他判断这一步还成不成立；'
      : state.segment % 3 === 1
        ? `猜下一段「${nextTitle}」会怎样——${preferOpenBuild ? '让他用自己的话先预判关键条件或转折，不要给送分二选一' : '给一个有真实分歧的简短预判或开放小问，让他先说，再讲'}；`
        : state.segment % 3 === 2
          ? '让他用自己的话把这一段压成一句（限一句，不超过 30 字）；'
          : '给一个换了对象或条件的小例子，让他判断这一步还成不成立；';
    const anchorCue = ctx.anchor?.criteria?.length
      ? `本节要帮学生真正搞懂「${ctx.anchor.mainQuestion}」，过关标准：${ctx.anchor.criteria.map((c) => c.text).join('；')}。`
      : '';
    return [
      head,
      `本段：「${title}」${boardReveal === 'partial' ? '——板上这一轮刚露出这一段。' : ''}`,
      anchorCue,
      where,
      `① 讲清本段：每句话只指一个格子或一个元素，指板时用板上写着的行列名原文（不说"第几行/第几列"），${isNovice ? '4–7 句（学生零基础，先把材料原句的来龙去脉和为什么这样讲透，不要两句话敷衍抛题）' : '3–5 句'}；`,
      rowsInSegment > 1
        ? `本段板书上有 ${rowsInSegment} 行（${title}）：按板的行序逐行讲到（每行 2–3 句），这 ${rowsInSegment} 行都讲完再停——不要只讲第一行就跳到下一段，也不要留下某一行没人讲。`
        : '',
      `② 讲完就停，让学生做一个动作：${askAction}`,
      '不要用同义问法重复上一轮已经问过/已经讲明的关系；学生答对后直接推进到下一段或换一个新对象，不要原地换个说法再考一遍。',
      '不讲后面的段、不提前给后面段的答案、不出小测（本轮 emitCheckpoint=false）、不改写板上的行列名。',
      // 2026-11-26 外审（Case B3 第 8/14 回合）：同一行先写成「可感事物为何如此」、正文又说成
      // 「什么才算真正存在」，学生照板书答反而被判错。板上那一格就是本课唯一口径。
      '本段对外的判断口径，必须与你写进板上那一格的文字一致；不得在正文里换第二套说法。',
      // 2026-11-26 学科外审（A 节）：板上的格子是对的（丙酮酸 + H₂O → CO₂ + [H]），但讲解为了
      // 「讲得通俗」自创了「水接住碳和氢」这种材料里没有的机制。讲解的因果只能用板上已露出的
      // 反应物/产物/场所与材料原文衔接，不得自创比喻机制或课本没有的反应。
      '讲机制只用板上这一行写着的反应物、产物、场所和材料原文做衔接；不得为了讲得通俗自创比喻性机制，或增加材料里没有的反应与因果。',
      // 只有最后一段才点「还没讲到的核心点」：第一段就把全部知识点列成「必须讲到」会把整课挤进一段
      untaughtKcs.length > 0 && lastSegment
        ? `这是最后一段。以下核心点整节课还没被提到，本段讲解必须带到：${untaughtKcs.join('、')}。`
        : '',
      '学生岔开提问导致本段没讲完时 control.segmentDone 设 false；本段讲完了设 true。',
    ].filter(Boolean).join('\n');
  }

  if (inCheck) {
    const target = targetKc ? `conceptName 填「${targetKc}」` : 'conceptName 填本题考核的核心知识点';
    if (ctx.isSubmission) {
      return [
        head,
        ctx.verdictPassed === true
          ? '代码裁决：答对。第一句明确肯定这题答对了，并点出他做对的那一步；不再出新题、不追加追问（下一阶段再继续）。1–3 句。'
          : ctx.verdictPassed === false && ctx.pendingCheckpoint
            ? '代码裁决：没答对（这道题还在卡片上，可以再答一次）。第一句先给裁决，然后只给一条线索——指向板上的具体位置或推理的第一步，不说出答案；请他在卡片上再答一次。不要把同一道题再贴一遍。'
            : '代码裁决：没答对（重答次数已用完）。第一句先给裁决，然后把正确答案和依据讲透——这一轮可以明说哪个对、为什么，不要只点一半让学生再猜；本轮不出新题。',
      ].join('\n');
    }
    if (ctx.pendingCheckpoint) {
      return [
        head,
        '有一道题还在等他答。他若在质疑这道题：先复述他的质疑 → 明确判定是「题出错了 / 表述有歧义 / 他推理有误」→ 说清理由 → 按判定处理：'
        + '题错或有歧义时输出 control.voidCheckpoint=true，承认这题不算，并把他的质疑当作比答对更值钱的表现；他推理有误时指出错在哪一步，请他再答一次。'
        + '不得原题重问，不得只表扬不处理。他只是没答：一句话请他先答这道题，不展开新内容。',
      ].join('\n');
    }
    if (!emitCheckpoint) {
      return `${head}\n本轮不出新题：简短承接学生这句话，然后请他准备好进入下一环节。`;
    }
    // 整合题只问一件事（2026-11-26 真课实录）：原来出的是「把这几段连成一条线，讲给没学过的人听」
    // 这种多问句口述任务，答案键却是逐组关键词匹配——学生只答其中一问（实录：「线粒体内膜」）
    // 被判负，老师还得猜他错在哪，于是凭空纠正了一个他没说过的说法。改成单问句、答案一句话可承载，
    // 关键词只收「一句话正确回答必然会写到的词」，判分口径与题目形态对齐。
    const variants: Record<LessonCheckKind, string> = {
      integrate: state.exploratory
        ? `出 control.checkpoint：type=short_answer，只问一件事——从这几段里挑两段，判断它们是不是在回答同一个问题（点明是哪两段 + 一句判断依据）。题干只留一个问号，不要把几段挨个问一遍。expectedKeywords 给 2–3 组，每组只放这句判断必然会写到的词（同义写法用 | 并列）。本次整合只讲「每条各自在回答什么问题」，不要用「从 A 到 B 一路变/进步」的叙事（除非材料本身就是时间线）——几条并列的说法不要硬排成演变。`
        : `出 control.checkpoint：type=short_answer，只问一件事——挑一条能横跨两段的因果，问「为什么」或「如果缺了这一段，后面哪一步就立不住」，让他一两句话回答（对着板上的全图）。题干只留一个问号，不要「先…再…最后…」式多问。expectedKeywords 给 2–3 组，每组只放一句正确回答必然会写到的词（同义写法用 | 并列）——他这一句话要能全中。`,
      transfer: '出 control.checkpoint：给一个本课没出现过的新情境（换对象/装置/条件，不换知识点），让学生用刚建的口径自己判断并说明依据——选择题或简答均可，简答要成句解释。题干必须自包含（条件写全），答案不能从板上一眼读走。若出选择题：正确选项禁止把刚讲过的原话整句照抄，干扰项必须是常见误解或表面混淆，禁止用一眼就能排除的荒谬/态度评判选项（如「素质低/骂人」）。涉及同位素标记/守恒类的题：写清时间尺度（如「短时间内」），并确认答案不会因为二次参与而翻案（例：¹⁸O 生成的水可再作为反应物进入下一段）。',
      audit: '出 control.checkpoint：给一句本课常见的错误说法（可取自本课出现过的误区），让学生"指出错在哪、依据是什么"——简答，或"下面哪个说法有问题"的选择题。学生挑对要明确肯定：能看出说法哪里不成立，比答对一道题更值钱。',
    };
    return [
      head,
      `本轮出 1 道题，${target}。`,
      // Meno 闸：点名的知识点整节课没讲到就不能直接考——先把判断依据给足
      targetKc && untaughtKcs.includes(targetKc)
        ? `注意：「${targetKc}」这节课还没讲到。出题前先用一两句话把这个点讲清（给出判断依据），再出题；不得考没教过的点。`
        : '',
      variants[inCheck],
      // 2026-11-26 外审（Case B3 第 12 回合）：整合题问「为什么前面的答法答不下去了」，
      // 答案键只有「构成 / 含义」两个名词标签——学生把两个词写出来就被判对，因果论证没发生。
      inCheck === 'integrate'
        ? 'expectedKeywords 里至少有一组必须是关系或因果词（如「答不下去|对不上|不成立」「因此|所以|换成…就」），不能全是名词标签——只报两个名词不算回答了「为什么」。'
        : '',
      'reply 只写一两句引入（不复述题面、不重复 control.checkpoint.question 里的任何一句、不列选项、不先讲答案）。',
    ].filter(Boolean).join('\n');
  }

  // close
  if (completionDue) {
    return [
      head,
      '学生已经给出总结：用 1–2 句回应（点出最扎实的一处、最该再练的一处），然后照系统安排进行结课（如附带终检题，不要再追加别的问题）；不要自己宣布任务完成。',
    ].join('\n');
  }
  // 学生要离开（结束意图）：不要再要求总结/作答（2026-11-26 A5 实录：学生说「今天就到这里，谢谢」，
  // 老师给了悬题的答案后仍要求「用三句话把主线说一遍」——对方的请求是下课，不是练一句）。
  if (ctx.endIntent) {
    return [
      head,
      ctx.pendingCheckpoint
        ? '学生要下课了，还有一道题没答：用一两句话直接给出正确答案与依据（不要求他再答、不再贴题面），再把「带走的一句」讲完。'
        : '',
      '不要再要求他做总结、答题或补一句复述；一句话回应本课最扎实的一处，给一句带得走的判据 + 一个具体下一步，干净收束。',
      '不要自己宣布任务完成。',
    ].filter(Boolean).join('\n');
  }
  const criteriaLine = ctx.anchor?.criteria?.length
    ? ctx.anchor.criteria.map((c) => c.text).join('；')
    : (ctx.acceptanceCriteria ? ctx.acceptanceCriteria.slice(0, 80) : '');
  return [
    head,
    `让学生自己收：用 3 句话说清本课主线，对照验收标准${criteriaLine ? `（${criteriaLine}）` : ''}说哪条做到了、哪条还没有，再给一个下一步。`,
    '老师不代答、不补充讲解、不发小测（结课另有终检）。',
    // 2026-11-26 外审（Case A3 第 12 回合 / Case B3 末回合）：学生说「今天就到这里」时还有一道题
    // 挂在他那儿没答，老师只留一句「下次接着练从它开始」就收课——那次检测既没发生也没结论，
    // 学生带着一道悬着的题离开。收束是这道题的最后一次处置机会：直接给答案，不再要求学生作答。
    ctx.pendingCheckpoint
      ? '收束前把还挂着的那道题收掉：用一两句话直接给出正确答案与依据（不要求他再答、不要再把题面贴一遍），再把「带走的一句」讲完。'
      : '',
    state.exploratory ? '收束可以换成：说出他自己的 3 个问题 + 想追的下一站。' : '',
    gapKcs.length > 0 ? `注意：以下核心点还没有独立证据：${gapKcs.join('、')}——请学生总结时专门说一说这几处。` : '',
  ].filter(Boolean).join('\n');
}

export interface LessonPhaseTurnOutcome {
  /** 模型声明本段讲完（build） */
  segmentDone: boolean;
  /** 本轮真的落库了一道新题 */
  checkpointEmitted: boolean;
  isSubmission: boolean;
  verdictPassed: boolean | null;
  /** 本轮模型判定题目不成立、系统已作废待答题 */
  checkpointVoided: boolean;
  /** 本轮发出的题考核的核心知识点（阶段机点名） */
  targetKc?: string | null;
}

/**
 * 回合结束：记下本轮结果。引擎把它写进 teachingState.lessonPhase，下一回合开始时再推进阶段。
 */
export function settleLessonPhase(state: LessonPhaseState, outcome: LessonPhaseTurnOutcome): LessonPhaseState {
  let next: LessonPhaseState = {
    ...state,
    phaseTurns: state.phaseTurns + 1,
    totalTurns: state.totalTurns + 1,
    segmentDone: outcome.segmentDone === true,
  };
  if (outcome.checkpointEmitted) {
    next = { ...next, checksInPhase: state.checksInPhase + 1 };
    if (outcome.targetKc && !state.targetedKcs.includes(outcome.targetKc)) {
      next = { ...next, targetedKcs: [...state.targetedKcs, outcome.targetKc] };
    }
  }
  if (outcome.isSubmission && outcome.verdictPassed === true && !next.phasePassed) {
    next = { ...next, phasePassed: true, passedPhases: [...state.passedPhases, state.phase] };
  }
  if (outcome.checkpointVoided && !next.phasePassed) {
    next = {
      ...next,
      phasePassed: true,
      passedPhases: state.passedPhases,
      challengesUpheld: state.challengesUpheld + 1,
    };
  }
  return next;
}

/** 给前端/管理端看的阶段摘要（随回合响应与 detail 下发）。 */
export function lessonPhaseSummary(view: LessonPhaseTurnView | null): Record<string, any> | null {
  if (!view) return null;
  return {
    phase: view.state.phase,
    profile: view.state.profile,
    label: lessonPhaseLabel(view.state.phase),
    segment: view.state.segment,
    segmentCount: view.state.segments.length,
    emitCheckpoint: view.emitCheckpoint,
    checkKind: view.checkKind,
    revealLevel: view.revealLevel,
    boardReveal: view.boardReveal,
    passedPhases: view.state.passedPhases,
    challengesUpheld: view.state.challengesUpheld,
  };
}
