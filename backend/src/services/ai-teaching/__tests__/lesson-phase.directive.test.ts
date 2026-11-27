/**
 * 阶段指令跟着「学生屏幕上真实有什么」走（2026-11-26）。
 *
 *  - 板书三种形态（可分段 / 整块 / 没画出来）在点名与建构阶段的话术不同：没板不许让老师「指板」，
 *    整块板不许说「这一行刚露出」；
 *  - 「还没讲到的核心点」只在最后一段点名（第一段就列全部知识点会把整课挤进一段）；
 *  - 出题点名的知识点优先取讲过的；点到没讲过的，指令里必须先补讲再出题（Meno 闸）。
 */
import {
  resolveLessonPhaseTurn,
  segmentsFromBoard,
  type LessonPhaseState,
  type LessonPhaseTurnContext,
} from '../lesson-phase';

const SEGMENTS = [
  { index: 1, title: '第一阶段 糖酵解', rows: [0] },
  { index: 2, title: '第二阶段 柠檬酸循环', rows: [1] },
  { index: 3, title: '第三阶段 氧化磷酸化', rows: [2] },
];

const CONTRACT = {
  coreKcs: [
    { kcId: 'kc-1', name: '糖酵解的场所' },
    { kcId: 'kc-2', name: '二氧化碳的生成阶段' },
    { kcId: 'kc-3', name: '氧气的消耗阶段' },
  ],
  // 其余字段按契约类型补齐为空值即可（本文件只关心点名与指令）
  acceptanceCriteria: [],
  evidence: [],
} as unknown as LessonPhaseTurnContext['contract'];

const baseCtx = (overrides: Partial<LessonPhaseTurnContext> = {}): LessonPhaseTurnContext => ({
  teachingTurns: 0,
  isResume: false,
  isSubmission: false,
  verdictPassed: null,
  pendingCheckpoint: false,
  endIntent: false,
  learnerSkipRequested: false,
  studentMessage: '开始吧',
  contract: CONTRACT,
  evidence: [],
  segments: SEGMENTS,
  exploratory: false,
  taughtText: '',
  acceptanceCriteria: null,
  board: { segmentCount: 3 },
  ...overrides,
});

/** 走到某一阶段的持久化状态（跳过真实推进，直接给出阶段机认得的形态） */
const stateIn = (phase: LessonPhaseState['phase'], patch: Partial<LessonPhaseState> = {}): LessonPhaseState => ({
  version: 1,
  profile: 'full',
  exploratory: false,
  phase,
  phaseTurns: 0,
  totalTurns: 5,
  segment: 1,
  segments: SEGMENTS,
  checksInPhase: 0,
  phasePassed: false,
  segmentDone: false,
  passedPhases: [],
  challengesUpheld: 0,
  targetedKcs: [],
  ...patch,
});

describe('lesson-phase 指令：板书形态', () => {
  it('可分段的板：点名阶段只有行列名骨架 → 对着行列名点名，预测题照常', () => {
    const view = resolveLessonPhaseTurn(null, baseCtx({ board: { segmentCount: 3 } }))!;
    expect(view.boardReveal).toBe('skeleton');
    expect(view.directive).toContain('只有行列名的空骨架');
    expect(view.directive).toContain('「第一阶段 糖酵解」「第二阶段 柠檬酸循环」「第三阶段 氧化磷酸化」');
    expect(view.directive).not.toContain('不要提「板');
  });

  it('整块板（不能分段）：开课即全图 → 指认名字与位置，预测题只问板上读不出来的关系', () => {
    const view = resolveLessonPhaseTurn(null, baseCtx({ board: { segmentCount: 0 } }))!;
    expect(view.boardReveal).toBe('whole');
    expect(view.directive).toContain('板上已是全图');
    expect(view.directive).toContain('不要问板上已经写明的事实');
  });

  it('没画出来板：点名阶段不得让老师提「板」；建构阶段同理', () => {
    const orient = resolveLessonPhaseTurn(null, baseCtx({ board: null }))!;
    expect(orient.boardReveal).toBe('none');
    expect(orient.directive).toContain('本课没有板书：不要提「板/图/看上面」');

    const build = resolveLessonPhaseTurn(stateIn('build'), baseCtx({ board: null }))!;
    expect(build.directive).toContain('本课没有板书：不要提「板/图/看上面」');
    expect(build.directive).not.toContain('按行分段');
  });

  it('建构阶段：露到第 2 段是 partial；最后一段是 full（段数按板自己的分段算）', () => {
    expect(resolveLessonPhaseTurn(stateIn('build', { segment: 1 }), baseCtx())!.boardReveal).toBe('partial');
    expect(resolveLessonPhaseTurn(stateIn('build', { segment: 2 }), baseCtx())!.boardReveal).toBe('partial');
    expect(resolveLessonPhaseTurn(stateIn('build', { segment: 3 }), baseCtx())!.boardReveal).toBe('full');
    // 板只分 2 段而教学段有 3 段：讲第 2 段时板已经全露
    expect(resolveLessonPhaseTurn(stateIn('build', { segment: 2 }), baseCtx({ board: { segmentCount: 2 } }))!.boardReveal).toBe('full');
  });
});

describe('lesson-phase 指令：「还没讲到的核心点」只在最后一段点名', () => {
  it('第一段：即使全部知识点都没讲到，也不列「必须带到」', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', { segment: 1 }), baseCtx({ taughtText: '' }))!;
    expect(view.untaughtKcs).toEqual(['糖酵解的场所', '二氧化碳的生成阶段', '氧气的消耗阶段']);
    expect(view.directive).not.toContain('还没被提到');
  });

  it('最后一段：还没讲到的核心点在指令里点名', () => {
    const view = resolveLessonPhaseTurn(
      stateIn('build', { segment: 3 }),
      baseCtx({ taughtText: '糖酵解在细胞质基质；二氧化碳在第二阶段生成。' }),
    )!;
    expect(view.untaughtKcs).toEqual(['氧气的消耗阶段']);
    expect(view.directive).toContain('这是最后一段。以下核心点整节课还没被提到，本段讲解必须带到：氧气的消耗阶段。');
  });
});

describe('lesson-phase 出题点名：优先讲过的知识点；没讲过的先补讲', () => {
  const readyToIntegrate = stateIn('integrate');

  it('同样没考过的缺口里，讲到过的优先', () => {
    const view = resolveLessonPhaseTurn(readyToIntegrate, baseCtx({
      taughtText: '二氧化碳在第二阶段生成；氧气在第三阶段被消耗。',
    }))!;
    expect(view.emitCheckpoint).toBe(true);
    expect(view.targetKc).toBe('二氧化碳的生成阶段');
  });

  it('点到整节课没讲过的知识点 → 指令要求先讲清再出题', () => {
    const view = resolveLessonPhaseTurn(readyToIntegrate, baseCtx({
      taughtText: '二氧化碳在第二阶段生成；氧气在第三阶段被消耗。',
      segments: SEGMENTS,
    }))!;
    // 前两个缺口讲到过，先被前两道题考掉；第三道（审错）只剩没讲过的「糖酵解的场所」
    expect(view.targetKc).toBe('二氧化碳的生成阶段');
    expect(view.directive).not.toContain('这节课还没讲到');

    const auditView = resolveLessonPhaseTurn(
      stateIn('audit', { segment: 3, targetedKcs: ['二氧化碳的生成阶段', '氧气的消耗阶段'] }),
      baseCtx({ taughtText: '二氧化碳在第二阶段生成；氧气在第三阶段被消耗。' }),
    )!;
    expect(auditView.checkKind).toBe('audit');
    expect(auditView.targetKc).toBe('糖酵解的场所');
    expect(auditView.directive).toContain('「糖酵解的场所」这节课还没讲到。出题前先用一两句话把这个点讲清');
  });
});

/**
 * 2026-11-26 真课实录（Case B3）：建构三段里模型连着三次问「你用自己的话说一遍：X 这一行
 * 在回答什么问题」——同一动作逐行过堂，学生只是在换台词重复同一件事。
 * 每段收尾的学生动作必须按段轮转（预测 → 复述 → 换例判断），最后一段固定为换例判断。
 */
describe('lesson-phase 指令：建构段收尾动作按段轮转', () => {
  it('第 1 段：预测下一段（带候选），不是复述', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', { segment: 1 }), baseCtx())!;
    expect(view.directive).toContain('猜下一段「第二阶段 柠檬酸循环」会怎样');
    expect(view.directive).not.toContain('压成一句');
  });

  it('第 2 段：压成一句复述，不是再预测', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', { segment: 2 }), baseCtx())!;
    expect(view.directive).toContain('压成一句（限一句，不超过 30 字）');
    expect(view.directive).not.toContain('猜下一段');
  });

  it('第 3 段（非末段）：换对象/条件的小例子做判断', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', {
      segment: 3,
      segments: [...SEGMENTS, { index: 4, title: '第四段 收束', rows: [2] }],
    }), baseCtx({ board: { segmentCount: 4 } }))!;
    expect(view.directive).toContain('换了对象或条件的小例子');
    expect(view.directive).not.toContain('猜下一段');
  });

  it('最后一段：固定为换例判断，不再要求预测/复述', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', {
      segment: 4,
      segments: [...SEGMENTS, { index: 4, title: '第四段 收束', rows: [2] }],
    }), baseCtx({ board: { segmentCount: 4 } }))!;
    expect(view.directive).toContain('给一个本课材料里换个对象或条件的小例子');
    expect(view.directive).not.toContain('猜下一段');
  });
});

/**
 * 2026-11-26 独立外审（两节真课实录）落地的三条口径：
 *  - 整合题答案键不能全是名词标签（学生只写「构成，含义」就判对，因果论证没发生）；
 *  - 探索型整合不做「从 A 到 B 一路演变」的进步叙事（会把「各自问什么」讲成哲学史串讲）；
 *  - 收束时还有题没答，必须直接给答案，不能留一句「下次接着练」就下课。
 */
describe('lesson-phase 指令：外审落地的三条口径', () => {
  it('整合题：答案键必须含关系/因果词，不能全是名词', () => {
    const view = resolveLessonPhaseTurn(stateIn('integrate'), baseCtx())!;
    expect(view.emitCheckpoint).toBe(true);
    expect(view.directive).toContain('至少有一组必须是关系或因果词');
    expect(view.directive).toContain('不能全是名词标签');
  });

  it('探索型整合：禁止「从 A 到 B 一路变/进步」的进步叙事', () => {
    const view = resolveLessonPhaseTurn(stateIn('integrate', { exploratory: true }), baseCtx({ exploratory: true }))!;
    expect(view.directive).toContain('不要用「从 A 到 B 一路变/进步」的叙事');
  });

  it('建构段：正文口径必须与板上那格一致，机制不得自创', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', { segment: 2 }), baseCtx())!;
    expect(view.directive).toContain('与你写进板上那一格的文字一致');
    // 2026-11-26 学科外审：板对、讲解自创「水接住碳和氢」——机制只能拿板上已露出的项与材料原文衔接
    expect(view.directive).toContain('不得为了讲得通俗自创比喻性机制');
  });

  it('收束时有待答检查点 → 直接给答案；没有则不提', () => {
    const withPending = resolveLessonPhaseTurn(stateIn('close'), baseCtx({ pendingCheckpoint: true }))!;
    expect(withPending.directive).toContain('直接给出正确答案与依据');
    expect(withPending.directive).toContain('不要求他再答');

    const clean = resolveLessonPhaseTurn(stateIn('close'), baseCtx({ pendingCheckpoint: false }))!;
    expect(clean.directive).not.toContain('直接给出正确答案与依据');
  });
});

describe('lesson-phase 指令：学生要下课时不再要总结', () => {
  it('结束意图 + 悬题：先给答案，再收，不要他复述', () => {
    const view = resolveLessonPhaseTurn(stateIn('close'), baseCtx({ endIntent: true, pendingCheckpoint: true }))!;
    expect(view.directive).toContain('学生要下课了');
    expect(view.directive).toContain('不要求他再答');
    expect(view.directive).toContain('不要再要求他做总结、答题或补一句复述');
    expect(view.directive).not.toContain('让学生自己收');
  });

  it('结束意图 + 无悬题：只留判据与下一步', () => {
    const view = resolveLessonPhaseTurn(stateIn('close'), baseCtx({ endIntent: true, pendingCheckpoint: false }))!;
    expect(view.directive).toContain('干净收束');
    expect(view.directive).not.toContain('学生要下课了');
  });
});

describe('lesson-phase 指令：一段盖多行时不留行', () => {
  // 2026-11-26 B7 实录：板书 5 行折成 4 段，段 1 盖「泰勒斯」「赫拉克利特」两行，
  // 标题只写第一行 → 老师讲完第一行就跳到下一段的柏拉图，第二行整段没人讲。
  const twoRowsPerSegment = [
    { index: 1, title: '泰勒斯、赫拉克利特', rows: [0, 1] },
    { index: 2, title: '柏拉图', rows: [2] },
  ];

  it('段标题把本段的行都点出来（不只第一行）', () => {
    const segments = segmentsFromBoard({
      rowLabels: ['① 泰勒斯', '② 赫拉克利特', '③ 柏拉图'],
      rowSegments: [1, 1, 2],
    });
    expect(segments.map((segment) => segment.title)).toEqual(['① 泰勒斯、② 赫拉克利特', '③ 柏拉图']);
    expect(segments.map((segment) => segment.rows)).toEqual([[0, 1], [2]]);
  });

  it('建构指令明说本段有几行、要逐行讲到、不许跳行', () => {
    const state = stateIn('build', { segment: 1, segments: twoRowsPerSegment });
    const view = resolveLessonPhaseTurn(state, baseCtx({ segments: twoRowsPerSegment, board: { segmentCount: 2 } }))!;
    expect(view.directive).toContain('本段板书上有 2 行');
    expect(view.directive).toContain('不要只讲第一行就跳到下一段');
  });

  it('一行一段时不加多行提示', () => {
    const view = resolveLessonPhaseTurn(stateIn('build', { segment: 2 }), baseCtx())!;
    expect(view.directive).not.toContain('本段板书上有');
  });
});
