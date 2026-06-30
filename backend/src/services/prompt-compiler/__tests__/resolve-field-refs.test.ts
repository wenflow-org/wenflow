/**
 * resolve-field-refs 单元测试
 */

import {
  extractFieldRefs,
  resolveFieldRefs,
  buildResolverFromSkills,
} from '../resolve-field-refs';

describe('resolve-field-refs: extractFieldRefs', () => {
  it('能抽出 {{skill:xxx.field}} token', () => {
    const text = '请参考 {{skill:goal-conversation.understanding.surface_goal}} 字段';
    const refs = extractFieldRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0].skillId).toBe('goal-conversation');
    expect(refs[0].fieldPath).toBe('understanding.surface_goal');
  });

  it('无 token 返回空数组', () => {
    expect(extractFieldRefs('普通文本')).toEqual([]);
  });

  it('多个 token 全部抽出', () => {
    const text = '{{skill:a.x}} 和 {{skill:b.y.z}}';
    const refs = extractFieldRefs(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].skillId).toBe('a');
    expect(refs[1].skillId).toBe('b');
    expect(refs[1].fieldPath).toBe('y.z');
  });

  it('支持 skill: 前缀', () => {
    const refs = extractFieldRefs('{{skill:skill:goal.field}}');
    expect(refs[0].skillId).toBe('skill:goal');
  });
});

describe('resolve-field-refs: resolveFieldRefs', () => {
  it('解析成功 → 渲染为内联注解', () => {
    const text = '查看 {{skill:goal-conv.surface_goal}}';
    const result = resolveFieldRefs(text, (skillId, fieldPath) => {
      if (skillId === 'goal-conv' && fieldPath === 'surface_goal') {
        return { found: true, kind: 'output', valueType: 'string', note: '用户原始诉求' };
      }
      return null;
    });
    expect(result.resolved).toBe(1);
    expect(result.unresolved).toBe(0);
    expect(result.text).toContain('「goal-conv.surface_goal');
    expect(result.text).toContain('用户原始诉求');
    expect(result.warnings).toHaveLength(0);
  });

  it('解析失败 → 保留原 token 加 warning', () => {
    const text = '查看 {{skill:unknown.x}}';
    const result = resolveFieldRefs(text, () => ({ found: false, kind: 'unknown', valueType: null, note: '' }));
    expect(result.unresolved).toBe(1);
    expect(result.text).toContain('{{skill:unknown.x}}'); // 保留原 token
    expect(result.warnings).toHaveLength(1);
  });

  it('无 token → text 原样返回', () => {
    const text = '普通文本';
    const result = resolveFieldRefs(text, () => null);
    expect(result.text).toBe(text);
    expect(result.resolved).toBe(0);
  });
});

describe('resolve-field-refs: buildResolverFromSkills', () => {
  it('从 skill 源构建 resolver, 能区分 input/output', () => {
    const skills = [
      {
        skillId: 'goal-conversation',
        source: `## 输入说明

\`\`\`json
{
  "userInput": "用户输入文本"
}
\`\`\`

## 输出规格

\`\`\`json
{
  "reply": "回复",
  "understanding": {
    "surface_goal": "表面目标"
  }
}
\`\`\`
`,
      },
    ];
    const resolver = buildResolverFromSkills(skills);

    const input = resolver('goal-conversation', 'userInput');
    expect(input.found).toBe(true);
    expect(input.kind).toBe('input');

    const out = resolver('goal-conversation', 'understanding.surface_goal');
    expect(out.found).toBe(true);
    expect(out.kind).toBe('output');

    // 支持 skill: 前缀
    const prefixed = resolver('skill:goal-conversation', 'reply');
    expect(prefixed.found).toBe(true);
    expect(prefixed.kind).toBe('output');

    // 未知 skill
    const unknown = resolver('xxxx', 'foo');
    expect(unknown.found).toBe(false);
  });
});
