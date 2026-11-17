import { compactTopic, deriveMaterialNeedsFromGoalText, inferMaterialOrigin, mergeDeclaredAndDerivedNeeds, partitionMaterialNeeds } from '../material-need-origin';
import type { MaterialNeed } from '../../../skills/path-material-collect/types';

describe('material-need-origin', () => {
  it('显式 origin 优先于文本启发式', () => {
    expect(inferMaterialOrigin({ title: '内部自研手册', origin: 'public' })).toBe('public');
    expect(inferMaterialOrigin({ title: '国家法规原文', origin: 'private' })).toBe('private');
  });

  it('私有/内部信号判 private', () => {
    const cases: Array<Partial<MaterialNeed>> = [
      { kind: '手册', title: '内部自研 DSL 规则引擎算子语义手册' },
      { kind: '内部规范性文件', title: '2026 技术序列晋升举证红皮书' },
      { kind: '字典', title: '旧库 40 张核心表无外键隐式关联字典说明' },
      { kind: '实验室内控手册', title: '本实验室钙钛矿旋涂与退火内控手册' },
      { kind: '私有协议', title: 'HX-900 工业机械臂 RS485 私有二进制协议表' },
    ];
    for (const need of cases) {
      expect(inferMaterialOrigin(need as MaterialNeed)).toBe('private');
    }
  });

  it('公开权威资料判 public', () => {
    const cases: Array<Partial<MaterialNeed>> = [
      { kind: '标准', title: 'CY/T 124-2015 学术出版规范 一般要求' },
      { kind: '规范', title: 'Model Context Protocol Specification 2026-07-28' },
      { kind: '法规', title: '中华人民共和国公司法（2023 修订）' },
      { kind: '指南', title: 'KDIGO 2024 CKD Guideline' },
    ];
    for (const need of cases) {
      expect(inferMaterialOrigin(need as MaterialNeed)).toBe('public');
    }
  });

  it('无信号时默认 public（保留现有检索行为，不因漏标少采）', () => {
    expect(inferMaterialOrigin({ title: 'React 19 Actions' })).toBe('public');
    expect(inferMaterialOrigin({ title: '' })).toBe('public');
  });

  it('partition 按来源域拆分且不丢项', () => {
    const needs: MaterialNeed[] = [
      { title: '内部自研 DSL 手册' },
      { title: '中华人民共和国公司法' },
      { title: '本公司无外键字典' },
      { title: 'CY/T 124-2015 学术出版规范' },
    ];
    const { publicNeeds, privateNeeds } = partitionMaterialNeeds(needs);
    expect(privateNeeds.map((n) => n.title)).toEqual(['内部自研 DSL 手册', '本公司无外键字典']);
    expect(publicNeeds.map((n) => n.title)).toEqual(['中华人民共和国公司法', 'CY/T 124-2015 学术出版规范']);
  });
});

describe('deriveMaterialNeedsFromGoalText（path 思考触发兜底）', () => {
  it('2026-11-12 实证形态：learning_direction 承诺公开记录/真实案例 → 派生 public need', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '从0学习aiagent',
      learningDirection: '全程不碰代码，拿 AutoGPT 的公开跑偏记录、插件与工具调用的真实记录当样本',
    });
    expect(needs.length).toBeGreaterThanOrEqual(1);
    expect(needs[0].origin).toBe('public');
    expect(needs[0].title).toContain('公开记录');
    expect((needs[0].queries || []).length).toBeGreaterThanOrEqual(1);
    // why 说明这是兜底（审计能看出来源）
    expect(needs[0].why).toContain('未登记');
  });

  it('点名官方文档依赖 → 派生文档类 need', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '用 React 19 做管理后台',
      realProblem: '照着官方文档学，怕版本对不上',
    });
    expect(needs.some((n) => n.kind === '官方文档')).toBe(true);
  });

  it('干净文本（无承诺/无文档依赖）→ 不派生（零误伤）', () => {
    expect(deriveMaterialNeedsFromGoalText({ surfaceGoal: '练英语口语', learningDirection: '按场景对话练习' })).toEqual([]);
    expect(deriveMaterialNeedsFromGoalText({})).toEqual([]);
  });

  it('派生上限 2 条', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '数据治理',
      learningDirection: '要真实案例，还要官方文档、白皮书和技术规范',
    });
    expect(needs.length).toBeLessThanOrEqual(2);
  });
});

describe('deriveMaterialNeedsFromGoalText · 研究价值闸（Layer 3：联网补料是一等公民）', () => {
  it('事实/机制类目标即使无承诺信号也派生锚点 need（模型知识不够的领域默认采料）', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '从0学习aiagent',
      stages: ['看清模型当轮读到的文本', '拆开一次工具调用'],
    });
    // 「模型」「工具」「API」等信号命中 → 有锚点
    expect(needs.some((n) => n.kind === '领域背景资料')).toBe(true);
    expect(needs.every((n) => n.origin === 'public')).toBe(true);
  });

  it('无阶段名但领域信号足（≥2）→ 主题锚点至少 1 条', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '看懂货币政策怎么影响物价',
      learningDirection: '宏观机制与传导数据拆解',
    });
    expect(needs.length).toBeGreaterThanOrEqual(1);
  });

  it('纯训练目标（口语/习惯）不命中信号 → 零派生（不误伤）', () => {
    expect(deriveMaterialNeedsFromGoalText({ surfaceGoal: '每天练英语口语', learningDirection: '按场景对话练习' })).toEqual([]);
  });

  it('总上限 3 条（与 MATERIAL_COLLECTION_MAX_NEEDS 对齐）', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '数据治理',
      learningDirection: '要真实案例，还要官方文档、白皮书和技术规范',
      stages: ['数据标准', '法规合规'],
    });
    expect(needs.length).toBeLessThanOrEqual(3);
  });

  it('goal 只声明私有材料时，派生公开 need 补位（不因私有声明跳过公开取证）', () => {
    const declared = {
      kind: '劳动合同',
      title: '用户本人的新公司劳动合同（竞业限制与违约金条款）',
      why: '平台不掌握其条款内容',
      origin: 'private',
      queries: [],
    } as MaterialNeed;
    const derived = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '审查劳动合同竞业限制条款，判断哪些条款有坑',
      realProblem: '分不清法律允许约束到什么边界，缺一套法定尺子',
      learningDirection: '立两条法定尺子，再拿合同逐句量',
      stages: ['建立竞业限制的法定上限', '拿尺子量自己的合同'],
    });
    expect(derived.some((need) => inferMaterialOrigin(need) === 'public')).toBe(true);
    const merged = mergeDeclaredAndDerivedNeeds(declared, derived, 3);
    const list = (Array.isArray(merged) ? merged : [merged]) as MaterialNeed[];
    expect(list[0]).toBe(declared);
    expect(list.some((need) => inferMaterialOrigin(need) === 'public')).toBe(true);
    expect(list.length).toBeLessThanOrEqual(3);
  });

  it('goal 已声明公开 need 时以 goal 为准，不再追加派生需求', () => {
    const declared: MaterialNeed = {
      kind: '法规', title: '中华人民共和国劳动合同法', origin: 'public', queries: ['劳动合同法 竞业限制'],
    };
    const derived = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '审查劳动合同',
      learningDirection: '要真实案例',
    });
    expect(mergeDeclaredAndDerivedNeeds(declared, derived, 3)).toBe(declared);
  });

  it('未声明 needsMaterial 时返回派生列表（保持旧行为）', () => {
    const derived = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '看懂货币政策怎么影响物价',
      learningDirection: '宏观机制与传导数据拆解',
    });
    expect(mergeDeclaredAndDerivedNeeds(null, derived, 3)).toEqual(derived);
  });

  it('财报/报表/现金流类目标命中研究价值闸（2026-11-13 u04 实证）', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '读懂上市公司年报的三张财务报表，判断经营质量',
      realProblem: '三表怎么串成一句话搞不懂，看着数字脑子转不动',
      stages: ['三表勾稽与利润质量', '现金流与资产负债风险'],
    });
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((need) => need.origin === 'public')).toBe(true);
  });

  it('长句目标压出领域短语，检索词不再取整句前缀（u06 行业研究实证）', () => {
    expect(compactTopic('我刚进咨询公司，第一次独立写行业研究报告，领导只说了句要有洞见')).toBe('行业研究报告');
    expect(compactTopic('我下周一要签新公司的劳动合同')).toContain('劳动合同');

    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '我刚进咨询公司，第一次独立写行业研究报告，领导只说了句要有洞见',
      stages: ['从行业资料最反常处立出可证伪的判断'],
    });
    expect(needs.some((need) => (need.queries || []).includes('行业研究报告'))).toBe(true);
  });

  it('无 keyStages 时强领域词单独命中即派生（u02 租房合同实证）', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '能逐条审查租房合同，识别押金、维修责任、转租、提前解约、涨租五类风险',
      realProblem: '分不清哪些条款是行业惯例、哪些是坑',
    });
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((need) => need.origin === 'public')).toBe(true);
  });

  it('英文论文/文献类目标命中研究价值闸（u07 实证）', () => {
    const needs = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '跨专业研一，导师让每周读三篇英文论文；单词都认识，但一段摘要读下来不知道它在说什么',
    });
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((need) => need.origin === 'public')).toBe(true);
  });

  it('空对象 needsMaterial 不阻断派生（u07 实证）', () => {
    const derived = deriveMaterialNeedsFromGoalText({
      surfaceGoal: '跨专业研一，导师让每周读三篇英文论文；摘要读不懂',
    });
    expect(derived.length).toBeGreaterThan(0);
    const merged = mergeDeclaredAndDerivedNeeds({}, derived, 3);
    const list = (Array.isArray(merged) ? merged : [merged]) as MaterialNeed[];
    expect(list.some((need) => String(need?.title || '').trim().length > 0)).toBe(true);
    expect(list.some((need) => inferMaterialOrigin(need) === 'public')).toBe(true);
  });
});
