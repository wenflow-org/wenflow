import {
  decideControlledError,
  isControlledErrorEnabled,
  CONTROLLED_ERROR_TABLE,
} from '../schemas';

/**
 * 受控错误注入（XIAOCHEN-REVIEW-20261002 P1-3）：
 * 判决概率此前交给 LLM 自由把握 ⇒ 19 连对零失手。修法 = 概率采样移到编排层（与 friction 同范式）。
 */
describe('decideControlledError（编排层受控错误采样）', () => {
  const STRUGGLE = ['概率图模型', '推导细节'];

  it('开关关闭时恒不注入', () => {
    const result = decideControlledError({
      frictionBudget: 'stress_test',
      struggleConcepts: STRUGGLE,
      turnIndex: 10,
      enabled: false,
      random: () => 0,
    });
    expect(result.forced).toBe(false);
  });

  it('env 开关：默认开，0/false/off 关', () => {
    expect(isControlledErrorEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isControlledErrorEnabled({ VIRTUAL_CONTROLLED_ERROR_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isControlledErrorEnabled({ VIRTUAL_CONTROLLED_ERROR_ENABLED: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('开课头两轮不注入（冷启动保持合作）', () => {
    for (const turnIndex of [0, 1]) {
      const result = decideControlledError({
        frictionBudget: 'stress_test',
        struggleConcepts: STRUGGLE,
        turnIndex,
        random: () => 0, // 必命中
      });
      expect(result.forced).toBe(false);
    }
  });

  it('随机数低于概率时注入且带 struggle 概念；高于概率时不注入', () => {
    // normal 档基准 0.12 × struggleBoost 2 = 0.24
    const forced = decideControlledError({
      frictionBudget: 'normal',
      struggleConcepts: STRUGGLE,
      turnIndex: 5,
      random: () => 0.1,
    });
    expect(forced.forced).toBe(true);
    expect(forced.targetConcept).toBe(STRUGGLE[5 % STRUGGLE.length]);
    expect(forced.hint).toContain('必须服从');

    const skipped = decideControlledError({
      frictionBudget: 'normal',
      struggleConcepts: STRUGGLE,
      turnIndex: 5,
      random: () => 0.5,
    });
    expect(skipped.forced).toBe(false);
  });

  it('none 档恒不注入', () => {
    const result = decideControlledError({
      frictionBudget: 'none',
      struggleConcepts: STRUGGLE,
      turnIndex: 10,
      random: () => 0,
    });
    expect(result.forced).toBe(false);
  });

  it('无 struggleConcepts 时仍可注入（targetConcept 为空、概率不打折）', () => {
    const forced = decideControlledError({
      frictionBudget: 'normal',
      struggleConcepts: [],
      turnIndex: 3,
      random: () => 0.05, // 0.05 < 0.12（无加权）
    });
    expect(forced.forced).toBe(true);
    expect(forced.targetConcept).toBeNull();
  });

  it('概率上限 0.6（stress_test + struggle 加权不超顶）', () => {
    // stress_test 0.25 × 3 = 0.75 → 钳到 0.6：0.65 不得命中
    const result = decideControlledError({
      frictionBudget: 'stress_test',
      struggleConcepts: STRUGGLE,
      turnIndex: 3,
      random: () => 0.65,
    });
    expect(result.forced).toBe(false);
    expect(CONTROLLED_ERROR_TABLE.stress_test.wrongProbability * CONTROLLED_ERROR_TABLE.stress_test.struggleBoost).toBeGreaterThan(0.6);
  });

  it('struggleConcepts 轮转取用（不同轮次换概念）', () => {
    const pick = (turnIndex: number) => decideControlledError({
      frictionBudget: 'normal',
      struggleConcepts: STRUGGLE,
      turnIndex,
      random: () => 0,
    }).targetConcept;
    expect(pick(2)).toBe(STRUGGLE[0]);
    expect(pick(3)).toBe(STRUGGLE[1]);
    expect(pick(4)).toBe(STRUGGLE[0]);
  });
});
