/**
 * 身份迁移的护栏决策（纯函数）。三条护栏每一条都必须有用例钉住——
 * 它们是"宁可漏配、不可错并"的唯一实现点：别名一旦登记就是**用户级永久身份合并**。
 */
import { decideAliases } from '../kc-identity-migrate';

const oldIds = (pairs: Array<[string, string]>) => new Map(pairs);

describe('decideAliases', () => {
  it('high 置信度 + 旧名有身份 → 登记', () => {
    const r = decideAliases({
      matches: [{ newKc: '识别题型特征', oldKc: '识别题型关键特征', confidence: 'high' }],
      oldConceptIdByName: oldIds([['识别题型关键特征', 'cpt_old1']]),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(1);
    expect(r.approved[0]).toMatchObject({ newKc: '识别题型特征', oldConceptId: 'cpt_old1' });
    expect(r.skipped).toHaveLength(0);
  });

  it('护栏①：同一旧概念被两条新 KC 争抢时，只有置信度更高的那条胜出', () => {
    const r = decideAliases({
      matches: [
        { newKc: '甲', oldKc: '旧X', confidence: 'medium' },
        { newKc: '乙', oldKc: '旧X', confidence: 'high' },
      ],
      oldConceptIdByName: oldIds([['旧X', 'cpt_x']]),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'medium',
    });
    expect(r.approved.map((a) => a.newKc)).toEqual(['乙']);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].newKc).toBe('甲');
    expect(r.skipped[0].reason).toContain('一对一护栏');
  });

  it('护栏②：新名在别处已有概念身份 → 放弃（否则永久合并两个不同概念）', () => {
    const r = decideAliases({
      matches: [{ newKc: '识别题型特征', oldKc: '识别题型关键特征', confidence: 'high' }],
      oldConceptIdByName: oldIds([['识别题型关键特征', 'cpt_old1']]),
      existingConceptIdByNewName: new Map([['识别题型特征', 'cpt_other']]),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(0);
    expect(r.skipped[0].reason).toContain('已有概念身份');
  });

  it('护栏②的反面：新名已解析到的就是目标旧概念 → 允许（幂等重跑）', () => {
    const r = decideAliases({
      matches: [{ newKc: '识别题型特征', oldKc: '识别题型关键特征', confidence: 'high' }],
      oldConceptIdByName: oldIds([['识别题型关键特征', 'cpt_old1']]),
      existingConceptIdByNewName: new Map([['识别题型特征', 'cpt_old1']]),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(1);
  });

  it('护栏③：默认只收 high，medium/low 一律不登记', () => {
    const r = decideAliases({
      matches: [
        { newKc: '甲', oldKc: '旧X', confidence: 'medium' },
        { newKc: '乙', oldKc: '旧Y', confidence: 'low' },
      ],
      oldConceptIdByName: oldIds([['旧X', 'cpt_x'], ['旧Y', 'cpt_y']]),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(0);
    expect(r.skipped.map((s) => s.newKc).sort()).toEqual(['乙', '甲'].sort());
  });

  it('minConfidence=medium 时 medium 放行、low 仍拦下', () => {
    const r = decideAliases({
      matches: [
        { newKc: '甲', oldKc: '旧X', confidence: 'medium' },
        { newKc: '乙', oldKc: '旧Y', confidence: 'low' },
      ],
      oldConceptIdByName: oldIds([['旧X', 'cpt_x'], ['旧Y', 'cpt_y']]),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'medium',
    });
    expect(r.approved.map((a) => a.newKc)).toEqual(['甲']);
  });

  it('oldKc 为 null 是正常结果：新 KC 拿新身份，不计入登记', () => {
    const r = decideAliases({
      matches: [{ newKc: '全新能力', oldKc: null, confidence: 'high' }],
      oldConceptIdByName: oldIds([['旧X', 'cpt_x']]),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(0);
    expect(r.skipped[0].reason).toContain('无对应旧 KC');
  });

  it('旧名解析不到身份 → 不登记（没有可继承的 conceptId）', () => {
    const r = decideAliases({
      matches: [{ newKc: '甲', oldKc: '不存在的旧名', confidence: 'high' }],
      oldConceptIdByName: oldIds([['旧X', 'cpt_x']]),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(0);
    expect(r.skipped[0].reason).toContain('未解析到既有概念');
  });

  it('模型编造名单外的旧名 → 同样被拦（不编造、不凭空建身份）', () => {
    const r = decideAliases({
      matches: [{ newKc: '甲', oldKc: '模型瞎编的旧KC', confidence: 'high' }],
      oldConceptIdByName: new Map(),
      existingConceptIdByNewName: new Map(),
      minConfidence: 'high',
    });
    expect(r.approved).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
  });
});
