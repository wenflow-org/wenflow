import { deriveMaterialNeedsFromGoalText, inferMaterialOrigin, partitionMaterialNeeds } from '../material-need-origin';
import type { MaterialNeed } from '../../../skills/material-collector/types';

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
});
