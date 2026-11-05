/**
 * #242 回归：`skillNature` / `platformJudgment` 在 goal→path 定帧层不再被整键删除。
 *
 * 病灶（同一提交 558d50e4 引入）：producer `path.coordinator.ts:398-430` 写**内层**
 * `learnerProfile.skillNature / platformJudgment`，而定帧层只读**顶层** `input.skillNature`，
 * 读不到后由 else 分支 `delete framed.learnerProfile.*` 把刚写好的键显式抹掉；
 * 下游 `skills/path-planning` 的逐字段白名单投影又再裁一次 ⇒ path-planning 载荷里一次都看不到。
 *
 * 本测试锁住"path-planning 侧"这两处：用 producer 形状的入参跑真实定帧 + 真实投影。
 * 并显式断言**没修过头**：纯感官/肢体内化目标仍被 referral 硬阻断，不因键能透传而放行。
 */
import { buildFramedNormalizedInput } from '../path-planning-hints';
import { buildPromptFriendlyNormalizedInput } from '../../../skills/path-planning';
import { triageGoalResponse, isHardBlockResponseTriage } from '../response-triage';

const has = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key);

const producerShapedInput = {
  version: '1.0',
  learnerProfile: {
    surfaceGoal: '想自己弹唱一首完整的歌',
    currentBaseline: { level: 'beginner' as const, evidence: null },
    motivation: null,
    urgency: null,
    backgroundExperience: null,
    painPoints: [] as string[],
    learningSignal: null,
    goalOrientation: null,
    constraintsAndBoundaries: [] as string[],
    // producer 写的是内层（path.coordinator.ts:403-430）
    skillNature: 'physical_internalized',
    skillNatureEvidence: '用户说琴要自己练',
    platformJudgment: 'not_judgeable',
    platformJudgmentEvidence: '平台听不到琴声',
    sensorReadouts: ['心率带'],
  },
  problemSpace: { realProblem: null, scenario: '在家练琴', currentPainPoint: null },
  resources: { timeBudget: '每周 5 小时' },
  successCriteria: { observableResult: '自弹自唱一首完整的歌', acceptanceCheck: '录音回放' },
  confirmedProposal: null,
};

describe('#242 path-planning 侧：定帧层必须透传内层 skillNature / platformJudgment', () => {
  it('producer 形态入参 → framed.learnerProfile 里两个键都在（且 hasOwnProperty 为真）', () => {
    const framed = buildFramedNormalizedInput(producerShapedInput);
    const lp = framed.learnerProfile as Record<string, unknown>;
    expect(lp.skillNature).toBe('physical_internalized');
    expect(lp.skillNatureEvidence).toBe('用户说琴要自己练');
    expect(lp.platformJudgment).toBe('not_judgeable');
    expect(lp.platformJudgmentEvidence).toBe('平台听不到琴声');
    expect(lp.sensorReadouts).toEqual(['心率带']);
    expect(has(lp, 'skillNature')).toBe(true);
    expect(has(lp, 'platformJudgment')).toBe(true);
  });

  it('定帧输出 → path-planning 提示词投影后仍读得到（否则提示词是死引用）', () => {
    const framed = buildFramedNormalizedInput(producerShapedInput);
    const built = buildPromptFriendlyNormalizedInput(framed);
    const lp = built.normalizedInput.learnerProfile as Record<string, unknown>;
    expect(lp.skillNature).toBe('physical_internalized');
    expect(lp.platformJudgment).toBe('not_judgeable');
    expect(has(lp, 'skillNature')).toBe(true);
    expect(has(lp, 'platformJudgment')).toBe(true);
  });
});

describe('#242 没修过头：纯感官/肢体内化目标仍被 referral 硬阻断', () => {
  it('not_judgeable × physical_internalized → 分诊仍判 referral（不因键能透传就开学习路径）', () => {
    const t = triageGoalResponse({
      primary_block_type: 'capability',
      real_problem: '想自己弹唱一首完整的歌',
      surface_goal: '想自己弹唱一首完整的歌',
      platform_judgment: 'not_judgeable',
      skill_nature: 'physical_internalized',
    });
    expect(t.mode).toBe('referral');
    // 硬阻断出口仍然生效：即使旧数据把结论写成 learning_path 也必须拦下
    expect(isHardBlockResponseTriage(t, producerShapedInput.learnerProfile)).toBe(true);
    expect(isHardBlockResponseTriage(
      { mode: 'learning_path', confidence: 'high', reasons: [] },
      producerShapedInput.learnerProfile,
    )).toBe(true);
  });

  it('技能分类漂移（写成 cognitive_internalized）但文本是纯感官 → 仍 referral', () => {
    const t = triageGoalResponse({
      primary_block_type: 'capability',
      surface_goal: '用四周时间学会喝一口手冲咖啡就分辨烘焙焦苦还是萃取过度',
      platform_judgment: 'not_judgeable',
      skill_nature: 'cognitive_internalized',
    });
    expect(t.mode).toBe('referral');
  });

  it('goal 未判定这两个键时不凭空补值（不制造"可判定"假象）', () => {
    const framed = buildFramedNormalizedInput({
      version: '1.0',
      learnerProfile: { surfaceGoal: '理解一个抽象数学定理的证明结构' },
    });
    const lp = framed.learnerProfile as Record<string, unknown>;
    expect(lp.skillNature).toBeUndefined();
    expect(lp.platformJudgment).toBeUndefined();
    expect(has(lp, 'skillNature')).toBe(false);
    expect(has(lp, 'platformJudgment')).toBe(false);
  });
});
