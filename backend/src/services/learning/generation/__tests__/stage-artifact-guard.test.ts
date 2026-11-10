/**
 * 工件生产课检测（2026-11-09 外评「伪 PBL 造表味」结构手术第 1 刀）。
 * 锁两类事实：①「文书生产」动作组合被检出（产出/定稿/回写/固化 + 清单/卡/流程图）；
 * ②创作类学科信号放行整个守卫 + 合法的「文档当输入」引用不误伤。
 */
import { detectArtifactProductionTasks, looksLikeCraftSubject } from '../stage-artifact-guard';

describe('detectArtifactProductionTasks', () => {
  it('「产出XX清单/卡」类文书生产课被检出', () => {
    const tasks = [
      { title: '回收错判分子并固化反例边界清单', description: '', acceptanceHint: '' },
      { title: '产出一页资产计量口径选择卡，并用一道新业务验证', description: '', acceptanceHint: '' },
      { title: '对照黄山基础清单标出空白与不确定项', description: '将分类标记回写清单并定稿可照走版本', acceptanceHint: '' },
    ];
    const titles = detectArtifactProductionTasks(tasks).map((v) => v.taskTitle);
    expect(titles).toContain('回收错判分子并固化反例边界清单');
    expect(titles).toContain('产出一页资产计量口径选择卡，并用一道新业务验证');
    expect(titles).toContain('对照黄山基础清单标出空白与不确定项');
  });

  it('综合实战/做题课不误伤', () => {
    const tasks = [
      { title: '对苯酚、乙烯基醚、氯苯等p-π共轭分子判别并做10分子混合盲测至稳定', description: '限时连判并写出依据', acceptanceHint: '10 题做对 8 道' },
      { title: '在简单业务上标注科目与借贷方向', description: '用任务 3 产出的科目归类做判断', acceptanceHint: '' },
      { title: '资产类业务综合分录通关测试', description: '', acceptanceHint: '能不看提示连做 10 题做对 7 道' },
    ];
    expect(detectArtifactProductionTasks(tasks)).toEqual([]);
  });

  it('description/acceptanceHint 里的文书生产同样命中', () => {
    const tasks = [
      { title: '整理学习心得', description: '把本阶段的判断要点汇编成一份自查卡', acceptanceHint: '' },
    ];
    expect(detectArtifactProductionTasks(tasks)).toHaveLength(1);
  });
});

describe('looksLikeCraftSubject', () => {
  it('创作类学科信号命中（工件即目标，守卫放行）', () => {
    expect(looksLikeCraftSubject('帮我写一份黄山旅行攻略')).toBe(true);
    expect(looksLikeCraftSubject('做一个爬虫抓取天气数据')).toBe(true);
    expect(looksLikeCraftSubject('改简历，目标投产品岗')).toBe(true);
  });

  it('学科学习/考证/生活决策不命中（守卫生效）', () => {
    expect(looksLikeCraftSubject('零基础备考中级会计实务与经济法两科')).toBe(false);
    expect(looksLikeCraftSubject('考研复习有机化学，苯乙烯共轭类型判别')).toBe(false);
  });
});
