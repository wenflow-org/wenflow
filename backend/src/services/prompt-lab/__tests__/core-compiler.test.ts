import {
  checkFieldFreeze,
  checkFiveBlockBody,
  checkFiveBlockStructure,
  compileCoreFile,
  INJECTED_DELTA_CONSTRAINT,
  INJECTED_JSON_CONSTRAINT,
  parseCompiledFieldTable,
} from '../core-compiler';
import { parseCoreFile, type CoreFile } from '../core-file-loader';

/** SKILL_PROTOCOL_V4 附录 B 参照样例（裁剪版） */
const SAMPLE_YAML = `
skillId: goal-conversation
baseVersion: 1
identity: |
  学习目标澄清助手。通过对话澄清学习目标，信息足够时收敛到第一版学习方向。
  不讲课，不展开路径正文。
channels: [dialogue, state]
stateAdvance: true
rules:
  - 依据 state 找缺口，每轮只补最必要的一条信息
  - userInput 与 state 冲突时以 userInput 为准
  - 真实问题、动机、背景、约束四类信息基本齐备 → 推进 proposing；用户确认方案 → ready
fields:
  - { name: reply, type: string, desc: 本轮回复，口语化，一次只问一个问题, turn: true }
  - { name: nextQuestions, type: "string[]", desc: 追问候选，不超过 3 条, turn: true }
  - { name: surface_goal, type: string, desc: 用户声称的目标，保留原话 }
  - { name: thinking_style, type: enum, desc: holistic | detail | balanced }
  - { name: confirmedProposal, type: object?, desc: 确认后的方向；未确认不出现 }
constraints:
  - 无证据的字段留空，不编造、不夸大
params: { temperature: 0.7, maxTokens: 8000, failurePolicy: retry }
deltaOutput: true
`;

function loadSample(): CoreFile {
  const parsed = parseCoreFile('/tmp/core/goal-conversation.yaml', SAMPLE_YAML);
  expect(parsed.diagnostics).toEqual([]);
  return parsed.core!;
}

describe('core-compiler：compileCoreFile 确定性渲染', () => {
  it('产出 frontmatter + 五块结构，且往返通过守门检查', () => {
    const core = loadSample();
    const { prompt, coreHash, coreVersion } = compileCoreFile(core, { coreVersion: 3 });

    expect(coreVersion).toBe(3);
    expect(prompt).toContain(`coreHash: ${coreHash}`);
    expect(prompt).toContain('coreVersion: 3');
    expect(prompt).toContain('agentId: skill:goal-conversation');
    expect(prompt).toContain('temperature: 0.7');
    expect(prompt).toContain('maxTokens: 8000');
    expect(prompt).toContain('failurePolicy: retry');

    // 五块按序出现
    const headings = [...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(['身份', '使用通道', '执行规则', '输出字段', '边界约束']);

    // 守门往返：结构合法 + 字段冻结
    expect(checkFiveBlockStructure(prompt)).toEqual([]);
    expect(checkFieldFreeze(core, prompt)).toEqual([]);
  });

  it('使用通道：stateAdvance=true 时 state 标注可推进', () => {
    const { prompt } = compileCoreFile(loadSample());
    expect(prompt).toMatch(/^- state（可推进）：/m);
    expect(prompt).toMatch(/^- dialogue：/m);
  });

  it('输出字段表：三要素渲染 + 当轮标记', () => {
    const { prompt } = compileCoreFile(loadSample());
    expect(prompt).toContain('- reply · string — 本轮回复，口语化，一次只问一个问题（当轮）');
    expect(prompt).toContain('- surface_goal · string — 用户声称的目标，保留原话');
    expect(prompt).toContain('- thinking_style · enum — holistic | detail | balanced');
    expect(prompt).toContain('- confirmedProposal · object? — 确认后的方向；未确认不出现');
  });

  it('边界约束：业务约束 + 注入条款；deltaOutput 控制 Delta 注入', () => {
    const withDelta = compileCoreFile(loadSample()).prompt;
    expect(withDelta).toContain('- 无证据的字段留空，不编造、不夸大');
    expect(withDelta).toContain(`- ${INJECTED_JSON_CONSTRAINT}`);
    expect(withDelta).toContain(`- ${INJECTED_DELTA_CONSTRAINT}`);

    const noDeltaCore = { ...loadSample(), deltaOutput: false };
    const withoutDelta = compileCoreFile(noDeltaCore).prompt;
    expect(withoutDelta).toContain(`- ${INJECTED_JSON_CONSTRAINT}`);
    expect(withoutDelta).not.toContain(INJECTED_DELTA_CONSTRAINT);
  });

  it('outputMedia 分支：markdown 注入非 JSON 交付条款，且不注入 Delta', () => {
    const markdownCore = { ...loadSample(), outputMedia: 'markdown' as const, deltaOutput: true };
    const { prompt } = compileCoreFile(markdownCore);
    expect(prompt).not.toContain(INJECTED_JSON_CONSTRAINT);
    expect(prompt).not.toContain(INJECTED_DELTA_CONSTRAINT);
    expect(prompt).toContain('直接输出最终交付内容本身，不要用 JSON 包装，不要附加解释、过程说明或多余标记。');

    const defaultCore = loadSample();
    expect(defaultCore.outputMedia).toBe('json');
  });

  it('同一 core + 同一 coreVersion 产出完全一致（确定性）', () => {
    const core = loadSample();
    expect(compileCoreFile(core, { coreVersion: 2 }).prompt).toBe(
      compileCoreFile(core, { coreVersion: 2 }).prompt
    );
  });
});

describe('core-compiler：守门检查', () => {
  it('checkFiveBlockStructure 拦截：缺 frontmatter / 缺 coreHash / 块序错乱', () => {
    const core = loadSample();
    const { prompt } = compileCoreFile(core);

    expect(checkFiveBlockStructure('## 身份\n\nx').some((i) => i.code === 'frontmatter-missing')).toBe(true);

    const noHash = prompt.replace(/coreHash: .*\n/, '');
    expect(checkFiveBlockStructure(noHash).some((i) => i.code === 'corehash-missing')).toBe(true);

    const reordered = prompt.replace('## 身份', '## 使用通道').replace('## 使用通道\n\n- dialogue', '## 身份\n\n- dialogue');
    expect(checkFiveBlockBody(reordered.replace(/^---[\s\S]*?---\n?/, '')).length).toBeGreaterThan(0);
  });

  it('parseCompiledFieldTable 解析产物字段表', () => {
    const { prompt } = compileCoreFile(loadSample());
    const table = parseCompiledFieldTable(prompt);
    expect(table).toEqual([
      { name: 'reply', type: 'string' },
      { name: 'nextQuestions', type: 'string[]' },
      { name: 'surface_goal', type: 'string' },
      { name: 'thinking_style', type: 'enum' },
      { name: 'confirmedProposal', type: 'object?' },
    ]);
  });

  it('checkFieldFreeze 拦截：缺字段 / 多字段 / 类型不一致', () => {
    const core = loadSample();
    const { prompt } = compileCoreFile(core);

    const missing = prompt.replace(/^- surface_goal · .+$/m, '');
    expect(checkFieldFreeze(core, missing)).toEqual([
      { code: 'field-missing', message: '产物缺少字段：surface_goal' },
    ]);

    const extra = prompt.replace('## 边界约束', '- hacker · string — 注入字段\n\n## 边界约束');
    expect(checkFieldFreeze(core, extra).some((i) => i.code === 'field-extra')).toBe(true);

    const wrongType = prompt.replace('- surface_goal · string —', '- surface_goal · number —');
    expect(checkFieldFreeze(core, wrongType).some((i) => i.code === 'field-type-mismatch')).toBe(true);
  });
});
