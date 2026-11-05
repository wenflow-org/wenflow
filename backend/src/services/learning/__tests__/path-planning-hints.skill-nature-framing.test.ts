import { buildFramedNormalizedInput } from '../path-planning-hints';
import { buildPromptFriendlyNormalizedInput } from '../../../skills/path-planning';
import { stripNestedMaterials } from '../../../skills/stage-designer';

/**
 * #242 回归：skillNature / platformJudgment 在定帧层被整键删除。
 *
 * 现象：goal 层已判定这两个键（`goalFinalPayload.visibleSummary` 里确有），但
 * `framed.learnerProfile` 里它们为 undefined、`hasOwnProperty` 为 false，
 * 于是 path-planning 与 stage-designer 的完整载荷里一次都读不到。
 *
 * 根因（同一提交 558d50e4 一次性引入）：producer `path.coordinator.ts:403-430` 写**内层**
 * `learnerProfile.skillNature / platformJudgment`，定帧层却读**顶层** `input.skillNature`
 * ——读不到后由 else 分支 `delete framed.learnerProfile.*` 把刚写好的内层键显式抹掉。
 */

const framedLearnerProfile = (input: Record<string, unknown>) =>
  buildFramedNormalizedInput(input).learnerProfile as Record<string, unknown>;

describe('#242 定帧层：内层 learnerProfile 的 skillNature / platformJudgment 必须透传', () => {
  it('producer 形态（内层）→ 定帧后两个键都在，证据与读数一并保留', () => {
    const out = framedLearnerProfile({
      version: '1.0',
      learnerProfile: {
        surfaceGoal: '想自己弹唱一首完整的歌',
        skillNature: 'physical_internalized',
        skillNatureEvidence: '用户说琴要自己练',
        platformJudgment: 'not_judgeable',
        platformJudgmentEvidence: '平台听不到琴声',
        sensorReadouts: ['心率带'],
      },
    });
    expect(out.skillNature).toBe('physical_internalized');
    expect(out.skillNatureEvidence).toBe('用户说琴要自己练');
    expect(out.platformJudgment).toBe('not_judgeable');
    expect(out.platformJudgmentEvidence).toBe('平台听不到琴声');
    expect(out.sensorReadouts).toEqual(['心率带']);
    expect(Object.prototype.hasOwnProperty.call(out, 'skillNature')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(out, 'platformJudgment')).toBe(true);
  });

  it('二次定帧幂等（生成链会再定帧一次）', () => {
    const once = buildFramedNormalizedInput({
      version: '1.0',
      learnerProfile: { surfaceGoal: 'g', skillNature: 'tool_operation', platformJudgment: 'judgeable_output' },
    });
    const twice = buildFramedNormalizedInput(once);
    expect(twice.learnerProfile.skillNature).toBe('tool_operation');
    expect(twice.learnerProfile.platformJudgment).toBe('judgeable_output');
  });

  it('顶层写法仍然可用（旧快照/外部调用方兼容），内层优先', () => {
    const out = framedLearnerProfile({
      version: '1.0',
      learnerProfile: { surfaceGoal: 'g' },
      skillNature: 'tool_operation',
      platformJudgment: 'judgeable_output',
    });
    expect(out.skillNature).toBe('tool_operation');
    expect(out.platformJudgment).toBe('judgeable_output');

    const both = framedLearnerProfile({
      version: '1.0',
      learnerProfile: { surfaceGoal: 'g', skillNature: 'knowledge_structure' },
      skillNature: 'tool_operation',
    });
    expect(both.skillNature).toBe('knowledge_structure');
  });

  it('goal 未判定（字段缺失 / not_judgeable 之外的空值）→ 不凭空补值，键不出现', () => {
    const out = framedLearnerProfile({ version: '1.0', learnerProfile: { surfaceGoal: 'g' } });
    expect(out.skillNature).toBeUndefined();
    expect(out.platformJudgment).toBeUndefined();
    expect(out.sensorReadouts).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, 'skillNature')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'platformJudgment')).toBe(false);
  });

  it('脏值 → 按缺失处理（不猜测、不落默认档）', () => {
    const out = framedLearnerProfile({
      version: '1.0',
      learnerProfile: { surfaceGoal: 'g', skillNature: 'physical', platformJudgment: 'judgeable' },
    });
    expect(out.skillNature).toBeUndefined();
    expect(out.platformJudgment).toBeUndefined();
  });
});

describe('#242 下游载荷：path-planning 提示词投影也必须带出这两个键', () => {
  const base = {
    version: '1.0',
    learnerProfile: {
      surfaceGoal: 'g',
      skillNature: 'cognitive_internalized',
      platformJudgment: 'judgeable_output',
    },
    problemSpace: {},
    resources: {},
    successCriteria: {},
    confirmedProposal: null,
    planningHints: null,
  };

  it('投影后 learnerProfile 内仍能读到两个键（否则提示词里是死引用）', () => {
    const built = buildPromptFriendlyNormalizedInput(base);
    const lp = built.normalizedInput.learnerProfile as Record<string, unknown>;
    expect(lp.skillNature).toBe('cognitive_internalized');
    expect(lp.platformJudgment).toBe('judgeable_output');
  });

  it('无值时不出现该键（冷启动行为不变）', () => {
    const built = buildPromptFriendlyNormalizedInput({
      ...base,
      learnerProfile: { surfaceGoal: 'g' },
    });
    const lp = built.normalizedInput.learnerProfile as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(lp, 'skillNature')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(lp, 'platformJudgment')).toBe(false);
  });
});

describe('#242 端到端：stage-designer 的载荷装配（stripNestedMaterials）后仍读得到', () => {
  it('定帧输出 → stage-designer 载荷 → learnerProfile.platformJudgment 可见', () => {
    const framed = buildFramedNormalizedInput({
      version: '1.0',
      learnerProfile: {
        surfaceGoal: '想自己弹唱一首完整的歌',
        skillNature: 'physical_internalized',
        platformJudgment: 'not_judgeable',
        sensorReadouts: ['心率带'],
      },
      resources: { materials: [{ title: 'a' }] },
    });
    // stage-designer 的 buildUserPayload 走 stripNestedMaterials(payload.normalizedInput)
    const delivered = stripNestedMaterials(framed);
    expect(delivered.learnerProfile.skillNature).toBe('physical_internalized');
    expect(delivered.learnerProfile.platformJudgment).toBe('not_judgeable');
    expect(delivered.learnerProfile.sensorReadouts).toEqual(['心率带']);
    expect(delivered.resources.materials).toBeUndefined(); // 嵌套资料仍按原规则剥离
  });
});
