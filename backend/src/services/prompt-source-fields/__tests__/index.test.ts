/**
 * prompt-source-fields 单元测试
 */
import {
  extractFieldsFromSource,
  serializeFieldsToSource,
  updateFieldsInSource,
  fieldsToJsonObject,
  type EditableField,
} from '../index';

const SAMPLE_SOURCE = `## 身份定义

你是测试 skill.

## 输入说明

payload 包含:

\`\`\`json
{
  "userInput": "用户输入文本",
  "state": "对象 — 当前状态"
}
\`\`\`

- userInput: 当前输入
- state: 当前状态

## 执行规则

RULE-01: 严格遵守.

## 输出规格

OUT-01: 只输出 JSON.
OUT-02: 必须含 reply.

\`\`\`json
{
  "reply": "string — 回复",
  "understanding": {
    "surface_goal": "string — 表面目标"
  }
}
\`\`\`

OUT-03: JSON 前后不能有注释.
`;

describe('prompt-source-fields: extractFieldsFromSource', () => {
  it('从 input 段抽字段', () => {
    const fields = extractFieldsFromSource(SAMPLE_SOURCE, 'input');
    expect(fields.length).toBe(2);
    expect(fields.find((f) => f.path === 'userInput')).toBeTruthy();
    expect(fields.find((f) => f.path === 'state')).toBeTruthy();
  });

  it('从 output 段抽嵌套字段', () => {
    const fields = extractFieldsFromSource(SAMPLE_SOURCE, 'output');
    const paths = fields.map((f) => f.path);
    expect(paths).toContain('reply');
    expect(paths).toContain('understanding');
    expect(paths).toContain('understanding.surface_goal');
  });

  it('归一 enum 类型', () => {
    const src =
      '## 输出规格\n\n```json\n{\n  "stage": "a|b|c"\n}\n```\n';
    const fields = extractFieldsFromSource(src, 'output');
    expect(fields[0].valueType).toBe('enum');
    expect(fields[0].enumValues).toEqual(['a', 'b', 'c']);
  });
});

describe('prompt-source-fields: fieldsToJsonObject', () => {
  it('扁平 path 重建为嵌套对象', () => {
    const fields: EditableField[] = [
      { path: 'reply', valueType: 'string', note: '回复' },
      { path: 'understanding.surface_goal', valueType: 'string', note: '表面目标' },
      { path: 'understanding.real_problem', valueType: 'string', note: '真实问题' },
    ];
    const obj = fieldsToJsonObject(fields);
    expect(obj.reply).toContain('回复');
    expect(obj.understanding.surface_goal).toContain('表面目标');
    expect(obj.understanding.real_problem).toContain('真实问题');
  });

  it('enum 渲染为 a|b|c', () => {
    const fields: EditableField[] = [
      { path: 'stage', valueType: 'enum', enumValues: ['a', 'b', 'c'], note: '' },
    ];
    const obj = fieldsToJsonObject(fields);
    expect(obj.stage).toBe('a|b|c');
  });

  it('支持数组 path', () => {
    const fields: EditableField[] = [
      { path: 'items[].name', valueType: 'string', note: '' },
    ];
    const obj = fieldsToJsonObject(fields);
    expect(Array.isArray(obj.items)).toBe(true);
    expect(obj.items[0].name).toBeDefined();
  });
});

describe('prompt-source-fields: serializeFieldsToSource', () => {
  it('改 output 字段后, OUT-XX 行为规则保留', () => {
    const newFields: EditableField[] = [
      { path: 'reply', valueType: 'string', note: '新回复' },
      { path: 'age', valueType: 'number', note: '年龄' },
    ];
    const result = serializeFieldsToSource(SAMPLE_SOURCE, 'output', newFields);
    expect(result.rewritten).toBe(true);
    expect(result.source).toContain('OUT-01: 只输出 JSON.');
    expect(result.source).toContain('OUT-02: 必须含 reply.');
    expect(result.source).toContain('OUT-03: JSON 前后不能有注释.');
    expect(result.source).toContain('"age"');
    expect(result.source).not.toContain('"understanding"'); // 原 understanding 被替换掉
    expect(result.source).toContain('## 身份定义');
    expect(result.source).toContain('## 执行规则');
  });

  it('改 input 字段后, prose bullet 保留', () => {
    const newFields: EditableField[] = [
      { path: 'newField', valueType: 'string', note: '新字段' },
    ];
    const result = serializeFieldsToSource(SAMPLE_SOURCE, 'input', newFields);
    expect(result.rewritten).toBe(true);
    expect(result.source).toContain('"newField"');
    // prose 保留
    expect(result.source).toContain('payload 包含');
    expect(result.source).toContain('- userInput: 当前输入');
  });

  it('段不存在 → 返回 error', () => {
    const noInputSrc = '## 身份定义\n\n你是 stub.\n\n## 输出规格\n\n```json\n{}\n```\n';
    const result = serializeFieldsToSource(noInputSrc, 'input', []);
    expect(result.rewritten).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('round-trip: extract → serialize → 再 extract, 字段集合稳定', () => {
    const fields1 = extractFieldsFromSource(SAMPLE_SOURCE, 'output');
    const sr = serializeFieldsToSource(SAMPLE_SOURCE, 'output', fields1);
    const fields2 = extractFieldsFromSource(sr.source, 'output');
    // 至少 reply / understanding.surface_goal 这种顶层字段一致
    const paths1 = fields1.map((f) => f.path).sort();
    const paths2 = fields2.map((f) => f.path).sort();
    expect(paths2).toEqual(paths1);
  });
});

describe('prompt-source-fields: updateFieldsInSource', () => {
  it('同时改 input + output', () => {
    const result = updateFieldsInSource(
      SAMPLE_SOURCE,
      [{ path: 'x', valueType: 'string', note: 'X' }],
      [{ path: 'y', valueType: 'string', note: 'Y' }]
    );
    expect(result.source).toContain('"x"');
    expect(result.source).toContain('"y"');
    expect(result.warnings).toHaveLength(0);
  });
});
