/**
 * Q11b：严格 JSON Schema 接线到 skill-output-validator 的纯单测（无 DB / 无 IO）。
 *
 * 覆盖：
 * - 严格路径：嵌套 object 通过/失败、结构化 enum 通过/失败、additionalProperties:false 拒绝、
 *   嵌套必填/类型失败码带 `path`；
 * - 门禁/回退：存在 enum-values-unavailable / object-properties-unavailable 降级限制时，
 *   行为与旧的宽容路径完全一致（不被空 object schema 误拒、额外属性不拦、enum 仍从 desc 解析）。
 */
import { validateOutputAgainstFields, type CoreFieldDeclaration } from '../skill-output-validator';

const NESTED_FIELDS: CoreFieldDeclaration[] = [
  {
    name: 'goalSeed',
    type: 'object',
    desc: '目标种子',
    properties: [
      { name: 'primaryBlockType', type: 'enum', enumValues: ['concept', 'skill', 'project'], desc: '主块类型' },
      { name: 'rationale', type: 'string' },
      { name: 'confidence', type: 'number?' },
    ],
  },
  { name: 'reply', type: 'string', desc: '回复正文' },
];

const VALID_NESTED = {
  goalSeed: { primaryBlockType: 'concept', rationale: '因为…' },
  reply: '好的',
};

describe('Q11b 严格路径：嵌套 object', () => {
  it('嵌套对象合法通过', () => {
    const result = validateOutputAgainstFields(VALID_NESTED, NESTED_FIELDS);
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('顶层必填缺失沿用 missing-required', () => {
    const result = validateOutputAgainstFields({ goalSeed: { primaryBlockType: 'concept', rationale: 'x' } }, NESTED_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { field: 'reply', code: 'missing-required', expected: 'string', path: 'reply' },
    ]);
  });

  it('顶层类型不匹配沿用 type-mismatch', () => {
    const result = validateOutputAgainstFields({ ...VALID_NESTED, reply: 123 }, NESTED_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'reply' && i.code === 'type-mismatch')).toBe(true);
  });

  it('嵌套必填缺失报 missing-nested-required 并带 path', () => {
    const result = validateOutputAgainstFields(
      { goalSeed: { primaryBlockType: 'concept' }, reply: '好的' },
      NESTED_FIELDS
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === 'missing-nested-required');
    expect(issue).toMatchObject({
      field: 'goalSeed',
      code: 'missing-nested-required',
      expected: 'string',
      path: 'goalSeed.rationale',
    });
  });

  it('嵌套类型不匹配报 nested-type-mismatch 并带 path', () => {
    const result = validateOutputAgainstFields(
      { goalSeed: { primaryBlockType: 'concept', rationale: 123 }, reply: '好的' },
      NESTED_FIELDS
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: 'goalSeed',
        code: 'nested-type-mismatch',
        expected: 'string',
        actual: 123,
        path: 'goalSeed.rationale',
      },
    ]);
  });

  it('嵌套可选字段缺失/null 合法', () => {
    expect(
      validateOutputAgainstFields({ goalSeed: { primaryBlockType: 'skill', rationale: 'x' }, reply: 'y' }, NESTED_FIELDS).valid
    ).toBe(true);
    expect(
      validateOutputAgainstFields(
        { goalSeed: { primaryBlockType: 'skill', rationale: 'x', confidence: null }, reply: 'y' },
        NESTED_FIELDS
      ).valid
    ).toBe(true);
  });

  it('goalSeed 非对象沿用 type-mismatch（顶层字段既有码）', () => {
    const result = validateOutputAgainstFields({ goalSeed: 'concept', reply: 'y' }, NESTED_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      field: 'goalSeed',
      code: 'type-mismatch',
      expected: 'object',
      path: 'goalSeed',
    });
  });
});

describe('Q11b 严格路径：结构化 enum', () => {
  it('候选值内通过', () => {
    expect(validateOutputAgainstFields(VALID_NESTED, NESTED_FIELDS).valid).toBe(true);
  });

  it('越界报 enum-out-of-range 并带嵌套 path', () => {
    const result = validateOutputAgainstFields(
      { goalSeed: { primaryBlockType: 'bogus', rationale: 'x' }, reply: 'y' },
      NESTED_FIELDS
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: 'goalSeed',
        code: 'enum-out-of-range',
        expected: 'concept|skill|project',
        actual: 'bogus',
        path: 'goalSeed.primaryBlockType',
      },
    ]);
  });
});

describe('Q11b 严格路径：additionalProperties:false', () => {
  it('顶层表外属性报 unknown-property', () => {
    const result = validateOutputAgainstFields({ ...VALID_NESTED, extra: 1 }, NESTED_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: 'extra',
        code: 'unknown-property',
        expected: 'goalSeed|reply',
        actual: 1,
        path: 'extra',
      },
    ]);
  });

  it('嵌套表外属性报 unknown-property 并带 path', () => {
    const result = validateOutputAgainstFields(
      { goalSeed: { primaryBlockType: 'concept', rationale: 'x', extraNested: true }, reply: 'y' },
      NESTED_FIELDS
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'unknown-property' && i.path === 'goalSeed.extraNested')).toBe(true);
  });
});

describe('Q11b 严格路径：object[] item', () => {
  const ARRAY_FIELDS: CoreFieldDeclaration[] = [
    {
      name: 'points',
      type: 'object[]',
      desc: '知识点清单',
      properties: [
        { name: 'name', type: 'string', desc: '点名' },
        { name: 'score', type: 'number?' },
      ],
    },
  ];

  it('合法数组元素通过', () => {
    expect(validateOutputAgainstFields({ points: [{ name: 'a' }, { name: 'b', score: 0.5 }] }, ARRAY_FIELDS).valid).toBe(true);
    expect(validateOutputAgainstFields({ points: [] }, ARRAY_FIELDS).valid).toBe(true);
  });

  it('元素内必填缺失报 missing-nested-required + 下标 path', () => {
    const result = validateOutputAgainstFields({ points: [{ score: 1 }] }, ARRAY_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      field: 'points',
      code: 'missing-nested-required',
      path: 'points[0].name',
    });
  });

  it('元素内类型不符报 nested-type-mismatch + 下标 path', () => {
    const result = validateOutputAgainstFields({ points: [{ name: 'a', score: 'high' }] }, ARRAY_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      field: 'points',
      code: 'nested-type-mismatch',
      expected: 'number',
      path: 'points[0].score',
    });
  });

  it('points 非数组沿用 type-mismatch', () => {
    const result = validateOutputAgainstFields({ points: 'nope' }, ARRAY_FIELDS);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ field: 'points', code: 'type-mismatch', expected: 'array' });
  });
});

describe('Q11b 门禁/回退：存在降级限制时保持宽容行为不变', () => {
  it('enum 无结构化候选值 → 回退：仍从 desc 解析候选、不因额外属性拒绝', () => {
    const fields: CoreFieldDeclaration[] = [{ name: 'stage', type: 'enum', desc: 'understanding | proposing | ready' }];
    const pass = validateOutputAgainstFields({ stage: 'proposing', extra: 1 }, fields);
    expect(pass.valid).toBe(true);
    expect(pass.issues).toEqual([]);

    const fail = validateOutputAgainstFields({ stage: 'bogus' }, fields);
    expect(fail.valid).toBe(false);
    expect(fail.issues[0]).toMatchObject({ field: 'stage', code: 'enum-out-of-range' });
    // 宽容路径不带 path
    expect(fail.issues[0].path).toBeUndefined();
  });

  it('object 无结构化 properties → 回退：任意子对象内容不被空 {} schema 误拒', () => {
    const fields: CoreFieldDeclaration[] = [{ name: 'goalSeed', type: 'object', desc: '目标种子' }];
    const result = validateOutputAgainstFields({ goalSeed: { anything: 'goes', nested: { deep: true } } }, fields);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('object[] 无结构化 properties → 回退：元素任意对象内容不被误拒', () => {
    const fields: CoreFieldDeclaration[] = [{ name: 'misconceptions', type: 'object[]', desc: '误解台账' }];
    const result = validateOutputAgainstFields({ misconceptions: [{ whatever: 1 }, {}] }, fields);
    expect(result.valid).toBe(true);
  });

  it('部分结构化（object 仍缺 properties）→ 整体回退，结构化 enum 也不走严格层', () => {
    const fields: CoreFieldDeclaration[] = [
      { name: 'mode', type: 'enum', enumValues: ['a', 'b'] },
      { name: 'payload', type: 'object' },
    ];
    // 若误走严格层，mode='bogus' 会被拦；回退后宽容层无 desc 候选 → 放行
    const result = validateOutputAgainstFields({ mode: 'bogus', payload: { x: 1 } }, fields);
    expect(result.valid).toBe(true);
  });

  it('纯标量声明（无结构化 opt-in）→ 回退：额外属性不被 additionalProperties:false 拦', () => {
    const fields: CoreFieldDeclaration[] = [
      { name: 'stallRisk', type: 'number', desc: '卡壳风险' },
      { name: 'rationale', type: 'string', desc: '一句话依据' },
    ];
    const result = validateOutputAgainstFields(
      { stallRisk: 0.4, rationale: 'x', extra: 'drift' },
      fields
    );
    // 当前无任何 core 声明结构化信息：严格层不得自动启用，行为与旧版一致
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('未知类型不因编译器抛错而破坏宽容行为', () => {
    const fields = [{ name: 'legacy', type: 'array', desc: '历史类型' }] as unknown as CoreFieldDeclaration[];
    expect(validateOutputAgainstFields({ legacy: ['x'] }, fields).valid).toBe(true);
  });

  it('根对象非对象仍报失败（两条路径一致）', () => {
    expect(validateOutputAgainstFields('not-object', NESTED_FIELDS).valid).toBe(false);
    expect(validateOutputAgainstFields(null, NESTED_FIELDS).valid).toBe(false);
  });
});
