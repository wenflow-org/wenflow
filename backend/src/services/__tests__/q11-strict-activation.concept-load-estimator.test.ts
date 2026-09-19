/**
 * Q11「点亮」验收：**真实 core 声明**（prompts/core/concept-load-estimator.yaml）驱动
 * skill-output-validator 的严格 JSON Schema 路径。
 *
 * 证据逻辑：若严格路径未激活（回退到宽容层），嵌套 enum 越界 / 未知子字段 / 缺嵌套必填
 * **都不会被拦**（宽容层只校验顶层字段类型，nan enums 从 desc 文本解析）。因此以下断言
 * 即为「严格路径已点亮」的证据。
 *
 * 无 DB / 无网络：仅文件系统读取 core yaml（File-as-Truth）+ 纯函数校验。
 */
import {
  loadCoreFieldDeclarations,
  validateOutputAgainstFields,
  type CoreFieldDeclaration,
} from '../skill-output-validator';

const SKILL_ID = 'concept-load-estimator';

const validOutput = {
  concepts: [
    {
      conceptKey: '工作日与周末不可混算',
      granularity: 'cluster',
      knowledgeType: 'conceptual',
      difficultyBand: 'medium',
      rationale: '含并列关系，需组织解释',
    },
  ],
};

describe('Q11 点亮：concept-load-estimator 走严格路径', () => {
  let fields: CoreFieldDeclaration[] | null = null;

  beforeAll(async () => {
    fields = await loadCoreFieldDeclarations(SKILL_ID);
  });

  it('core 声明已加载，且 concepts 带结构化子属性（点亮前提）', () => {
    expect(fields).not.toBeNull();
    const concepts = (fields || []).find((f) => f.name === 'concepts');
    expect(concepts).toBeDefined();
    expect(Array.isArray(concepts?.properties) && (concepts?.properties?.length ?? 0) > 0).toBe(true);
  });

  it('合法输出通过严格校验', () => {
    const result = validateOutputAgainstFields(validOutput, fields!);
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('嵌套 enum 越界被拦（enum-out-of-range，带 path）', () => {
    const bad = { concepts: [{ ...validOutput.concepts[0], granularity: 'bogus' }] };
    const result = validateOutputAgainstFields(bad, fields!);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'enum-out-of-range' && i.path === 'concepts[0].granularity')
    ).toBe(true);
  });

  it('未知子字段被拦（unknown-property，additionalProperties:false）', () => {
    const bad = { concepts: [{ ...validOutput.concepts[0], sneaky: 'x' }] };
    const result = validateOutputAgainstFields(bad, fields!);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'unknown-property')).toBe(true);
  });

  it('缺嵌套必填子字段被拦（missing-nested-required，带 path）', () => {
    const bad = {
      concepts: [
        { conceptKey: 'x', granularity: 'atomic', knowledgeType: 'factual', difficultyBand: 'low' },
      ],
    };
    const result = validateOutputAgainstFields(bad, fields!);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'missing-nested-required' && i.path === 'concepts[0].rationale')
    ).toBe(true);
  });
});
