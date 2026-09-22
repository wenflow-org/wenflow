import { isRegistrableConceptText } from '../backfill-concept-registry';

/**
 * 护栏回归测试（2026-09-22 实测发现）：path 内局部序号不得注册为 canonical 概念。
 *
 * 背景：`resolveTaskConcept` 回退为原始文本时，`linkedConceptName` 可能就是 `concept-N`；
 * 首版回填把它当概念注册，别名表出现 `aliasRaw="concept-1"`（实测 3 条），
 * 模型还会返回列表形态 `"concept-1, concept-2"` —— 正是设计要消灭的"同键不同义"。
 */
describe('isRegistrableConceptText（局部序号护栏）', () => {
  it('拒绝单个局部序号（concept-N / kc-Nx / ms-N / st-N）', () => {
    expect(isRegistrableConceptText('concept-1')).toBe(false);
    expect(isRegistrableConceptText('concept-12')).toBe(false);
    expect(isRegistrableConceptText('kc-1a')).toBe(false);
    expect(isRegistrableConceptText('ms_3')).toBe(false);
    expect(isRegistrableConceptText('st-10')).toBe(false);
  });

  it('拒绝列表形态的局部序号（实测模型输出）', () => {
    expect(isRegistrableConceptText('concept-1, concept-2')).toBe(false);
    expect(isRegistrableConceptText('concept-1，concept-2')).toBe(false);
    expect(isRegistrableConceptText('concept-1、concept-2、concept-3')).toBe(false);
    expect(isRegistrableConceptText('  concept-1 ; kc-2a  ')).toBe(false);
  });

  it('接受真实语义概念名', () => {
    expect(isRegistrableConceptText('分组键的完整性与唯一性约束')).toBe(true);
    expect(isRegistrableConceptText('明细行到汇总口径的映射关系')).toBe(true);
    expect(isRegistrableConceptText('识别半联动点')).toBe(true);
  });

  it('混有真实概念名的列表保留（不误伤）', () => {
    expect(isRegistrableConceptText('concept-1, 分组键的唯一性')).toBe(true);
  });

  it('空/空白拒收', () => {
    expect(isRegistrableConceptText('')).toBe(false);
    expect(isRegistrableConceptText('   ')).toBe(false);
  });
});
