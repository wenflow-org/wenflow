/**
 * Prompt Compiler 单元测试
 * ============================================================
 * 测试目标:
 *   1. hash 工具稳定性 (key 顺序无关)
 *   2. rewriteInputSection: 仅替换 ```json``` 块, 其它一字不动
 *   3. rewriteOutputSection: 同上, OUT-XX 行为规则不被覆盖
 *   4. compilePrompt 主流程: 无 routing → no-op, 有 routing → 重写,
 *      解析失败兜底, hash 一致性
 */

import { parsePromptSchema } from '../../prompt-schema';
import {
  compilePrompt,
  rewriteInputSection,
  rewriteOutputSection,
  sha256,
  stableStringify,
  sha256Object,
} from '../index';
import type { FieldRoutingRow } from '../../field-dispatcher';

// Mock field-dispatcher
jest.mock('../../field-dispatcher', () => ({
  getAgentRoutings: jest.fn(),
}));

import { getAgentRoutings } from '../../field-dispatcher';

const mockGetAgentRoutings = getAgentRoutings as jest.MockedFunction<typeof getAgentRoutings>;

beforeEach(() => {
  mockGetAgentRoutings.mockReset();
});

describe('prompt-compiler: hash', () => {
  it('相同字符串 → 相同 hash', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('不同字符串 → 不同 hash', () => {
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('stableStringify 对 key 顺序无关', () => {
    const a = { foo: 1, bar: 2 };
    const b = { bar: 2, foo: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('sha256Object key 顺序无关', () => {
    expect(sha256Object({ a: 1, b: 2 })).toBe(sha256Object({ b: 2, a: 1 }));
  });

  it('stableStringify 数组保持原序', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe('prompt-compiler: rewriteInputSection', () => {
  const sample = `## 输入说明

payload 中会包含:

\`\`\`json
{
  "old_field": "占位"
}
\`\`\`

- old_field: 旧字段描述
`;

  const block = {
    section: 'input' as const,
    heading: '输入说明',
    body: sample,
    rules: [],
    wfBlocks: [],
    order: 0,
  };

  it('无 input 角色 routing → no-op', () => {
    const result = rewriteInputSection(block, []);
    expect(result.rewritten).toBe(false);
    expect(result.body).toBe(sample);
  });

  it('有 input 角色 routing → 替换 json 块, 保留 prose', () => {
    const routings: FieldRoutingRow[] = [
      {
        agentId: 'test',
        fieldId: 'userInput',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: false,
        promptRole: 'input-required',
        valueType: 'string',
      },
      {
        agentId: 'test',
        fieldId: 'state',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: false,
        promptRole: 'input-required',
        valueType: 'object',
      },
    ];
    const result = rewriteInputSection(block, routings);
    expect(result.rewritten).toBe(true);
    expect(result.fieldsApplied).toBe(2);
    // 新 json 含新字段
    expect(result.body).toContain('"userInput"');
    expect(result.body).toContain('"state"');
    // 旧字段被冲掉
    expect(result.body).not.toContain('"old_field"');
    // prose bullet 仍在 (源 body 里的 markdown 描述)
    expect(result.body).toContain('- old_field: 旧字段描述');
  });
});

describe('prompt-compiler: rewriteOutputSection', () => {
  const sample = `## 输出规格

OUT-01: 只输出一个合法 JSON 对象.
OUT-02: 顶层字段固定为 reply, state, understanding.

\`\`\`json
{
  "reply": "回复文本",
  "state": {
    "stage": "understanding|proposing|ready"
  }
}
\`\`\`

OUT-03: JSON 前后不能有任何前言.
`;

  const block = {
    section: 'output' as const,
    heading: '输出规格',
    body: sample,
    rules: [],
    wfBlocks: [],
    order: 0,
  };

  it('无 output 角色 routing → no-op', () => {
    const result = rewriteOutputSection(block, []);
    expect(result.rewritten).toBe(false);
    expect(result.body).toBe(sample);
  });

  it('有 output 角色 routing → 替换 json, 保留 OUT-XX 行为规则', () => {
    const routings: FieldRoutingRow[] = [
      {
        agentId: 'test',
        fieldId: 'reply',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: false,
        promptRole: 'public-reply',
        valueType: 'string',
        notes: '面向用户的回复',
      },
      {
        agentId: 'test',
        fieldId: 'understanding.surface_goal',
        render: 'visible',
        handoff: ['path-agent'],
        internal: false,
        accumulate: false,
        promptRole: 'hard-required',
        valueType: 'string',
      },
      {
        agentId: 'test',
        fieldId: 'understanding.real_problem',
        render: 'visible',
        handoff: ['path-agent'],
        internal: false,
        accumulate: false,
        promptRole: 'hard-required',
        valueType: 'string',
      },
    ];

    const result = rewriteOutputSection(block, routings);
    expect(result.rewritten).toBe(true);
    expect(result.fieldsApplied).toBe(3);
    // OUT-XX 行为规则全部保留
    expect(result.body).toContain('OUT-01: 只输出一个合法 JSON 对象.');
    expect(result.body).toContain('OUT-02: 顶层字段固定为');
    expect(result.body).toContain('OUT-03: JSON 前后不能有任何前言.');
    // 嵌套路径生效
    expect(result.body).toContain('"understanding"');
    expect(result.body).toContain('"surface_goal"');
    expect(result.body).toContain('"real_problem"');
    // reply 字段在 (含 notes)
    expect(result.body).toContain('"reply"');
    expect(result.body).toContain('面向用户的回复');
  });
});

describe('prompt-compiler: compilePrompt 主流程', () => {
  const sampleSource = `## 身份定义

你是一个测试 skill.

## 输入说明

\`\`\`json
{
  "userInput": "用户输入"
}
\`\`\`

## 执行规则

RULE-01: 严格遵守.

## 输出规格

OUT-01: 只输出 JSON.

\`\`\`json
{
  "reply": "回复"
}
\`\`\`
`;

  it('无 routing 数据 → no-op, compiled = source', async () => {
    mockGetAgentRoutings.mockResolvedValue([]);
    const result = await compilePrompt(sampleSource, 'unknown-agent');
    expect(result.status).toBe('fresh');
    expect(result.compiled).toBe(sampleSource);
    expect(result.rewritten).toBe(false);
    expect(result.fieldsApplied).toBe(0);
    expect(result.sourceHash).toBeTruthy();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('有 output routing → 重写, 状态 fresh', async () => {
    mockGetAgentRoutings.mockResolvedValue([
      {
        agentId: 'test',
        fieldId: 'reply',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: false,
        promptRole: 'public-reply',
        valueType: 'string',
      },
      {
        agentId: 'test',
        fieldId: 'age',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: true,
        promptRole: 'soft-info',
        valueType: 'number',
        notes: '用户年龄',
      },
    ]);
    const result = await compilePrompt(sampleSource, 'test');
    expect(result.status).toBe('fresh');
    expect(result.rewritten).toBe(true);
    expect(result.fieldsApplied).toBe(2);
    // 新字段进入产物
    expect(result.compiled).toContain('"age"');
    expect(result.compiled).toContain('用户年龄');
    // 8 段不被破坏 (含 OUT-01 + RULE-01)
    expect(result.compiled).toContain('OUT-01: 只输出 JSON.');
    expect(result.compiled).toContain('RULE-01: 严格遵守.');
    expect(result.compiled).toContain('你是一个测试 skill.');
  });

  it('routing 数据相同 → 产物 hash 一致', async () => {
    const routing: FieldRoutingRow[] = [
      {
        agentId: 'test',
        fieldId: 'reply',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: false,
        promptRole: 'public-reply',
        valueType: 'string',
      },
    ];
    mockGetAgentRoutings.mockResolvedValue(routing);
    const a = await compilePrompt(sampleSource, 'test');
    mockGetAgentRoutings.mockResolvedValue(routing);
    const b = await compilePrompt(sampleSource, 'test');
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.compileContextHash).toBe(b.compileContextHash);
    expect(a.compiled).toBe(b.compiled);
  });

  it('源变 → sourceHash 变', async () => {
    mockGetAgentRoutings.mockResolvedValue([]);
    const a = await compilePrompt(sampleSource, 'test');
    const b = await compilePrompt(sampleSource + '\n// 修改\n', 'test');
    expect(a.sourceHash).not.toBe(b.sourceHash);
  });

  it('routing 变 → contextHash 变', async () => {
    mockGetAgentRoutings.mockResolvedValueOnce([]);
    const a = await compilePrompt(sampleSource, 'test');

    mockGetAgentRoutings.mockResolvedValueOnce([
      {
        agentId: 'test',
        fieldId: 'newField',
        render: 'visible',
        handoff: [],
        internal: false,
        accumulate: false,
        promptRole: 'soft-info',
        valueType: 'string',
      },
    ]);
    const b = await compilePrompt(sampleSource, 'test');

    expect(a.compileContextHash).not.toBe(b.compileContextHash);
  });

  it('getAgentRoutings 抛错 → status=failed, compiled=source 兜底', async () => {
    mockGetAgentRoutings.mockRejectedValue(new Error('DB unavailable'));
    const result = await compilePrompt(sampleSource, 'test');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('DB unavailable');
    expect(result.compiled).toBe(sampleSource);
  });

  it('routing key 顺序不同 → contextHash 一致 (stable)', async () => {
    const r1: FieldRoutingRow[] = [
      { agentId: 't', fieldId: 'a', render: 'visible', handoff: [], internal: false, accumulate: false, promptRole: 'soft-info', valueType: 'string' },
      { agentId: 't', fieldId: 'b', render: 'visible', handoff: [], internal: false, accumulate: false, promptRole: 'soft-info', valueType: 'string' },
    ];
    const r2: FieldRoutingRow[] = [r1[1], r1[0]]; // 颠倒顺序

    mockGetAgentRoutings.mockResolvedValueOnce(r1);
    const a = await compilePrompt(sampleSource, 'test');
    mockGetAgentRoutings.mockResolvedValueOnce(r2);
    const b = await compilePrompt(sampleSource, 'test');

    expect(a.compileContextHash).toBe(b.compileContextHash);
  });
});
