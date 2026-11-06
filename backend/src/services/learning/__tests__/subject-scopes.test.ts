import { resolveSubjectScope, conceptInScope, measureScopeCoverage, formatScopeForPrompt } from '../subject-scopes';

describe('学习范围（Scope）：从考试范围解析出「该覆盖哪些实体」', () => {
  it('理综/物理命中力学范围；无关文本不命中（保持旧行为）', () => {
    expect(resolveSubjectScope('高考理综合卷(物理+化学+生物)')?.name).toBe('高中物理·力学');
    expect(resolveSubjectScope('理综物理大题限时止损与转场')?.name).toBe('高中物理·力学');
    expect(resolveSubjectScope('零基础学做饭')).toBeNull();
    expect(resolveSubjectScope('')).toBeNull();
  });

  it('分布式一致性命中自己的范围', () => {
    expect(resolveSubjectScope('自研 Raft 与 ZooKeeper 的选型')?.name).toBe('分布式一致性');
  });

  it('概念命中判定：实体概念算命中，元认知表述不算', () => {
    const scope = resolveSubjectScope('高考物理')!;
    expect(conceptInScope('受力分析与受力图', scope)).toBe(true);
    expect(conceptInScope('牛顿第二定律', scope)).toBe(true);
    expect(conceptInScope('动量守恒定律的应用', scope)).toBe(true);
    expect(conceptInScope('解题中途不确定感的可观察信号化', scope)).toBe(false);
    expect(conceptInScope('方向性错误与计算性错误的分类判别', scope)).toBe(false);
    expect(conceptInScope('', scope)).toBe(false);
  });

  it('覆盖率统计给出范围外的具体条目（用于修复提示）', () => {
    const scope = resolveSubjectScope('高考物理')!;
    const coverage = measureScopeCoverage(
      ['受力分析', '动能定理', '解题中途不确定感的可观察信号化'],
      scope,
    );
    expect(coverage.total).toBe(3);
    expect(coverage.inScope).toBe(2);
    expect(coverage.outOfScope).toEqual(['解题中途不确定感的可观察信号化']);
  });

  it('提示词片段带上 id 与 label，并明确「策略不进 coreConcept」', () => {
    const text = formatScopeForPrompt(resolveSubjectScope('高考物理')!);
    expect(text).toContain('[force-analysis] 受力分析与受力图');
    expect(text).toContain('策略');
    expect(text).toContain('coreConcept');
  });
});
