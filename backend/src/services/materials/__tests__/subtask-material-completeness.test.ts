/**
 * 任务材料自足性（2026-11-02 真实课堂实测）
 *
 * 现场：路径 lp_1793609520322_a52ld7g 首课标题「在 6 个句子上指认时间标志词与动作性质」、
 * 描述「给你 6 个句子（含 already、since 2020、yesterday…）」，但 6 个句子从未写出来——
 * 只有 6 个特征词。下游课堂拿不到句子，白板退化成 6×3 空壳矩阵（18 格全 hit、零文本）。
 *
 * 本测试钉住判据的**高精度**：只抓"承诺了 ≥2 份具体材料却既无本体、也无合法来源"，
 * 不能误伤「学习者手头已有」「前序产出」这两种规则 108 允许的写法。
 */
import {
  assessStageMaterialCompleteness,
  assessStageMaterialCompletenessByModel,
  assessSubtaskMaterialCompleteness,
  collectSubtaskMaterialFacts,
} from '../subtask-material-completeness';

const mockRecordDegradation = jest.fn();

// 语义判定失败时的遥测：mock 掉，避免落库、并可直接断言
jest.mock('../../../skills/degradation-telemetry', () => ({
  recordDegradation: (...args: unknown[]) => mockRecordDegradation(...args),
  degradationCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

describe('assessSubtaskMaterialCompleteness：只给特征词 = 材料本体缺失', () => {
  it('实测反例：6 个句子只列了 already / yesterday 这类词 → 判缺失', () => {
    const result = assessSubtaskMaterialCompleteness({
      title: '在 6 个句子上指认时间标志词与动作性质，建立两步判别的第一直觉',
      description:
        '给你 6 个句子（含 already、since 2020、yesterday、last week、now、for three years 等标志词，动作分别是一次性发生、持续、已完成），逐句只做两件事：圈出时间标志词，用一句话写出这个动作是「持续 / 已完成 / 一次性发生」中的哪一种。先不选答案，只练「先看信号再定形式」这个动作顺序。',
      acceptanceHint: '6 个句子都能指出标志词并写出动作性质',
    });
    expect(result.promisesMaterial).toBe(true);
    expect(result.promisedCount).toBe(6);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain('6 份具体材料');
  });

  it('同一任务把 6 句本体编号写出 → 通过', () => {
    const result = assessSubtaskMaterialCompleteness({
      title: '在 6 个句子上指认时间标志词与动作性质',
      description: [
        '给你 6 个句子，逐句圈出时间标志词，并写出动作是持续/已完成/一次性：',
        '1. She has already finished her homework.',
        '2. I have lived here since 2020.',
        '3. He left yesterday.',
        '4. We met last week.',
        '5. They are playing now.',
        '6. She has studied English for three years.',
      ].join('\n'),
    });
    expect(result.satisfied).toBe(true);
  });

  it('题面用引号逐条给出（≥2 处原文）也算有本体', () => {
    const result = assessSubtaskMaterialCompleteness({
      title: '在 4 道题上判时态',
      description: '给出 4 道题：「I ___ to Beijing last year.」「She ___ here since 2019.」，逐题说出选型理由。',
    });
    expect(result.satisfied).toBe(true);
  });

  it('规则 108 允许：材料来自学习者手头 → 不算悬空', () => {
    const result = assessSubtaskMaterialCompleteness({
      title: '在 6 个句子上圈标志词',
      description: '拿你手头那份 6 个句子（上次课你自己抄的），逐句圈时间标志词。',
    });
    expect(result.satisfied).toBe(true);
  });

  it('规则 108 允许：材料来自前序任务产出 → 不算悬空', () => {
    const result = assessSubtaskMaterialCompleteness({
      title: '在 6 个句子上圈标志词',
      description: '用任务 2 产出的 6 个句子，逐句圈时间标志词。',
    });
    expect(result.satisfied).toBe(true);
  });

  it('已核对通过的 materialRefs 也算有来源', () => {
    const result = assessSubtaskMaterialCompleteness({
      title: '在 6 个句子上圈标志词',
      description: '给你 6 个句子（见资料「时态练习 1」），逐句圈时间标志词。',
      materialRefs: [{ sectionId: 's-3', quote: '时态练习 1' }],
    });
    expect(result.satisfied).toBe(true);
  });

  it('不承诺材料的任务不判（避免误伤）', () => {
    expect(assessSubtaskMaterialCompleteness({
      title: '比较两种中断策略的适用场景',
      description: '结合你上周的实际记录，比较两种策略。',
    }).promisesMaterial).toBe(false);
    // 「3 个阶段」「2 个要点」不是材料
    expect(assessSubtaskMaterialCompleteness({
      title: '搭建判别框架',
      description: '分 3 个阶段推进，先写 2 个要点。',
    }).promisesMaterial).toBe(false);
  });

  it('只承诺 1 份材料不判（「给你 1 个句子」不构成一批材料）', () => {
    expect(assessSubtaskMaterialCompleteness({
      title: '拆一个长句',
      description: '给你 1 个句子，拆出主谓宾。',
    }).promisesMaterial).toBe(false);
  });
});

describe('assessStageMaterialCompleteness：阶段级汇总', () => {
  it('多个任务各自报出带任务名的违规说明', () => {
    const result = assessStageMaterialCompleteness([
      { title: '识别标志词', description: '给你 6 个句子（含 already、yesterday），逐句圈词。' },
      { title: '正常任务', description: '比较两种策略的适用场景。' },
      { title: '做 10 道题', description: '给你 10 道题，逐题说出排除理由。' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('MATERIAL_BODY_MISSING_STAGE');
    expect(result.violations).toHaveLength(2);
    expect(result.violations?.[0]).toContain('任务 1「识别标志词」');
    expect(result.violations?.[1]).toContain('任务 3「做 10 道题」');
  });

  it('全部自足时通过', () => {
    expect(assessStageMaterialCompleteness([
      { title: '比较两种策略', description: '结合你的记录比较。' },
    ]).valid).toBe(true);
  });
});

describe('assessStageMaterialCompletenessByModel：语义判断交给模型（mock 模型返回值）', () => {
  const judgeReturning = (content: string) => jest.fn(async () => content);

  it('模型判缺失 → valid=false，violations 原样可进纠错提示', async () => {
    const result = await assessStageMaterialCompletenessByModel(
      [{ title: '拆解争议事件', description: '把三件 AI 教育事件各写一句「它到底在替课堂做哪件事」' }],
      {
        callModel: judgeReturning(JSON.stringify({
          valid: false,
          violations: ['任务 1「拆解争议事件」：承诺了「三件 AI 教育事件」，却没给出这三件事件是什么'],
        })),
      },
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('MATERIAL_BODY_MISSING_STAGE');
    expect(result.violations).toEqual([
      '任务 1「拆解争议事件」：承诺了「三件 AI 教育事件」，却没给出这三件事件是什么',
    ]);
  });

  it('模型判通过（含 ```json 代码围栏）→ valid=true', async () => {
    const result = await assessStageMaterialCompletenessByModel(
      [{ title: '判断边界', description: '区分合规与不合规行为' }],
      { callModel: judgeReturning('```json\n{"valid":true,"violations":[]}\n```') },
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toBeUndefined();
  });

  it('valid=false 但没列 violations → 按通过处理（无可操作细节，不触发无意义重试）', async () => {
    const result = await assessStageMaterialCompletenessByModel(
      [{ title: 'x', description: 'y' }],
      { callModel: judgeReturning('{"valid":false}') },
    );
    expect(result.valid).toBe(true);
  });

  it('模型调用报错 → 不阻塞（valid=true）并记一条降级遥测', async () => {
    mockRecordDegradation.mockClear();
    const result = await assessStageMaterialCompletenessByModel(
      [{ title: 'x', description: 'y' }],
      { callModel: jest.fn(async () => { throw new Error('upstream 500'); }) },
    );
    expect(result.valid).toBe(true);
    expect(mockRecordDegradation).toHaveBeenCalledTimes(1);
    expect(mockRecordDegradation.mock.calls[0][0]).toMatchObject({
      source: 'materials/subtask-material-completeness',
      mitigationApplied: 'continue-without-material-semantic-gate',
    });
  });

  it('模型返回非 JSON → 不阻塞（valid=true）并记 PARSE_FAILED', async () => {
    mockRecordDegradation.mockClear();
    const result = await assessStageMaterialCompletenessByModel(
      [{ title: 'x', description: 'y' }],
      { callModel: judgeReturning('抱歉，这条我判断不了。') },
    );
    expect(result.valid).toBe(true);
    expect(mockRecordDegradation.mock.calls[0][0]).toMatchObject({ faultCategory: 'PARSE_FAILED' });
  });

  it('结构性事实随任务透传（materialRefs / 编号列表 / 序号）', () => {
    const facts = collectSubtaskMaterialFacts([
      { title: 't', description: '1. a\n2. b', materialRefs: [{ quote: 'x' }] },
    ]);
    expect(facts[0].index).toBe(1);
    expect(facts[0].hasMaterialRefs).toBe(true);
    expect(facts[0].numberedListLines).toBeGreaterThanOrEqual(2);
  });
});