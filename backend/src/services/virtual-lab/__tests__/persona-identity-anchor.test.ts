import { anchorPersonaIdentity } from '../persona-identity-anchor';

describe('anchorPersonaIdentity（拟真人设身份锚定）', () => {
  it('模型换掉身份时用 seed 锚回，保留行为字段', () => {
    const generated = {
      nameHint: '陈默·社区网格员',
      age: 27,
      occupation: '社区网格员',
      background: '在老旧小区做网格巡查，每天处理邻里纠纷和独居老人探访。',
      emotionalTriggers: ['被居民质疑不作为'],
      failurePatterns: ['遇到冲突先回避'],
      availableTime: 'moderate',
      cognitiveLoadTolerance: 'normal',
    };
    const seed = {
      nameHint: '李雯·劳动合同',
      age: 28,
      role: '28岁产品经理，工作3年，正在跳槽',
      background: '前同事离职后被原公司按竞业协议索赔',
    };

    const { personaSeed, drift } = anchorPersonaIdentity(generated, seed);

    expect(personaSeed.nameHint).toBe('李雯·劳动合同');
    expect(personaSeed.occupation).toBe('28岁产品经理，工作3年，正在跳槽');
    expect(personaSeed.age).toBe(28);
    expect(String(personaSeed.background)).toContain('产品经理');
    expect(String(personaSeed.background)).toContain('竞业协议');
    // 行为字段不被身份锚定覆盖
    expect(personaSeed.emotionalTriggers).toEqual(['被居民质疑不作为']);
    expect(personaSeed.failurePatterns).toEqual(['遇到冲突先回避']);
    expect(personaSeed.availableTime).toBe('moderate');
    expect(personaSeed.cognitiveLoadTolerance).toBe('normal');
    expect(drift.map((d) => d.field)).toEqual(expect.arrayContaining(['nameHint', 'occupation', 'age', 'background']));
  });

  it('seed 只给 nameHint 时只锚名字，不造 occupation/background', () => {
    const { personaSeed, drift } = anchorPersonaIdentity(
      { nameHint: '别人', occupation: '教师', background: '教书' },
      { nameHint: '周然' },
    );
    expect(personaSeed.nameHint).toBe('周然');
    expect(personaSeed.occupation).toBe('教师');
    expect(personaSeed.background).toBe('教书');
    expect(drift.map((d) => d.field)).toEqual(['nameHint']);
  });

  it('无 seed 或生成物为空时原样返回', () => {
    expect(anchorPersonaIdentity({ nameHint: '甲' }, null).personaSeed).toEqual({ nameHint: '甲' });
    expect(anchorPersonaIdentity(null, { nameHint: '乙' }).personaSeed).toEqual({ nameHint: '乙' });
  });

  it('occupation 已存在时优先用 seed.occupation，role 作为兜底', () => {
    const { personaSeed } = anchorPersonaIdentity(
      { occupation: '旧职业' },
      { occupation: '数据分析师', role: '运营' },
    );
    expect(personaSeed.occupation).toBe('数据分析师');
  });
});
