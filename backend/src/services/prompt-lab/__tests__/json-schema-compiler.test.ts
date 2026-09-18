import {
  collectSchemaLimitations,
  compileStrictJsonSchema,
  type CompileFieldInput,
} from '../json-schema-compiler';

describe('json-schema-compiler：core fields → 严格 JSON Schema', () => {
  it('7 类受控类型逐个映射；顶层恒为 strict object', () => {
    const fields: CompileFieldInput[] = [
      { name: 'text', type: 'string', desc: '文本' },
      { name: 'count', type: 'number' },
      { name: 'flag', type: 'boolean' },
      { name: 'mode', type: 'enum', desc: 'a|b' },
      { name: 'obj', type: 'object' },
      { name: 'list', type: 'object[]' },
      { name: 'tags', type: 'string[]' },
    ];

    const schema = compileStrictJsonSchema(fields);

    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['text', 'count', 'flag', 'mode', 'obj', 'list', 'tags']);
    expect(schema.properties).toEqual({
      text: { type: 'string', description: '文本' },
      count: { type: 'number' },
      flag: { type: 'boolean' },
      // enum 缺结构化候选值 → 降级 string + description
      mode: { type: 'string', description: 'a|b' },
      // object 缺结构化 properties → 严格空对象
      obj: { type: 'object', additionalProperties: false },
      list: { type: 'array', items: { type: 'object', additionalProperties: false } },
      tags: { type: 'array', items: { type: 'string' } },
    });
  });

  it('`?` 后缀与 optional=true 使字段不进入 required，其余保持顺序', () => {
    const fields: CompileFieldInput[] = [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'string?' },
      { name: 'c', type: 'number', optional: true },
      { name: 'd', type: 'number', optional: false },
      { name: 'e', type: 'object[]?' },
    ];

    const schema = compileStrictJsonSchema(fields);

    expect(schema.required).toEqual(['a', 'd']);
    expect(Object.keys(schema.properties!)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(schema.properties!.b).toEqual({ type: 'string' });
    expect(schema.properties!.c).toEqual({ type: 'number' });
    expect(schema.properties!.e).toEqual({
      type: 'array',
      items: { type: 'object', additionalProperties: false },
    });
  });

  it('结构化 properties → 递归编译嵌套 object（含 object[] item）并保持 strict', () => {
    const fields: CompileFieldInput[] = [
      {
        name: 'analysis',
        type: 'object',
        desc: '本轮分析',
        properties: [
          { name: 'understanding', type: 'number' },
          { name: 'notes', type: 'string?' },
          { name: 'emotionalState', type: 'enum?', enumValues: ['positive', 'neutral', 'confused'] },
          {
            name: 'points',
            type: 'object[]',
            turn: true,
            properties: [{ name: 'name', type: 'string', desc: '点名' }],
          },
        ],
      },
    ];

    const schema = compileStrictJsonSchema(fields);

    expect(schema.properties!.analysis).toEqual({
      type: 'object',
      description: '本轮分析',
      additionalProperties: false,
      required: ['understanding', 'points'],
      properties: {
        understanding: { type: 'number' },
        notes: { type: 'string' },
        emotionalState: {
          type: 'string',
          enum: ['positive', 'neutral', 'confused'],
        },
        points: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: { name: { type: 'string', description: '点名' } },
          },
        },
      },
    });
  });

  it('object[] 缺结构化 properties 时降级为无 properties 的严格对象 item，并记录限制', () => {
    const fields: CompileFieldInput[] = [
      { name: 'misconceptions', type: 'object[]', desc: '误解台账' },
    ];

    const schema = compileStrictJsonSchema(fields);
    expect(schema.properties!.misconceptions).toEqual({
      type: 'array',
      description: '误解台账',
      items: { type: 'object', additionalProperties: false },
    });

    const limitations = collectSchemaLimitations(fields);
    expect(limitations).toEqual([
      expect.objectContaining({ code: 'object-properties-unavailable', field: 'misconceptions' }),
    ]);
  });

  it('enum：无结构化候选值降级为 string+description；有候选值则产出 enum 且不记限制', () => {
    const degraded = compileStrictJsonSchema([
      { name: 'verdict', type: 'enum', desc: 'equivalent | uncertain | divergent' },
    ]);
    expect(degraded.properties!.verdict).toEqual({
      type: 'string',
      description: 'equivalent | uncertain | divergent',
    });
    expect(collectSchemaLimitations([{ name: 'verdict', type: 'enum' }])).toEqual([
      expect.objectContaining({ code: 'enum-values-unavailable', field: 'verdict' }),
    ]);

    const structured = compileStrictJsonSchema([
      { name: 'mode', type: 'enum?', enumValues: ['explain', 'reflect'] },
    ]);
    expect(structured.properties!.mode).toEqual({ type: 'string', enum: ['explain', 'reflect'] });
    expect(structured.required).toEqual([]);
    expect(collectSchemaLimitations([{ name: 'mode', type: 'enum', enumValues: ['a'] }])).toEqual([]);
  });

  it('空 fields → properties 为空对象、required 为空数组、additionalProperties:false', () => {
    expect(compileStrictJsonSchema([])).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
    expect(collectSchemaLimitations([])).toEqual([]);
  });

  it('真实多字段用例：所有 required 正确、每个 object 都 strict', () => {
    const fields: CompileFieldInput[] = [
      { name: 'reply', type: 'string', desc: '老师对学生说的话', turn: true },
      { name: 'analysis', type: 'object', desc: '状态分析', turn: true },
      { name: 'knowledge', type: 'object', desc: '知识看板' },
      { name: 'pedagogy', type: 'object', desc: '教学策略', turn: true },
      { name: 'control', type: 'object', desc: '流程控制', turn: true },
      { name: 'optionalNote', type: 'string?', desc: '可选备注' },
    ];

    const schema = compileStrictJsonSchema(fields);

    expect(schema.required).toEqual(['reply', 'analysis', 'knowledge', 'pedagogy', 'control']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties!.analysis).toEqual({
      type: 'object',
      description: '状态分析',
      additionalProperties: false,
    });
    expect(schema.properties!.control).toEqual({
      type: 'object',
      description: '流程控制',
      additionalProperties: false,
    });
    expect(schema.properties!.optionalNote).toEqual({ type: 'string', description: '可选备注' });
    // 每个 object 类字段（含 required 与可选）都必须 strict
    for (const key of ['analysis', 'knowledge', 'pedagogy', 'control']) {
      expect(schema.properties![key]).toEqual(
        expect.objectContaining({ type: 'object', additionalProperties: false })
      );
    }
  });

  it('确定性：同输入两次编译产物完全一致（含顺序）', () => {
    const fields: CompileFieldInput[] = [
      { name: 'a', type: 'string' },
      { name: 'b', type: 'object?', properties: [{ name: 'c', type: 'number' }] },
      { name: 'd', type: 'string[]' },
    ];
    expect(JSON.stringify(compileStrictJsonSchema(fields))).toBe(
      JSON.stringify(compileStrictJsonSchema(fields))
    );
  });

  it('未知类型 fail loud', () => {
    expect(() => compileStrictJsonSchema([{ name: 'bad', type: 'array' }])).toThrow(
      /不在受控词表/
    );
  });
});
