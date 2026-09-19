/**
 * 字段级运行时命中率聚合纯函数单测（Q9）
 * 覆盖：安全解析、命中率数学、死字段、契约漂移、minCalls、空输入、确定性、跳过口径。
 */
import {
  aggregateFieldHitRates,
  extractProducedFields,
  skillIdFromAgentId,
  type FieldHitLogRow,
} from '../field-hit-rates';

const row = (agentId: string | null, extractedJson: string | null): FieldHitLogRow => ({
  agentId,
  extractedJson,
});

describe('extractProducedFields（安全解析）', () => {
  it('null → []', () => {
    expect(extractProducedFields(null)).toEqual([]);
  });

  it('空串 / 纯空白 → []', () => {
    expect(extractProducedFields('')).toEqual([]);
    expect(extractProducedFields('   \n\t ')).toEqual([]);
  });

  it('非法 JSON → []', () => {
    expect(extractProducedFields('not json at all')).toEqual([]);
    expect(extractProducedFields('{"a":1')).toEqual([]);
  });

  it('非对象 JSON（数组 / 标量）→ []', () => {
    expect(extractProducedFields('[1,2,3]')).toEqual([]);
    expect(extractProducedFields('42')).toEqual([]);
    expect(extractProducedFields('"hello"')).toEqual([]);
    expect(extractProducedFields('null')).toEqual([]);
  });

  it('对象 → 返回顶层键', () => {
    expect(extractProducedFields('{"reply":"hi","analysis":{"level":1}}')).toEqual(['reply', 'analysis']);
  });

  it('只取顶层键，不递归嵌套', () => {
    expect(extractProducedFields('{"a":{"b":{"c":1}},"d":2}')).toEqual(['a', 'd']);
  });

  it('空对象 → []（解析成功但无字段）', () => {
    expect(extractProducedFields('{}')).toEqual([]);
  });

  it('容忍首尾空白', () => {
    expect(extractProducedFields('  {"reply":"x"}  ')).toEqual(['reply']);
  });
});

describe('skillIdFromAgentId（归属口径）', () => {
  it('识别 skill: 前缀并去空白', () => {
    expect(skillIdFromAgentId('skill:path-planning')).toBe('path-planning');
    expect(skillIdFromAgentId('  skill:teaching-turn  ')).toBe('teaching-turn');
  });

  it('空值 / 非 skill agent / 空 skillId → null', () => {
    expect(skillIdFromAgentId(null)).toBeNull();
    expect(skillIdFromAgentId(undefined)).toBeNull();
    expect(skillIdFromAgentId('')).toBeNull();
    expect(skillIdFromAgentId('teaching-agent')).toBeNull();
    expect(skillIdFromAgentId('skill:')).toBeNull();
  });
});

describe('aggregateFieldHitRates', () => {
  it('命中率数学：hits / totalCalls，保留 4 位；解析失败行计入分母', () => {
    const result = aggregateFieldHitRates(
      [
        row('skill:x', '{"a":1,"b":2}'),
        row('skill:x', '{"a":1}'),
        row('skill:x', null), // 媒体产物 / 空输出：计分母，不计产出
      ],
      { declaredFieldsBySkill: { x: ['a', 'b'] } },
    );

    const skill = result.skills[0];
    expect(skill.totalCalls).toBe(3);
    expect(skill.parsedCalls).toBe(2);
    expect(skill.unparsedCalls).toBe(1);
    expect(skill.fields).toEqual([
      { field: 'a', declared: true, hits: 2, hitRate: 0.6667 },
      { field: 'b', declared: true, hits: 1, hitRate: 0.3333 },
    ]);
    expect(skill.deadFields).toEqual([]);
    expect(skill.driftFields).toEqual([]);
  });

  it('死字段：声明但窗口内零命中，保持声明顺序', () => {
    const result = aggregateFieldHitRates([row('skill:x', '{"a":1}'), row('skill:x', '{"a":2}')], {
      declaredFieldsBySkill: { x: ['c', 'a', 'b'] },
    });

    const skill = result.skills[0];
    expect(skill.deadFields).toEqual(['c', 'b']);
    expect(skill.fields.map((entry) => entry.field)).toEqual(['a', 'b', 'c']);
    expect(skill.fields.find((entry) => entry.field === 'c')?.hitRate).toBe(0);
  });

  it('契约漂移字段：产出但 core 未声明，带命中率且按名升序', () => {
    const result = aggregateFieldHitRates(
      [row('skill:x', '{"a":1,"zeta":1,"beta":1}'), row('skill:x', '{"a":2,"zeta":2}')],
      { declaredFieldsBySkill: { x: ['a'] } },
    );

    const skill = result.skills[0];
    expect(skill.driftFields.map((entry) => entry.field)).toEqual(['beta', 'zeta']);
    expect(skill.driftFields).toEqual([
      { field: 'beta', declared: false, hits: 1, hitRate: 0.5 },
      { field: 'zeta', declared: false, hits: 2, hitRate: 1 },
    ]);
    expect(skill.deadFields).toEqual([]);
  });

  it('排序确定性：skills 按 skillId 升序，fields 按字段名升序', () => {
    const result = aggregateFieldHitRates(
      [row('skill:zeta', '{"b":1,"a":1}'), row('skill:alpha', '{"m":1}')],
      { declaredFieldsBySkill: { zeta: ['b', 'a', 'c'], alpha: ['m'] } },
    );

    expect(result.skills.map((skill) => skill.skillId)).toEqual(['alpha', 'zeta']);
    expect(result.skills[1].fields.map((entry) => entry.field)).toEqual(['a', 'b', 'c']);
  });

  it('minCalls 过滤：低于门槛的 skill 不进入结果并计数', () => {
    const result = aggregateFieldHitRates(
      [row('skill:a', '{"x":1}'), row('skill:b', '{"y":1}'), row('skill:b', '{"y":2}')],
      { declaredFieldsBySkill: { a: ['x'], b: ['y'] }, minCalls: 2 },
    );

    expect(result.skills.map((skill) => skill.skillId)).toEqual(['b']);
    expect(result.skippedBelowMinCalls).toBe(1);
  });

  it('空输入：返回空结果，零计数', () => {
    const result = aggregateFieldHitRates([], { declaredFieldsBySkill: {} });

    expect(result.skills).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.consideredRows).toBe(0);
  });

  it('声明但零调用的 skill 仍出现，字段全部为死字段（hitRate=0）', () => {
    const result = aggregateFieldHitRates([], { declaredFieldsBySkill: { ghost: ['a', 'b'] } });

    expect(result.skills).toHaveLength(1);
    const skill = result.skills[0];
    expect(skill.totalCalls).toBe(0);
    expect(skill.deadFields).toEqual(['a', 'b']);
    expect(skill.fields.every((entry) => entry.hitRate === 0)).toBe(true);
  });

  it('跳过口径：缺 agentId / 非 skill agent 分别计数，不进入 skills', () => {
    const result = aggregateFieldHitRates(
      [
        row(null, '{"a":1}'),
        row('   ', '{"a":1}'),
        row('teaching-agent', '{"a":1}'),
        row('api-gateway', '{"a":1}'),
        row('skill:x', '{"a":1}'),
      ],
      { declaredFieldsBySkill: { x: ['a'] } },
    );

    expect(result.totalRows).toBe(5);
    expect(result.consideredRows).toBe(1);
    expect(result.skippedMissingAgent).toBe(2);
    expect(result.skippedNonSkillAgent).toBe(2);
    expect(result.skills.map((skill) => skill.skillId)).toEqual(['x']);
  });

  it('声明字段去重且保序', () => {
    const result = aggregateFieldHitRates([row('skill:x', '{"a":1}')], {
      declaredFieldsBySkill: { x: ['b', 'a', 'b', '  ', 'a'] },
    });

    expect(result.skills[0].declaredFields).toEqual(['b', 'a']);
  });

  it('确定性：同一输入重复调用深相等，且与行顺序无关', () => {
    const rows = [
      row('skill:x', '{"a":1}'),
      row('skill:x', null),
      row('skill:y', '{"b":1,"c":1}'),
    ];
    const options = { declaredFieldsBySkill: { x: ['a', 'b'], y: ['c'] } };

    const first = aggregateFieldHitRates(rows, options);
    const second = aggregateFieldHitRates(rows, options);
    const shuffled = aggregateFieldHitRates([...rows].reverse(), options);

    expect(second).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('未声明 skill 的观测行也会出现（全字段为漂移）', () => {
    const result = aggregateFieldHitRates([row('skill:unknown', '{"a":1,"b":1}'), row('skill:unknown', '{"a":2}')], {
      declaredFieldsBySkill: {},
    });

    const skill = result.skills[0];
    expect(skill.declaredFields).toEqual([]);
    expect(skill.deadFields).toEqual([]);
    expect(skill.driftFields.map((entry) => entry.field)).toEqual(['a', 'b']);
  });
});
