import {
  classifyActionFamilies,
  detectCrossStageActionRepeat,
} from '../stage-cross-stage-action';

const stage1 = [
  {
    title: '逐句拆一段「像 agent」的答疑回答，指认每一句是谁在干活',
    description: '把四件东西对上号，指出哪一步在判断。',
  },
  {
    title: '把工具和上下文记录各抽掉一次，看这一回合从哪一句开始露馅',
    description: '对比拿掉组件前后的差异。',
  },
];

describe('detectCrossStageActionRepeat', () => {
  it('阶段 2 只是换一段记录重做「指认组件 + 抽掉组件」→ 判重复', () => {
    const stage2 = [
      {
        title: '对着学生问补交作业的记录，逐轮认出判断、调工具、带结果回来作答',
        description: '逐轮指认哪一步在判断。',
      },
      {
        title: '两段短记录摆一起：各缺哪一件，系统为什么自己发现不了',
        description: '对比两段记录缺了哪件。',
      },
    ];
    const result = detectCrossStageActionRepeat(stage2, stage1);
    expect(result.repeated).toBe(true);
    expect(result.repeatedFamilies.sort()).toEqual(['diagnose', 'identify']);
    expect(result.previousExamples.length).toBeGreaterThan(0);
  });

  it('阶段 2 引入设计/映射动作 → 放行', () => {
    const stage2 = [
      {
        title: '把你的教育场景映射成 Agent 架构图：记忆、知识库、工具分别对应什么',
        description: '画出架构并标注每一层。',
      },
      {
        title: '按论文要求写一段工作流说明',
        description: '产出可直接放进开题的概念说明。',
      },
    ];
    expect(detectCrossStageActionRepeat(stage2, stage1).repeated).toBe(false);
  });

  it('阶段 2 是综合实战/新情形迁移 → 放行', () => {
    const stage2 = [
      {
        title: '换一个新场景综合实战：判断这条 Agent 工作流会先断在哪',
        description: '把前两阶段的口径用到没见过的情形。',
      },
    ];
    expect(detectCrossStageActionRepeat(stage2, stage1).repeated).toBe(false);
  });

  it('阶段 3 在低代码平台搭原型 → 算引入「搭建/配置」新动作族', () => {
    const stage2 = [
      { title: '把你的教育场景映射成 Agent 架构图：记忆、知识库、工具分别对应什么' },
    ];
    const stage3 = [
      {
        title: '在扣子或 Dify 里搭出第一个能回答的前测助手：工作流、知识库、插件、系统提示各放一处，跑通一次',
      },
    ];
    expect(detectCrossStageActionRepeat(stage3, [...stage1, ...stage2]).repeated).toBe(false);
  });

  it('「配置平台并跑通」归到搭建/配置，不与纸上设计混为一族', () => {
    const families = classifyActionFamilies({ title: '在低代码平台里配置知识库与插件并跑通' });
    expect([...families]).toContain('build');
    expect([...families]).not.toContain('design');
  });

  it('没有前序任务或当前任务无法归类 → 不判重复', () => {
    expect(detectCrossStageActionRepeat(stage1, []).repeated).toBe(false);
    expect(detectCrossStageActionRepeat([{ title: '读一读这份材料' }], stage1).repeated).toBe(false);
  });

  it('动作族归类覆盖标准链路', () => {
    expect([...classifyActionFamilies({ title: '逐轮认出哪一步在调工具' })]).toContain('identify');
    expect([...classifyActionFamilies({ title: '抽掉工具看它从哪里露馅' })]).toContain('diagnose');
    expect([...classifyActionFamilies({ title: '把原理映射成架构图' })]).toContain('design');
    expect([...classifyActionFamilies({ title: '写一段答辩用的工作流说明' })]).toContain('produce');
    expect([...classifyActionFamilies({ title: '拿新情形综合实战一次' })]).toContain('transfer');
  });
});
