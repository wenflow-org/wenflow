import {
  assessPlanningSourceHonesty,
  assessStageMetaLessons,
  assessStageNarration,
  dropCrossStageDuplicates,
  isMetaOnlySubtask,
} from '../stage-subtask-quality';

describe('isMetaOnlySubtask（伪课判据）', () => {
  // 正例：2026-11-02 实测路径 lp_1793609520322_a52ld7g 里真实的 5 节伪课
  const REAL_META_LESSONS = [
    '整理两列对照卡：现在完成时 vs 一般过去时',
    '错题归因并整理成判别卡',
    '归因错题并合并进索引卡',
    '把两个阶段的错题合并成一张判别卡',
    '写一张时态自检表',
  ];

  it.each(REAL_META_LESSONS)('实测伪课命中：%s', (title) => {
    expect(isMetaOnlySubtask({ title })).toBe(true);
  });

  // 负例：把「卡/表/清单」当工具的真实学习课，不判伪课
  const REAL_LEARNING_TASKS = [
    { title: '用两步卡拆解现在完成时的时间轴', description: '跟着例题一步步走' },
    { title: '限时做一组 20 道时态选择题', description: '限时 15 分钟，做完对照解析' },
    { title: '朗读并跟读 6 个句子，标出重音', description: '逐句朗读' },
    { title: '用木桶短板解释暖棚菜为什么长得慢' },
    { title: '写代码实现一个 LRU 缓存并调试边界' },
  ];

  it.each(REAL_LEARNING_TASKS)('真实学习任务不误判：$title', (task) => {
    expect(isMetaOnlySubtask(task)).toBe(false);
  });

  it('元动作只是伴随环节（题干带练习对象）不算伪课', () => {
    expect(isMetaOnlySubtask({
      title: '整理错题清单',
      description: '把这份 30 道真题里做错的挑出来，逐题写错因',
    })).toBe(false);
  });

  it('空标题直接放行，不参与判定', () => {
    expect(isMetaOnlySubtask({ title: '' })).toBe(false);
    expect(isMetaOnlySubtask({})).toBe(false);
  });
});

describe('assessStageMetaLessons（阶段级）', () => {
  it('单节收口课允许通过（≥2 才判违规）', () => {
    const result = assessStageMetaLessons([
      { title: '整理两列对照卡：现在完成时 vs 一般过去时' },
      { title: '限时做一组 20 道时态选择题' },
      { title: '写一段自我介绍并朗读' },
    ]);
    expect(result.valid).toBe(true);
  });

  it('实测阶段 4（5 节中 3 节伪课）判违规并列出命中的任务序号', () => {
    const result = assessStageMetaLessons([
      { title: '归因错题并整理成判别卡' },
      { title: '把两个阶段的错题合并成一张判别卡' },
      { title: '限时完成一套整卷模考' },
      { title: '写一张时态自检表' },
      { title: '朗读真题范文并标注连读' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('META_ONLY_LESSONS_STAGE');
    expect(result.violations).toHaveLength(3);
    expect(result.violations?.[0]).toContain('任务 1');
  });

  it('空阶段不报违规', () => {
    expect(assessStageMetaLessons([]).valid).toBe(true);
  });
});

describe('dropCrossStageDuplicates（跨阶段复读删除）', () => {
  it('删除后一阶段与前序阶段近似同题的任务', () => {
    const { stages, dropped } = dropCrossStageDuplicates([
      {
        stageNumber: 1,
        subtasks: [
          { title: '回放被岔开的对话，定位非谓语动词误用' },
          { title: '用两步卡拆解不定式与动名词' },
          { title: '限时做 10 道非谓语动词选择题' },
        ],
      },
      {
        stageNumber: 3,
        subtasks: [
          { title: '回放被岔开的对话，复查非谓语动词' },
          { title: '限时做 10 道虚拟语气选择题' },
        ],
      },
    ]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].stageNumber).toBe(3);
    expect(dropped[0].duplicateOfStage).toBe(1);
    expect(stages[1].subtasks).toHaveLength(1);
    expect(stages[1].subtasks[0].title).toContain('虚拟语气');
    // 前序阶段一颗不动
    expect(stages[0].subtasks).toHaveLength(3);
  });

  it('同阶段内重复不归本闸（交给 detectStageFiller）', () => {
    const { dropped } = dropCrossStageDuplicates([
      {
        stageNumber: 1,
        subtasks: [
          { title: '综合自测与查漏：时态综合' },
          { title: '综合自测与查漏：时态综合' },
        ],
      },
    ]);
    expect(dropped).toHaveLength(0);
  });

  it('跨阶段但不同题不解锁删除', () => {
    const { dropped, stages } = dropCrossStageDuplicates([
      { stageNumber: 1, subtasks: [{ title: '用两步卡拆解现在完成时的时间轴' }] },
      { stageNumber: 2, subtasks: [{ title: '限时做一组 20 道时态辨析题' }] },
    ]);
    expect(dropped).toHaveLength(0);
    expect(stages[1].subtasks).toHaveLength(1);
  });

  it('单阶段删除量不超过一半且保底留 1 条', () => {
    const { stages, dropped } = dropCrossStageDuplicates([
      {
        stageNumber: 1,
        subtasks: [
          { title: '回放被岔开的对话一' },
          { title: '回放被岔开的对话二' },
        ],
      },
      {
        stageNumber: 2,
        subtasks: [
          { title: '回放被岔开的对话一' },
          { title: '回放被岔开的对话二' },
          { title: '读一篇短文并复述' },
        ],
      },
    ]);
    // 3 条 × 0.5 → 最多删 1 条
    expect(dropped).toHaveLength(1);
    expect(stages[1].subtasks.length).toBeGreaterThanOrEqual(2);
  });

  it('输出保持入参阶段顺序（下游按 id/序号取用）', () => {
    const input = [
      { stageNumber: 3, subtasks: [{ title: 'c' }] },
      { stageNumber: 1, subtasks: [{ title: 'a' }] },
      { stageNumber: 2, subtasks: [{ title: 'b' }] },
    ];
    const { stages } = dropCrossStageDuplicates(input);
    expect(stages.map((s) => s.stageNumber)).toEqual([3, 1, 2]);
  });
});

describe('isMetaOnlySubtask 泛「卡」制品（2026-11-02 回归：旧词表漏判）', () => {
  it.each([
    '把两步判别整理成一张时态判别卡',
    '按错题归因修订判别卡并定稿',
    '产出《下次做题自检卡》：三条动作与一条个人高频防线',
  ])('命中：%s', (title) => {
    expect(isMetaOnlySubtask({ title })).toBe(true);
  });

  it('把卡当工具但题干含练习对象 → 不命中', () => {
    expect(isMetaOnlySubtask({ title: '用两步卡做 10 道时态选择题并写出排除理由' })).toBe(false);
    expect(isMetaOnlySubtask({ title: '用两步卡限时做完一套模考并逐题归因' })).toBe(false);
  });
});

describe('assessStageNarration（2026-11-12 题面叙事护栏）', () => {
  it('题面泄露答案（「注意…不是…而是…」）→ 命中', () => {
    const result = assessStageNarration([
      {
        title: '定位关键转折',
        description: '对照板书逐帧读一遍。注意：关键信息在第 2 轮，而不是轮 7。',
        acceptanceHint: '能说出结论出自哪一轮',
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('TASK_NARRATION_GUARD');
    expect(result.violations?.[0]).toContain('把答案写进了题面');
  });

  it('2026-11-12 实测原句（跑步咨询「不是轮 X 而是轮 Y」）→ 命中', () => {
    const result = assessStageNarration([
      {
        title: '找信息最早的帧',
        description: '看「今天跑多远」这句，光凭这一句推不出 30 公里。板上扫一眼，30 这个数最早落在哪一帧？注意信息不在轮7，而是来自轮2。',
      },
    ]);
    expect(result.valid).toBe(false);
  });

  it('定位题同一阶段出现 ≥2 个 → 命中（这类问法整条路径最多 1 次）', () => {
    const result = assessStageNarration([
      { title: '定位一', description: '先找出客户顾虑最早出现在第几轮。' },
      { title: '定位二', description: '找出承诺变化最早出现在哪一轮。' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations?.join('')).toContain('定位任务');
  });

  it('无材料却宣称「真实对话/真实记录」→ 命中', () => {
    const result = assessStageNarration([
      { title: '读真实对话', description: '下面是一段真实对话记录，逐轮标注信息归属。' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations?.join('')).toContain('真实');
  });

  it('有材料引用或明确称「示例」→ 不命中', () => {
    const clean = assessStageNarration(
      [
        {
          title: '逐轮标注信息归属',
          description: '读示例对话的 8 轮记录，每轮标注它贡献了哪条信息。',
          materialRefs: [{ sectionId: 's1', quote: '对话记录' }],
        },
      ],
      { hasMaterials: true },
    );
    expect(clean.valid).toBe(true);
  });

  it('单个定位题 + 正常描述 → 不命中（定位题允许 1 个）', () => {
    const ok = assessStageNarration([
      { title: '定位首次出现', description: '找出「备赛周期」最早出现在第几轮，并说明它后来被如何引用。' },
    ]);
    expect(ok.valid).toBe(true);
  });
});

describe('assessStageNarration 增补（2026-11-12 外评：标题剧透/同例复读）', () => {
  it('标题写成结论陈述句（「只会…动手的是…」）→ 命中谜底', () => {
    const result = assessStageNarration([
      { title: '模型只会说出「调用哪把工具」那句话，动手的是外面那层程序', description: '对照一段调用记录拆开看。' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations?.join('')).toContain('剧透谜底');
  });

  it('标题写「动作+悬念」→ 不命中', () => {
    const ok = assessStageNarration([
      { title: '拆开一次查天气的后台记录，看清模型与外部程序怎么接力', description: '逐行读这段记录，标出每一步是谁在动。' },
    ]);
    expect(ok.valid).toBe(true);
  });

  it('description 指名复用前面任务的主教材（「回到任务 1 那段」）→ 命中同例复读', () => {
    const result = assessStageNarration([
      { title: '换个问法再判一次', description: '回到任务 1 那段天气调用记录，再对着两条新样例比一比。' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations?.join('')).toContain('同例复读');
  });
});

describe('assessPlanningSourceHonesty（规划层来源诚实）', () => {
  it('无材料时 summary/goal 宣称「真实记录」→ 命中并要求示例措辞', () => {
    const result = assessPlanningSourceHonesty({
      summary: '拿 AutoGPT 的公开跑偏记录、插件与工具调用的真实记录当样本',
      milestones: [
        { title: '看清文本', description: '机制讲解', goal: '对照一次真实问答，能指出模型读到了什么' },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('PLANNING_SOURCE_HONESTY');
    expect(result.violations?.length).toBe(2);
  });

  it('示例措辞 + 有材料 → 通过', () => {
    expect(assessPlanningSourceHonesty({
      summary: '拿按公开跑偏记录形态还原的示意样本当材料',
      milestones: [{ title: '看清文本', description: '', goal: '对照一段示例问答' }],
    }).valid).toBe(true);
    expect(assessPlanningSourceHonesty(
      { summary: '拿真实记录当样本', milestones: [] },
      { hasMaterials: true },
    ).valid).toBe(true);
  });

  it('干净文本 → 通过', () => {
    expect(assessPlanningSourceHonesty({ summary: '四块机制逐步拆解', milestones: [{ title: 'A', description: 'B', goal: 'C' }] }).valid).toBe(true);
  });
});
