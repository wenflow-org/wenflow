/**
 * Prompt Schema v2 解析器测试
 * ============================================================
 * 1. 保真往返护栏：对 prompts/*.md 全量做 parse → compose → parse，
 *    断言关键块内容稳定（归一化空白后），确保解析器不毁 prompt。
 * 2. 新协议特性单测：8 块归类、H3 状态机提升、wf-* 块解析、编号双兼容。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parsePromptSchema,
  composePromptSchema,
  parseRuleItems,
  classifyHeading,
  nextRuleId,
} from '../index';

const PROMPTS_DIR = path.resolve(__dirname, '../../../../../prompts');

function loadPromptBodies(): Array<{ name: string; body: string }> {
  if (!fs.existsSync(PROMPTS_DIR)) return [];
  return fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => /^skill\..*\.md$/.test(f))
    .map((f) => {
      const raw = fs.readFileSync(path.join(PROMPTS_DIR, f), 'utf-8').replace(/\r\n/g, '\n');
      // 去掉 frontmatter，只取正文
      const m = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(raw);
      return { name: f, body: (m ? m[1] : raw).trim() };
    })
    .filter((x) => x.body.length > 20); // 跳过 code-only 空壳
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('prompt-schema v2: 保真往返护栏', () => {
  const files = loadPromptBodies();

  it('能找到 prompt 文件', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  files.forEach(({ name, body }) => {
    it(`parse→compose 稳定: ${name}`, () => {
      const schema1 = parsePromptSchema(body);
      const recomposed = composePromptSchema(schema1);
      const schema2 = parsePromptSchema(recomposed);

      // 二次解析的块数与类型序列应稳定
      expect(schema2.blocks.map((b) => b.section)).toEqual(
        schema1.blocks.map((b) => b.section)
      );

      // identity / output 内容归一化后等价
      expect(normalize(schema2.identity)).toBe(normalize(schema1.identity));
      expect(normalize(schema2.output)).toBe(normalize(schema1.output));

      // 编号项集合稳定
      expect(schema2.rules.map((r) => r.id).sort()).toEqual(
        schema1.rules.map((r) => r.id).sort()
      );
    });
  });
});

describe('prompt-schema v2: 块归类', () => {
  it('标准段名归类', () => {
    expect(classifyHeading('身份定义')).toBe('identity');
    expect(classifyHeading('输入说明')).toBe('input');
    expect(classifyHeading('执行规则')).toBe('rules');
    expect(classifyHeading('输出规格')).toBe('output');
    expect(classifyHeading('边界约束')).toBe('constraints');
    expect(classifyHeading('质量控制')).toBe('quality');
    expect(classifyHeading('示例')).toBe('examples');
    expect(classifyHeading('状态机')).toBe('state_machine');
  });

  it('阶段定义归 state_machine（不被 rules 抢）', () => {
    expect(classifyHeading('阶段定义')).toBe('state_machine');
    expect(classifyHeading('阶段推进门槛')).toBe('state_machine');
  });

  it('质量控制不再落 extras', () => {
    const schema = parsePromptSchema('## 身份定义\n你是X\n\n## 质量控制\nQC-01: 自检。');
    expect(schema.blocks.some((b) => b.section === 'quality')).toBe(true);
    expect(schema.quality).toContain('自检');
  });
});

describe('prompt-schema v2: H3 状态机提升', () => {
  it('rules 块下的 ### 阶段定义 被提升为 state_machine', () => {
    const text = [
      '## 身份定义',
      '你是X。',
      '',
      '## 执行规则',
      '',
      '### 上下文规则',
      'RULE-01: 规则一。',
      '',
      '### 阶段定义',
      '- understanding: 澄清',
      '- proposing: 提议',
      '',
      '## 输出规格',
      'OUT-01: 只输出 JSON。',
    ].join('\n');
    const schema = parsePromptSchema(text);
    const sm = schema.blocks.find((b) => b.section === 'state_machine');
    expect(sm).toBeDefined();
    expect(sm!.promotedFromH3).toBe(true);
    expect(sm!.body).toContain('understanding');
    // rules 块仍保留非阶段子段
    const rules = schema.blocks.find((b) => b.section === 'rules');
    expect(rules!.body).toContain('上下文规则');
    expect(rules!.body).not.toContain('understanding: 澄清');
  });
});

describe('prompt-schema v2: wf-* 结构块', () => {
  it('解析 wf-output 字段（类型/耦合度/枚举/语义）', () => {
    const text = [
      '## 输出规格',
      '',
      '```wf-output',
      'reply : string | prose | 给用户的回复',
      'state.stage : enum(understanding|proposing|ready) | contract | 当前阶段',
      'understanding.surface_goal : string | prose | 必须保留原话',
      '```',
    ].join('\n');
    const schema = parsePromptSchema(text);
    expect(schema.wfBlocks.length).toBe(1);
    const wf = schema.wfBlocks[0];
    expect(wf.kind).toBe('wf-output');
    expect(wf.fields.length).toBe(3);

    const stage = wf.fields.find((f) => f.path === 'state.stage')!;
    expect(stage.valueType).toBe('enum(understanding|proposing|ready)');
    expect(stage.enumValues).toEqual(['understanding', 'proposing', 'ready']);
    expect(stage.coupling).toBe('contract');

    const reply = wf.fields.find((f) => f.path === 'reply')!;
    expect(reply.coupling).toBe('prose');
    expect(reply.note).toBe('给用户的回复');
  });

  it('解析 wf-state（无类型列）', () => {
    const text = [
      '## 状态机',
      '',
      '```wf-state',
      'understanding : contract | 继续澄清',
      'ready : contract | 已确认',
      '# 推进门槛引用 field_definitions',
      '```',
    ].join('\n');
    const schema = parsePromptSchema(text);
    expect(schema.wfBlocks.length).toBe(1);
    const wf = schema.wfBlocks[0];
    expect(wf.kind).toBe('wf-state');
    expect(wf.fields.map((f) => f.path)).toEqual(['understanding', 'ready']);
    expect(wf.fields[0].coupling).toBe('contract');
    expect(wf.comments[0]).toContain('field_definitions');
  });
});

describe('prompt-schema v2: 编号双兼容', () => {
  it('解析旧式 R-G-01 与子规则 R-G-20.1', () => {
    const items = parseRuleItems('R-G-01: 一。\nR-G-20.1: 子规则。');
    expect(items[0]).toMatchObject({ id: 'R-G-01', prefix: 'G', index: 1, style: 'legacy' });
    expect(items[1]).toMatchObject({ id: 'R-G-20.1', index: 20, sub: 1, style: 'legacy' });
  });

  it('解析新式 RULE-01 / OUT-03 / STATE-01', () => {
    const items = parseRuleItems('RULE-01: 一。\nOUT-03: 三。\nSTATE-01: 阶段。');
    expect(items[0]).toMatchObject({ id: 'RULE-01', prefix: 'RULE', index: 1, style: 'block' });
    expect(items[1]).toMatchObject({ id: 'OUT-03', prefix: 'OUT', index: 3, style: 'block' });
    expect(items[2]).toMatchObject({ id: 'STATE-01', prefix: 'STATE', style: 'block' });
  });

  it('nextRuleId 按块前缀递增', () => {
    const items = parseRuleItems('RULE-01: a\nRULE-02: b');
    expect(nextRuleId(items, 'RULE', 'block')).toBe('RULE-03');
    expect(nextRuleId([], 'OUT', 'block')).toBe('OUT-01');
    expect(nextRuleId(items, 'G', 'legacy')).toBe('R-G-01');
  });
});

describe('prompt-schema v2: JSON schema 即字段真相源（outputFields）', () => {
  it('从 ## 输出规格 的 ```json``` 示例抽出字段树（枚举/范围/嵌套/数组）', () => {
    const text = [
      '## 输出规格',
      '',
      '只输出 JSON。',
      '',
      '```json',
      '{',
      '  "reply": "给用户的回复",',
      '  "analysis": {',
      '    "cognitiveLevel": "remember|understand|apply",',
      '    "levelScore": 1-6',
      '  },',
      '  "points": [{ "name": "...", "status": "pending|mastered" }]',
      '}',
      '```',
    ].join('\n');
    const schema = parsePromptSchema(text);
    const byPath = (p: string) => schema.outputFields.find((f) => f.path === p)!;

    expect(schema.outputFields.length).toBeGreaterThanOrEqual(6);

    expect(byPath('reply').valueType).toBe('string');
    expect(byPath('reply').note).toBe('给用户的回复');

    const lvl = byPath('analysis.cognitiveLevel');
    expect(lvl.valueType).toBe('enum(remember|understand|apply)');
    expect(lvl.enumValues).toEqual(['remember', 'understand', 'apply']);

    expect(byPath('analysis.levelScore').valueType).toBe('number');
    expect(byPath('analysis.levelScore').note).toContain('1-6');

    // 数组元素用 [] 路径
    expect(byPath('points[].status').valueType).toBe('enum(pending|mastered)');
  });

  it('省略号占位 [ ... ] / ... 不破坏解析', () => {
    const text = [
      '## 输出规格',
      '```json',
      '{ "milestones": [ { "title": "...", "items": [ ... ] } ] }',
      '```',
    ].join('\n');
    const schema = parsePromptSchema(text);
    expect(schema.outputFields.find((f) => f.path === 'milestones[].title')).toBeTruthy();
  });

  it('无 ```json``` 块时 outputFields 为空（优雅降级）', () => {
    const schema = parsePromptSchema('## 输出规格\n\n只输出一段白话文案，不要 JSON。');
    expect(schema.outputFields).toEqual([]);
  });
});
