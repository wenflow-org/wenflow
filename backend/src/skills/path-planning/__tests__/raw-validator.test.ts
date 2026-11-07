import { validatePathPlanningOutput, validateScopeBinding } from '../index';
import { resolveSubjectScope } from '../../../services/learning/subject-scopes';
import { normalizeMilestonesWithConcepts } from '../../../services/learning/generation/path-generation.core';
import { logger } from '../../../utils/logger';

describe('path-planning raw validator', () => {
  const validOutput = {
    name: '前端入门路径',
    milestones: [{ stageNumber: 1, title: '识别布局关系', coreConcept: 'concept-1' }],
    cognitiveCore: {
      cognitiveDomain: 'understand',
      coreConcepts: [{ id: 'concept-1', name: '布局关系的识别与稳定控制', role: 'hub' }],
    },
  }

  it('accepts the minimum model output consumed by the normalizer', () => {
    expect(validatePathPlanningOutput(validOutput)).toEqual({ valid: true })
  })

  it('rejects missing required top-level fields before normalization', () => {
    expect(validatePathPlanningOutput({ ...validOutput, name: '  ' })).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_NAME_MISSING',
    })
    expect(validatePathPlanningOutput({ ...validOutput, milestones: [] })).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_MILESTONES_MISSING',
    })
    expect(validatePathPlanningOutput({ ...validOutput, cognitiveCore: null })).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_COGNITIVE_CORE_MISSING',
    })
  })

  it('requires exactly one hub concept when coreConcepts are declared', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      cognitiveCore: { coreConcepts: [{ id: 'concept-1', role: 'supporting' }] },
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MISSING' })
    expect(validatePathPlanningOutput({
      ...validOutput,
      cognitiveCore: {
        coreConcepts: [
          { id: 'concept-1', role: 'hub' },
          { id: 'concept-2', role: 'hub' },
        ],
      },
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MULTIPLE' })
  })

  it('rejects milestones bound to an undeclared core concept', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      milestones: [{ stageNumber: 1, title: 't', coreConcept: 'ghost-9' }],
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND' })
  })

  it('rejects legacy task-level fields on milestones', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      milestones: [{ stageNumber: 1, title: 't', coreConcept: 'concept-1', subtasks: [{ title: 's' }] }],
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_LEGACY_TASK_FIELDS' })
  })

  it('rejects non-contiguous stage numbers', () => {
    expect(validatePathPlanningOutput({
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't2', coreConcept: 'concept-1' },
      ],
    })).toEqual({ valid: false, failureReason: 'PATH_PLANNING_STAGE_NUMBER_GAP' })
  })

  it('enforces exact milestone count when expectedMilestones is provided', () => {
    const output3 = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' },
        { stageNumber: 2, title: 't2', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't3', coreConcept: 'concept-1' },
      ],
    }
    // 数量匹配 → 通过
    expect(validatePathPlanningOutput(output3, 3)).toEqual({ valid: true })
    // 数量不匹配 → 打回（关键：prompt 要求精确输出 N 个，代码层仍然是硬校验）
    expect(validatePathPlanningOutput(output3, 4)).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_MILESTONE_COUNT_MISMATCH(expected=4, got=3)',
    })
  })

  it('targetMilestones（forced）优先于区间：区间内的数也要打回', () => {
    const output4 = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' },
        { stageNumber: 2, title: 't2', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't3', coreConcept: 'concept-1' },
        { stageNumber: 4, title: 't4', coreConcept: 'concept-1' },
      ],
    }
    // 只看区间时 4 ∈ [4,6] 本就通过；forced=2 必须打回
    expect(validatePathPlanningOutput(output4, 2, [4, 6])).toEqual({ valid: true })
    expect(validatePathPlanningOutput(output4, 2, [4, 6], 2)).toEqual({
      valid: false,
      failureReason: 'PATH_PLANNING_MILESTONE_COUNT_MISMATCH(expected=2, got=4)',
    })
  })

  it('reports insufficient hub reuse as warning (non-blocking audit)', () => {
    // 3 个 milestone，hub(concept-1) 只在首阶段出现 → 非首阶段复用 0 次 < 2 → 产生 warning 但 valid 仍为 true
    const sparseHub = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' }, // hub
        { stageNumber: 2, title: 't2', coreConcept: 'concept-2' }, // supporting
        { stageNumber: 3, title: 't3', coreConcept: 'concept-2' }, // supporting
      ],
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: [
          { id: 'concept-1', name: 'hub关系', role: 'hub' },
          { id: 'concept-2', name: '支撑关系', role: 'supporting' },
        ],
      },
    }
    const result = validatePathPlanningOutput(sparseHub)
    expect(result.valid).toBe(true)
    expect((result as any).warnings).toEqual(['PATH_PLANNING_HUB_REUSE_INSUFFICIENT(reused=0, required=2)'])
  })

  it('accepts hub reuse across non-first milestones without warning', () => {
    // hub(concept-1) 在 stage 2/3 被复用 → 非首阶段复用 2 次 ≥ 2 → 无 warning
    const goodHub = {
      ...validOutput,
      milestones: [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-2' },
        { stageNumber: 2, title: 't2', coreConcept: 'concept-1' },
        { stageNumber: 3, title: 't3', coreConcept: 'concept-1' },
      ],
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: [
          { id: 'concept-1', name: 'hub关系', role: 'hub' },
          { id: 'concept-2', name: '支撑关系', role: 'supporting' },
        ],
      },
    }
    expect(validatePathPlanningOutput(goodHub)).toEqual({ valid: true })
  })

  it('reports excessive concept count as warning (CLT audit)', () => {
    // 9 个 milestone 各挂不同概念 → 唯一概念数 9 > 8 → 产生 warning 但 valid 仍为 true
    const manyConcepts = {
      ...validOutput,
      milestones: Array.from({ length: 9 }, (_, i) => ({
        stageNumber: i + 1,
        title: `t${i + 1}`,
        coreConcept: `concept-${i + 1}`,
      })),
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: Array.from({ length: 9 }, (_, i) => ({
          id: `concept-${i + 1}`,
          name: `关系${i + 1}`,
          role: i === 0 ? 'hub' as const : 'supporting' as const,
        })),
      },
    }
    const result = validatePathPlanningOutput(manyConcepts)
    expect(result.valid).toBe(true)
    expect((result as any).warnings).toContain('PATH_PLANNING_CONCEPT_COUNT_HIGH(totalConcepts=9, cap=8)')
  })
})

describe('整条路径都是元认知 → 拒绝（2026-10-20 理综实跑）', () => {
  const build = (conceptNames: string[], titles: string[]) => ({
    name: '理综物理大题限时止损与转场',
    totalMilestones: titles.length,
    cognitiveCore: { coreConcepts: conceptNames.map((n, i) => ({ id: `concept-${i + 1}`, name: n, role: i === 0 ? 'hub' : 'supporting' })) },
    // #171-3：里程碑只能用已声明的概念 id 绑定（名字绑定已被拒），所以这里改用 id 表达。
    milestones: titles.map((t, i) => ({ stageNumber: i + 1, title: t, description: t, goal: t, coreConcept: `concept-${i + 1}` })),
  });

  it('四节课全在讲自检/归类/清单 → 判为元认知路径', () => {
    const parsed = build(
      ['解题中途不确定感的可观察信号化', '方向性错误与计算性错误的分类判别'],
      ['标出算到一半不对劲的具体时刻', '归类成方向性错误还是计算性错误'],
    );
    expect(validatePathPlanningOutput(parsed).valid).toBe(false);
    const result = validatePathPlanningOutput(parsed) as { valid: boolean; failureReason?: string };
    expect(result.failureReason).toBe('PATH_PLANNING_META_ONLY_PATH');
  });

  it('学科实体当概念 → 放行（策略词出现在标题里没关系）', () => {
    const parsed = build(
      ['多数派与任期在日志比对中的作用', '日志复制的一致性检查'],
      ['对照 ZooKeeper 拆出省掉的是另一次独立共识', '用事件簿复盘提交规则'],
    );
    expect(validatePathPlanningOutput(parsed).valid).toBe(true);
  });
});

describe('#171-3 收紧：空 coreConcepts / 名字绑定被拒', () => {
  const baseOutput = {
    name: '前端入门路径',
    milestones: [{ stageNumber: 1, title: '识别布局关系', coreConcept: 'concept-1' }],
    cognitiveCore: {
      cognitiveDomain: 'understand',
      coreConcepts: [{ id: 'concept-1', name: '布局关系的识别与稳定控制', role: 'hub' }],
    },
  }

  it('coreConcepts 为空 → PATH_PLANNING_COGNITIVE_CORE_EMPTY（不再静默放过两段校验）', () => {
    const parsed = {
      ...baseOutput,
      cognitiveCore: { cognitiveDomain: 'understand', coreConcepts: [] },
    };
    const result = validatePathPlanningOutput(parsed) as { valid: boolean; failureReason?: string };
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('PATH_PLANNING_COGNITIVE_CORE_EMPTY');
  });

  it('名字绑定被拒：milestone.coreConcept 写概念「名字」而非已声明 id → PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND', () => {
    const parsed = {
      ...baseOutput,
      cognitiveCore: {
        cognitiveDomain: 'understand',
        coreConcepts: [
          { id: 'concept-1', name: '布局关系的识别与稳定控制', role: 'hub' },
          { id: 'concept-2', name: '受力分析拆解', role: 'supporting' },
        ],
      },
      milestones: [
        { stageNumber: 1, title: 't1', description: 'd1', goal: 'g1', coreConcept: '布局关系的识别与稳定控制' },
        { stageNumber: 2, title: 't2', description: 'd2', goal: 'g2', coreConcept: '受力分析拆解' },
      ],
    };
    const result = validatePathPlanningOutput(parsed) as { valid: boolean; failureReason?: string };
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND');
  });
});

describe('#171-3 落库层：去掉 conceptIds[0] 静默回退（不塌缩到 concept-1）', () => {
  const cognitiveDesign = {
    cognitiveDomain: 'understand',
    coreConcepts: [
      { id: 'concept-1', name: '布局关系', role: 'hub' as const },
      { id: 'concept-2', name: '受力分析', role: 'supporting' as const },
    ],
  };

  it('命中已声明 id 时正常绑定；未命中时置空（非 conceptIds[0]）并记 warning 暴露塌缩', () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const milestones = [
        { stageNumber: 1, title: 't1', coreConcept: 'concept-1' },
        // 未命中任何已声明 id：旧实现会静默回退到 concept-1，造成整条路径概念塌缩
        { stageNumber: 2, title: 't2', coreConcept: 'ghost-9' },
        // 缺 coreConcept 字段：同样不应被回退
        { stageNumber: 3, title: 't3' },
      ];
      const result = normalizeMilestonesWithConcepts(milestones, cognitiveDesign as any);
      // 命中的保留原 id
      expect(result[0].coreConcept).toBe('concept-1');
      // 未命中的不再被静默塌缩到 concept-1，而是暴露为空
      expect(result[1].coreConcept).toBeNull();
      expect(result[2].coreConcept).toBeNull();
      expect(result[1].coreConcept).not.toBe('concept-1');
      // 塌缩被「看见」：对未命中阶段记了告警
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('不再静默塌缩到 conceptIds[0]'),
        expect.any(Object),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
describe('范围绑定（Scope）：阶段概念必须落在学习范围内', () => {
  const scope = resolveSubjectScope('高考理综合卷')!;
  const build = (conceptNames: string[], titles: string[]) => ({
    name: '力学大题的点拨',
    totalMilestones: titles.length,
    cognitiveCore: { coreConcepts: conceptNames.map((n, i) => ({ id: `concept-${i + 1}`, name: n, role: i === 0 ? 'hub' : 'supporting' })) },
    milestones: conceptNames.map((n, i) => ({ stageNumber: i + 1, title: titles[i], description: titles[i], goal: titles[i], coreConcept: `concept-${i + 1}` })),
  });

  it('概念取自范围 → 通过', () => {
    const parsed = build(['受力分析与受力图', '动能定理'], ['读懂受力图', '用动能定理算']);
    expect(validateScopeBinding(parsed, scope).valid).toBe(true);
  });

  it('整条路径都是元认知概念 → SCOPE_UNBOUND', () => {
    const parsed = build(
      ['解题中途不确定感的可观察信号化', '方向性错误与计算性错误的分类判别'],
      ['标出卡壳时刻', '归类错误类型'],
    );
    const result = validateScopeBinding(parsed, scope) as { valid: boolean; failureReason?: string };
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('PATH_PLANNING_SCOPE_UNBOUND');
  });

  it('没有范围（未命中注册表）→ 不做约束，保持旧行为', () => {
    const parsed = build(['任何概念'], ['任何阶段']);
    expect(validateScopeBinding(parsed, null).valid).toBe(true);
  });
});
