/* eslint-disable @typescript-eslint/no-explicit-any -- 测试内构造状态载荷 */
/**
 * 课堂阶段协议（2026-11-26）：课的结构由代码定。
 *
 * 要钉住的行为（每条都对应实录里的一个失败形态）：
 *  1) 出题只发生在整合 / 迁移 / 审错三个阶段，每阶段至多 1 道——建构阶段无论学生答得多好都不出题；
 *  2) 分段建构：一段至少等学生回一次；教师声明「本段讲完」或讲满 3 轮才推进；
 *  3) 检查阶段：通过 → 下一阶段；没过且不能再答 → 不无限追打，进入下一阶段；
 *  4) 学生质疑题目成立（作废）→ 记为正向证据并推进，不算失败；
 *  5) 收束：学生给出总结后才允许进入课末终检；课有回合上限，不会永远收不了尾；
 *  6) 存量课堂（协议上线前已上过若干轮）不半路换课型。
 */
import {
  detectLearnerSkipRequest,
  isLessonPhase,
  lessonPhaseSummary,
  normalizeLessonPhaseState,
  resolveLessonPhaseTurn,
  segmentsFromBoard,
  segmentsFromKcs,
  settleLessonPhase,
  type LessonPhaseState,
  type LessonPhaseTurnContext,
} from '../lesson-phase';
import { buildLessonContract, isKcMentioned, kcMentionTokens } from '../lesson-contract';

const SEGMENTS = [
  { index: 1, title: '糖酵解（第一阶段）', rows: [0] },
  { index: 2, title: '柠檬酸循环（第二阶段）', rows: [1] },
  { index: 3, title: '氧化磷酸化（第三阶段）', rows: [2] },
];

function baseContext(overrides: Partial<LessonPhaseTurnContext> = {}): LessonPhaseTurnContext {
  return {
    teachingTurns: 0,
    isResume: false,
    isSubmission: false,
    verdictPassed: null,
    pendingCheckpoint: false,
    endIntent: false,
    learnerSkipRequested: false,
    studentMessage: 'CO₂ 我记得是第三阶段产生的？',
    contract: null,
    evidence: [],
    segments: SEGMENTS,
    exploratory: false,
    taughtText: '',
    acceptanceCriteria: '能把 CO₂、水、[H] 各自说清由哪个场所产生',
    ...overrides,
  };
}

/** 走完一个教师回合的记账（下一回合开始时由 resolveLessonPhaseTurn 推进阶段） */
function settle(view: { state: LessonPhaseState }, outcome: Partial<Parameters<typeof settleLessonPhase>[1]> = {}) {
  return settleLessonPhase(view.state, {
    segmentDone: false,
    checkpointEmitted: false,
    isSubmission: false,
    verdictPassed: null,
    checkpointVoided: false,
    ...outcome,
  });
}

describe('lesson-phase：全课生命周期（full 六阶段）', () => {
  it('点名 → 分段建构 → 整合 → 迁移 → 审错 → 收束，出题只落在三个检查阶段', () => {
    const seen: string[] = [];
    let state: LessonPhaseState | null = null;
    // 第 1 轮：点名部件（不出题，板书只有骨架）
    let view = resolveLessonPhaseTurn(state, baseContext())!;
    expect(view.state.phase).toBe('orient');
    expect(view.emitCheckpoint).toBe(false);
    expect(view.revealLevel).toBe(0);
    expect(view.directive).toContain('点名部件');
    seen.push(view.state.phase);
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });

    // 建构 3 段：每段教师声明讲完才推进，露出 1 → 2 → 3
    for (let segment = 1; segment <= 3; segment += 1) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      expect(view.state.phase).toBe('build');
      expect(view.state.segment).toBe(segment);
      expect(view.emitCheckpoint).toBe(false);
      expect(view.revealLevel).toBe(segment);
      seen.push(`build${segment}`);
      state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    }

    // 三个检查阶段：各出 1 道；学生答对后推进
    for (const phase of ['integrate', 'transfer', 'audit'] as const) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      expect(view.state.phase).toBe(phase);
      expect(view.emitCheckpoint).toBe(true);
      expect(view.checkKind).toBe(phase);
      expect(view.revealLevel).toBe(3);
      seen.push(phase);
      state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: true, isSubmission: false, verdictPassed: null, checkpointVoided: false });
      // 学生提交：裁决答对 → 反馈轮不出题 → 下一轮推进
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns, isSubmission: true, verdictPassed: true }))!;
      expect(view.state.phase).toBe(phase);
      expect(view.emitCheckpoint).toBe(false);
      expect(view.directive).toContain('答对');
      state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: true, verdictPassed: true, checkpointVoided: false });
    }

    // 收束：学生给出总结后才 completionDue
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.state.phase).toBe('close');
    seen.push('close');
    expect(view.emitCheckpoint).toBe(false);
    expect(view.completionDue).toBe(false);
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    view = resolveLessonPhaseTurn(state, baseContext({
      teachingTurns: state.totalTurns,
      studentMessage: '这节课的主线是：三个阶段各有场所，CO₂ 在第二阶段产生，[H] 前两阶段产生第三阶段消耗。',
    }))!;
    expect(view.completionDue).toBe(true);
    expect(view.directive).toContain('学生已经给出总结');
    expect(seen.join('>')).toBe('orient>build1>build2>build3>integrate>transfer>audit>close');
  });

  it('建构阶段学生持续追问：本段最多讲 3 轮就推进，不会卡死', () => {
    let state: LessonPhaseState | null = null;
    let view = resolveLessonPhaseTurn(state, baseContext())!;
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    for (let turn = 1; turn <= 3; turn += 1) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      expect(view.state.phase).toBe('build');
      expect(view.state.segment).toBe(1);
      state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    }
    // 第 4 个回合起进入第 2 段
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.state.phase).toBe('build');
    expect(view.state.segment).toBe(2);
  });

  it('提交轮（反馈轮）仍留在本阶段：通过与否都先反馈、下一回合再推进', () => {
    let state: LessonPhaseState | null = null;
    let view = resolveLessonPhaseTurn(null, baseContext())!;
    state = settle(view, { segmentDone: true });
    for (let segment = 0; segment < 3; segment += 1) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      state = settle(view, { segmentDone: true });
    }
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.state.phase).toBe('integrate');
    state = settle(view, { checkpointEmitted: true, targetKc: view.targetKc });
    // 学生提交：这一轮是反馈轮，阶段不变
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns, isSubmission: true, verdictPassed: true }))!;
    expect(view.state.phase).toBe('integrate');
    state = settle(view, { isSubmission: true, verdictPassed: true });
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.state.phase).toBe('transfer');
  });

  it('建构指令点名本段、要求讲完就停；还没讲到的核心知识点只在最后一段点名', () => {
    const contract = buildLessonContract({
      taskKcs: [{ kcId: 'kc-1', name: '识别柠檬酸循环场所' }, { kcId: 'kc-2', name: '由产物反推场所' }],
    } as any);
    const started = settleLessonPhase(
      resolveLessonPhaseTurn(null, baseContext({ contract }))!.state,
      { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false },
    );
    const view = resolveLessonPhaseTurn(started, baseContext({
      contract,
      teachingTurns: 1,
      taughtText: '这三个阶段分别叫糖酵解、柠檬酸循环、氧化磷酸化。',
    }))!;
    expect(view.state.phase).toBe('build');
    expect(view.directive).toContain('「糖酵解（第一阶段）」');
    expect(view.directive).toContain('讲完就停');
    expect(view.directive).toContain('emitCheckpoint=false');
    // 「柠檬酸循环」已提到；「产物」还没提到
    expect(view.untaughtKcs).toEqual(['由产物反推场所']);
    // 第一段不点名：把全部知识点列成「本段必须带到」会把整课挤进一段
    expect(view.directive).not.toContain('由产物反推场所');

    const lastSegment = resolveLessonPhaseTurn(
      { ...view.state, segment: view.state.segments.length },
      baseContext({
        contract,
        teachingTurns: 1,
        taughtText: '这三个阶段分别叫糖酵解、柠檬酸循环、氧化磷酸化。',
      }),
    )!;
    expect(lastSegment.directive).toContain('这是最后一段。以下核心点整节课还没被提到，本段讲解必须带到：由产物反推场所。');
  });

  it('检查阶段的题目考点 = 尚无独立证据的核心知识点，三个阶段轮转', () => {
    const contract = buildLessonContract({
      taskKcs: [
        { kcId: 'a', name: '识别糖酵解场所' },
        { kcId: 'b', name: '识别柠檬酸循环场所' },
        { kcId: 'c', name: '由产物反推场所' },
      ],
    } as any);
    const segments = segmentsFromKcs(contract.coreKcs.map((kc) => kc.name), '细胞呼吸');
    let state: LessonPhaseState | null = null;
    const targets: Array<string | null> = [];
    const evidence: any[] = [];
    for (let turn = 0; turn < 40 && targets.length < 3; turn += 1) {
      const view = resolveLessonPhaseTurn(state, baseContext({ contract, segments, evidence, teachingTurns: state?.totalTurns ?? 0 }))!;
      const passing = view.state.phase === 'close' ? { segmentDone: false } : { segmentDone: true };
      state = settleLessonPhase(view.state, {
        ...passing,
        checkpointEmitted: view.emitCheckpoint,
        targetKc: view.targetKc,
        isSubmission: false,
        verdictPassed: null,
        checkpointVoided: false,
      });
      if (view.emitCheckpoint) {
        targets.push(view.targetKc);
        // 学生答对：这条证据落账，下一道检查换一个知识点
        const kc = contract.coreKcs.find((item) => item.name === view.targetKc)!;
        evidence.push({ evidenceId: `e:${kc.kcId}`, kcId: kc.kcId, kcName: kc.name, kind: 'checkpoint', source: 'code', firstAttempt: true, attempts: 1, independent: true, correct: true, at: '', turn: 1 });
        const passedView = resolveLessonPhaseTurn(state, baseContext({
          contract, segments, evidence, teachingTurns: state.totalTurns, isSubmission: true, verdictPassed: true,
        }))!;
        state = settleLessonPhase(passedView.state, { segmentDone: false, checkpointEmitted: false, isSubmission: true, verdictPassed: true, checkpointVoided: false });
      }
    }
    expect(targets).toEqual(['识别糖酵解场所', '识别柠檬酸循环场所', '由产物反推场所']);
  });

  it('上一道没过：下一道换一个知识点考，不追打同一个点；都考过了才回到第一个缺口', () => {
    const contract = buildLessonContract({
      taskKcs: [{ kcId: 'a', name: '识别糖酵解场所' }, { kcId: 'b', name: '识别柠檬酸循环场所' }],
    } as any);
    const segments = segmentsFromKcs(contract.coreKcs.map((kc) => kc.name), '细胞呼吸');
    const started = normalizeLessonPhaseState({
      version: 1, phase: 'integrate', phaseTurns: 1, totalTurns: 5, segment: 2, segments,
      checksInPhase: 1, segmentDone: false, targetedKcs: ['识别糖酵解场所'],
    })!;
    const transferView = resolveLessonPhaseTurn(started, baseContext({ contract, segments, teachingTurns: 5 }))!;
    expect(transferView.state.phase).toBe('transfer');
    expect(transferView.targetKc).toBe('识别柠檬酸循环场所');
    const bothTried = normalizeLessonPhaseState({ ...started, phase: 'audit', checksInPhase: 0, phaseTurns: 0, targetedKcs: ['识别糖酵解场所', '识别柠檬酸循环场所'] })!;
    expect(resolveLessonPhaseTurn(bothTried, baseContext({ contract, segments, teachingTurns: 6 }))!.targetKc).toBe('识别糖酵解场所');
  });

  it('检查没通过且不能再答：讲透正确答案，下一轮进入下一阶段（不无限追打）', () => {
    let state: LessonPhaseState | null = null;
    // 快进到整合出题轮
    let view = resolveLessonPhaseTurn(state, baseContext())!;
    state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    for (let segment = 0; segment < 3; segment += 1) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    }
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.emitCheckpoint).toBe(true);
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: true, isSubmission: false, verdictPassed: null, checkpointVoided: false });

    // 第二次作答仍错（次数用完，卡片收走）
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns, isSubmission: true, verdictPassed: false, pendingCheckpoint: false }))!;
    expect(view.state.phase).toBe('integrate');
    expect(view.emitCheckpoint).toBe(false);
    expect(view.directive).toContain('把正确答案和依据讲透');
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: true, verdictPassed: false, checkpointVoided: false });

    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.state.phase).toBe('transfer');
    expect(view.emitCheckpoint).toBe(true);
  });

  it('第一次答错、题还在卡片上：反馈轮只给线索不说答案', () => {
    let state: LessonPhaseState | null = null;
    let view = resolveLessonPhaseTurn(state, baseContext())!;
    state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    for (let segment = 0; segment < 3; segment += 1) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    }
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: true, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns, isSubmission: true, verdictPassed: false, pendingCheckpoint: true }))!;
    expect(view.directive).toContain('只给一条线索');
    expect(view.directive).toContain('不说出答案');
  });

  it('学生质疑题目成立（系统作废）：记为正向证据并推进，不算失败', () => {
    let state: LessonPhaseState | null = null;
    let view = resolveLessonPhaseTurn(state, baseContext())!;
    state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    for (let segment = 0; segment < 3; segment += 1) {
      view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
      state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    }
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: true, isSubmission: false, verdictPassed: null, checkpointVoided: false });

    // 学生说「这题不成立」：有待答题 → 指令要求走五步；模型判定作废
    view = resolveLessonPhaseTurn(state, baseContext({
      teachingTurns: state.totalTurns,
      pendingCheckpoint: true,
      studentMessage: '这题不成立吧？有 CO₂ 就说明第二阶段发生了，第二阶段必产 [H]。',
    }))!;
    expect(view.emitCheckpoint).toBe(false);
    expect(view.directive).toContain('题出错了 / 表述有歧义 / 他推理有误');
    expect(view.directive).toContain('control.voidCheckpoint=true');
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: true });
    expect(state.challengesUpheld).toBe(1);
    view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: state.totalTurns }))!;
    expect(view.state.phase).toBe('transfer');
  });

  it('学生明确要求「直接考」：尊重节奏请求，跳到检查阶段', () => {
    const started = settleLessonPhase(
      resolveLessonPhaseTurn(null, baseContext())!.state,
      { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false },
    );
    expect(detectLearnerSkipRequest('别讲了，直接考我吧')).toBe(true);
    expect(detectLearnerSkipRequest('先讲讲看')).toBe(false);
    const view = resolveLessonPhaseTurn(started, baseContext({ teachingTurns: 1, learnerSkipRequested: true }))!;
    expect(view.state.phase).toBe('integrate');
    expect(view.emitCheckpoint).toBe(true);
    expect(view.revealLevel).toBe(3);
  });

  it('回合上限：上到 30 轮还没走完也强制收束，课不会永远收不了尾', () => {
    const state = normalizeLessonPhaseState({
      version: 1, phase: 'build', phaseTurns: 0, totalTurns: 30, segment: 1, segments: SEGMENTS, checksInPhase: 0, segmentDone: false,
    });
    const view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: 30 }))!;
    expect(view.state.phase).toBe('close');
  });

  it('学生说「今天就到这」：进入收束', () => {
    const started = settleLessonPhase(
      resolveLessonPhaseTurn(null, baseContext())!.state,
      { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false },
    );
    const view = resolveLessonPhaseTurn(started, baseContext({ teachingTurns: 1, endIntent: true }))!;
    expect(view.state.phase).toBe('close');
  });

  it('收束阶段学生一直只回短句：等 3 轮后照常进入终检', () => {
    const state = normalizeLessonPhaseState({
      version: 1, phase: 'close', phaseTurns: 3, totalTurns: 12, segment: 3, segments: SEGMENTS, checksInPhase: 0, segmentDone: false,
    });
    const view = resolveLessonPhaseTurn(state, baseContext({ teachingTurns: 12, studentMessage: '嗯' }))!;
    expect(view.completionDue).toBe(true);
  });
});

describe('lesson-phase：单段小课（compact）与存量课堂', () => {
  it('只有一个核心知识点：点名 → 建构 → 迁移 → 收束（跳过整合与审错）', () => {
    const segments = [{ index: 1, title: '识别糖酵解场所' }];
    let view = resolveLessonPhaseTurn(null, baseContext({ segments }))!;
    expect(view.state.profile).toBe('compact');
    let state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    view = resolveLessonPhaseTurn(state, baseContext({ segments, teachingTurns: 1 }))!;
    expect(view.state.phase).toBe('build');
    state = settleLessonPhase(view.state, { segmentDone: true, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    view = resolveLessonPhaseTurn(state, baseContext({ segments, teachingTurns: 2 }))!;
    expect(view.state.phase).toBe('transfer');
    expect(view.emitCheckpoint).toBe(true);
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: true, isSubmission: false, verdictPassed: null, checkpointVoided: false });
    view = resolveLessonPhaseTurn(state, baseContext({ segments, teachingTurns: 3, isSubmission: true, verdictPassed: true }))!;
    state = settleLessonPhase(view.state, { segmentDone: false, checkpointEmitted: false, isSubmission: true, verdictPassed: true, checkpointVoided: false });
    view = resolveLessonPhaseTurn(state, baseContext({ segments, teachingTurns: 4 }))!;
    expect(view.state.phase).toBe('close');
  });

  it('存量课堂（协议上线前已上过若干轮、没有阶段状态）：返回 null，沿用旧节奏', () => {
    expect(resolveLessonPhaseTurn(null, baseContext({ teachingTurns: 5 }))).toBeNull();
  });

  it('断线续讲（无学生新输入）不推进阶段、不出题', () => {
    const started = settleLessonPhase(
      resolveLessonPhaseTurn(null, baseContext())!.state,
      { segmentDone: false, checkpointEmitted: false, isSubmission: false, verdictPassed: null, checkpointVoided: false },
    );
    const view = resolveLessonPhaseTurn(started, baseContext({ teachingTurns: 1, isResume: true }))!;
    expect(view.state.phase).toBe('orient');
    expect(view.emitCheckpoint).toBe(false);
  });
});

describe('lesson-phase：教学段派生与状态归一', () => {
  it('板书带 rowSegments：按段分组，段名点出本段的所有行', () => {
    const segments = segmentsFromBoard({
      rowLabels: ['第一阶段 糖酵解', '第二阶段 柠檬酸循环', '第三阶段 氧化磷酸化', '总反应', '能量账'],
      rowSegments: [1, 2, 3, 3, 3],
    });
    expect(segments).toEqual([
      { index: 1, title: '第一阶段 糖酵解', rows: [0] },
      { index: 2, title: '第二阶段 柠檬酸循环', rows: [1] },
      { index: 3, title: '第三阶段 氧化磷酸化、总反应、能量账', rows: [2, 3, 4] },
    ]);
    expect(segmentsFromBoard({ rowLabels: ['a', 'b'] })).toEqual([]);
  });

  it('板书没有分段：按核心知识点一段一个；再没有就一段任务标题', () => {
    expect(segmentsFromKcs(['区分三种问法', '把引文归到问题上'], 'x')).toEqual([
      { index: 1, title: '区分三种问法' },
      { index: 2, title: '把引文归到问题上' },
    ]);
    expect(segmentsFromKcs([], '西方哲学史入门')).toEqual([{ index: 1, title: '西方哲学史入门' }]);
  });

  it('normalizeLessonPhaseState：非法/缺段的载荷返回 null；合法载荷可往返', () => {
    expect(normalizeLessonPhaseState(null)).toBeNull();
    expect(normalizeLessonPhaseState({ phase: 'nope' })).toBeNull();
    expect(normalizeLessonPhaseState({ phase: 'build' })).toBeNull();
    expect(isLessonPhase('build')).toBe(true);
    expect(isLessonPhase('teaching')).toBe(false);
    const state = normalizeLessonPhaseState({
      version: 1, phase: 'integrate', phaseTurns: 0, totalTurns: 5, segment: 3, segments: SEGMENTS,
      checksInPhase: 0, segmentDone: false, challengesUpheld: 2,
    })!;
    expect(state.phase).toBe('integrate');
    expect(state.challengesUpheld).toBe(2);
    expect(state.targetedKcs).toEqual([]);
    const summary = lessonPhaseSummary(resolveLessonPhaseTurn(state, baseContext({ teachingTurns: 5 })))!;
    expect(summary!.phase).toBe('integrate');
    expect(summary!.emitCheckpoint).toBe(true);
  });
});

describe('知识点点名检查（知识看板证据的点名门）', () => {
  it('从 KC 名里抽出实义片段', () => {
    expect(kcMentionTokens('识别柠檬酸循环场所')).toContain('柠檬酸循环');
    expect(kcMentionTokens('由产物反推场所')).toEqual(['产物']);
    expect(kcMentionTokens('掌握')).toEqual([]);
  });

  it('实录 caseA：两个从未出现的 KC 不算提到；化学式下标归一后可比对', () => {
    const taught = '三个阶段的场所分别是细胞质基质、线粒体基质、线粒体内膜。[H] 和 O₂ 在第三阶段结合生成水。';
    expect(isKcMentioned('识别柠檬酸循环场所', taught)).toBe(false);
    expect(isKcMentioned('识别氧化磷酸化场所', taught)).toBe(false);
    expect(isKcMentioned('追踪[H]与O₂去向', taught)).toBe(true);
    expect(isKcMentioned('识别糖酵解场所', '糖酵解发生在细胞质基质。')).toBe(true);
    // 判不出实义片段时不拦
    expect(isKcMentioned('掌握', '')).toBe(true);
  });
});
