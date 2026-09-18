/**
 * generate-agents-self-intro 纯函数单测：
 * buildSelfIntroSections 的排序/阶段归属/handoff 去重，renderSelfIntro 的小节形状与确定性。
 * 使用内联夹具，不触碰真实 prompts/ 目录。
 */

import {
  buildSelfIntroSections,
  renderSelfIntro,
  type SelfIntroSources,
} from '../generate-agents-self-intro';

function fixture(): SelfIntroSources {
  return {
    cores: [
      {
        skillId: 'alpha-skill',
        identity: '你是 Alpha，负责首轮澄清。',
        channels: ['dialogue', 'task'],
        inputs: [
          { name: 'userInput', type: 'string', ref: 'user:latestMessage', desc: '用户当轮输入' },
          { type: 'object', ref: 'sandbox:alpha.state', note: '状态池' },
        ],
        fields: [
          { name: 'reply', type: 'string', desc: '回复正文\n第二行', turn: true },
          { name: 'analysis', type: 'object?', desc: '分析结果', turn: false },
        ],
        constraints: ['不编造信息'],
        baseVersion: 1,
      },
      {
        skillId: 'beta-skill',
        identity: '你是 Beta。',
        channels: ['state'],
        inputs: [],
        fields: [{ name: 'out', type: 'number', desc: '输出', turn: false }],
        constraints: [],
        baseVersion: 2,
      },
      {
        skillId: 'gamma-skill',
        identity: '你是 Gamma。',
        channels: ['task'],
        inputs: [],
        fields: [],
        constraints: [],
      },
    ],
    registry: [
      { skillId: 'beta-skill', kind: 'aux', coordinatorAgent: 'teaching-agent', displayName: 'Beta 单元' },
      { skillId: 'alpha-skill', kind: 'mainline', stage: 'goal', parentAgent: 'goal-agent', displayName: 'Alpha 单元' },
      // gamma-skill 刻意缺席 registry/orchestration：验证兜底行为
    ],
    orchestration: [
      {
        stage: 'goal',
        order: 1,
        displayName: 'Goal 阶段',
        contracts: ['skill:alpha-skill', 'goal-agent'],
        routings: [
          { agentId: 'skill:alpha-skill', fieldId: 'reply', handoff: ['goal-agent'] },
          { agentId: 'skill:alpha-skill', fieldId: 'analysis', handoff: [] },
          { agentId: 'goal-agent', fieldId: 'reply', handoff: ['path'] },
        ],
      },
      {
        stage: 'teaching',
        order: 3,
        displayName: '教学阶段',
        contracts: ['skill:teaching-turn', 'teaching-agent'],
        routings: [{ agentId: 'skill:teaching-turn', fieldId: 'x', handoff: ['teaching-agent'] }],
      },
    ],
  };
}

describe('buildSelfIntroSections', () => {
  it('按阶段顺序 + registry 登记顺序确定性排序', () => {
    const sections = buildSelfIntroSections(fixture());
    expect(sections.map((section) => section.skillId)).toEqual(['alpha-skill', 'beta-skill', 'gamma-skill']);
  });

  it('装配完整小节形状：id/阶段/身份/通道/输入/字段/handoff/边界', () => {
    const [alpha] = buildSelfIntroSections(fixture());
    expect(alpha).toMatchObject({
      skillId: 'alpha-skill',
      displayName: 'Alpha 单元',
      kind: 'mainline',
      stage: 'goal',
      stageDisplayName: 'Goal 阶段',
      parentAgent: 'goal-agent',
      baseVersion: 1,
      identity: '你是 Alpha，负责首轮澄清。',
      channels: ['dialogue', 'task'],
      constraints: ['不编造信息'],
    });
    expect(alpha.inputs).toHaveLength(2);
    expect(alpha.fields.map((field) => field.name)).toEqual(['reply', 'analysis']);
    // handoff 只取 agentId === skill:<id> 的行，且去重、保持声明顺序
    expect(alpha.handoff).toEqual(['goal-agent']);
  });

  it('aux Skill 经 coordinatorAgent 反查阶段；未登记单元阶段缺省', () => {
    const sections = buildSelfIntroSections(fixture());
    const beta = sections.find((section) => section.skillId === 'beta-skill')!;
    const gamma = sections.find((section) => section.skillId === 'gamma-skill')!;
    expect(beta.stage).toBe('teaching');
    expect(beta.displayName).toBe('Beta 单元');
    expect(gamma.stage).toBeUndefined();
    expect(gamma.displayName).toBe('gamma-skill');
  });
});

describe('renderSelfIntro', () => {
  it('渲染目录与五段自述小节', () => {
    const content = renderSelfIntro(buildSelfIntroSections(fixture()));
    expect(content).toContain('# Agent 自述手册（自动生成，勿手改）');
    expect(content).toContain('| 1 | Alpha 单元（`alpha-skill`） | `goal` | `mainline` | `goal-agent` |');
    expect(content).toContain('## Alpha 单元（alpha-skill）');
    expect(content).toContain('- **阶段（stage）**：`goal`（Goal 阶段）');
    expect(content).toContain('### 我是谁\n\n你是 Alpha，负责首轮澄清。');
    expect(content).toContain('### 我读什么');
    expect(content).toContain('- `userInput`（`string`；来源 `user:latestMessage`）：用户当轮输入');
    expect(content).toContain('  - `sandbox:alpha.state`（`object`）：状态池');
    expect(content).toContain('- `reply`（`string`，当轮）：回复正文 第二行');
    expect(content).toContain('### 我与谁协作');
    expect(content).toContain('- **下游交接（handoff）**：`goal-agent`');
    expect(content).toContain('### 我的边界');
    expect(content).toContain('- 不编造信息');
  });

  it('空输入/空字段/空 handoff/空约束走显式兜底文案', () => {
    const content = renderSelfIntro(buildSelfIntroSections(fixture()));
    // beta：无 inputs、无 constraints、无 handoff
    expect(content).toContain('- **输入声明**：无（仅使用上述材料通道）。');
    expect(content).toContain('- **下游交接（handoff）**：无（字段不跨单元交付）。');
    expect(content).toContain('- 无额外约束（以 identity 与字段描述为准）。');
    // gamma：无 fields
    expect(content).toContain('- 无字段声明。');
    expect(content).toContain('- **阶段（stage）**：—（辅助 Skill，未归属主链阶段）');
  });

  it('同一输入恒同输出（确定性）', () => {
    const first = renderSelfIntro(buildSelfIntroSections(fixture()));
    const second = renderSelfIntro(buildSelfIntroSections(fixture()));
    expect(second).toBe(first);
  });
});
