/**
 * #55 路径级课时声明与交付对账单测（2026-10-18）。
 *
 * 缺陷实证：CPA 240h 锚路径计划 127.5h、实际 62.1h；阶段级只声明了 3 个 <70% 的阶段，
 * 路径级此前只有「超容量」方向，少交付整条路径无任何声明。这里锁住三件事：
 * 触发阈值/文案口径、幂等、以及落库结构（budgetConservation.delivery）。
 */
import { readFileSync } from 'fs';
import {
  appendDescriptionNote,
  buildPathFillNote,
  PATH_FILL_DECLARE_RATIO,
  PATH_FILL_NOTE_MARKER,
  reconcileDeliveryConservation,
} from '../path-fill-note';

describe('buildPathFillNote', () => {
  it('欠交付（实际 < 计划 70%）生成路径级课时说明', () => {
    const note = buildPathFillNote({ plannedHours: 127.5, deliveredHours: 62.1 });
    expect(note).toContain(PATH_FILL_NOTE_MARKER);
    expect(note).toContain('约 128 小时'); // 计划四舍五入到整小时
    expect(note).toContain('约 62 小时');
    expect(note).toContain('约 49%'); // 62.1 / 127.5
    expect(note).toContain('补充任务');
  });

  it('小数值路径保留一位小数（取整会读成「1 小时 vs 1 小时」）', () => {
    const note = buildPathFillNote({ plannedHours: 1.4, deliveredHours: 0.933 }) as string;
    expect(note).toContain('约 1.4 小时');
    expect(note).toContain('约 0.9 小时');
    expect(note).toContain('约 67%');
  });

  it('达标（实际 ≥ 70% 计划）不声明', () => {
    expect(buildPathFillNote({ plannedHours: 100, deliveredHours: 70.1 })).toBeNull();
    expect(buildPathFillNote({ plannedHours: 100, deliveredHours: 100 })).toBeNull();
    expect(buildPathFillNote({ plannedHours: 100, deliveredHours: 130 })).toBeNull();
  });

  it('边界恰好等于阈值不声明（与阶段级同口径）', () => {
    expect(buildPathFillNote({ plannedHours: 100, deliveredHours: 100 * PATH_FILL_DECLARE_RATIO })).toBeNull();
  });

  it('无计划 / 无交付 / 非法值不声明（无计划不承诺）', () => {
    expect(buildPathFillNote({ plannedHours: null, deliveredHours: 10 })).toBeNull();
    expect(buildPathFillNote({ plannedHours: 0, deliveredHours: 10 })).toBeNull();
    expect(buildPathFillNote({ plannedHours: 100, deliveredHours: null })).toBeNull();
    expect(buildPathFillNote({ plannedHours: 100, deliveredHours: 0 })).toBeNull();
    expect(buildPathFillNote({ plannedHours: Number.NaN, deliveredHours: 10 })).toBeNull();
  });

  it('幂等：路径描述已带【课时说明】不重复追加（重生成/追加模式）', () => {
    expect(buildPathFillNote({
      plannedHours: 100,
      deliveredHours: 30,
      existingDescription: `原描述\n\n${PATH_FILL_NOTE_MARKER}按你的时间预算……`,
    })).toBeNull();
  });

  it('面向学习者：不引用内部字段名、不承诺「一定达成目标」', () => {
    const note = buildPathFillNote({ plannedHours: 240, deliveredHours: 60 }) as string;
    expect(note).not.toContain('budgetConservation');
    expect(note).not.toContain('补充说明');
    expect(note).not.toContain('一定');
    expect(note).toContain('告诉我');
  });
});

describe('appendDescriptionNote', () => {
  it('无声明时不产生描述（调用方不写库）', () => {
    expect(appendDescriptionNote('原描述', null)).toBeNull();
    expect(appendDescriptionNote('原描述', '   ')).toBeNull();
  });

  it('空描述时声明自包含；已有描述时以空行追加、原描述保留在前', () => {
    expect(appendDescriptionNote('', '说明')).toBe('说明');
    expect(appendDescriptionNote(null, '说明')).toBe('说明');
    expect(appendDescriptionNote('原描述', '说明')).toBe('原描述\n\n说明');
  });

  it('两条声明可叠加（超容量 + 欠交付同时成立）', () => {
    const overload = '【时间预算提示】排不完';
    const fill = '【课时说明】少交付';
    const once = appendDescriptionNote('原描述', overload) as string;
    const twice = appendDescriptionNote(once, fill) as string;
    expect(twice.indexOf(overload)).toBeLessThan(twice.indexOf(fill));
    expect(twice).toContain('原描述');
  });
});

interface ReconciledConservation {
  target?: number;
  after?: number;
  capacitySum?: number;
  delivery: {
    hours: number;
    vsPlanned: number | null;
    declaration: string;
    declared: boolean;
    recordedAt: string;
  };
}

describe('reconcileDeliveryConservation', () => {
  it('保留 target/after/capacitySum，追加 delivery 对账块（记录声明层级）', () => {
    const now = new Date('2026-10-18T09:00:00.000Z');
    const merged = reconcileDeliveryConservation({
      conservation: { target: 240, after: 127.5, capacitySum: 150, clamped: true },
      deliveredHours: 62.1,
      declaration: 'path',
      now,
    }) as unknown as ReconciledConservation;
    expect(merged.target).toBe(240);
    expect(merged.after).toBe(127.5);
    expect(merged.capacitySum).toBe(150);
    expect(merged.delivery).toEqual({
      hours: 62.1,
      vsPlanned: 0.487,
      declaration: 'path',
      declared: true,
      recordedAt: '2026-10-18T09:00:00.000Z',
    });
    expect(merged.delivery.recordedAt).toBe(now.toISOString());
  });

  it('只追加 stage 时如实记 stage（不许冒充路径级声明）', () => {
    const merged = reconcileDeliveryConservation({
      conservation: { target: 100, after: 100 },
      deliveredHours: 80,
      declaration: 'stage',
      now: new Date('2026-10-18T00:00:00.000Z'),
    }) as unknown as ReconciledConservation;
    expect(merged.delivery.declaration).toBe('stage');
    expect(merged.delivery.declared).toBe(true);
  });

  it('after 缺失时 vsPlanned 为 null（不当成 0 或 1）', () => {
    const merged = reconcileDeliveryConservation({
      conservation: { target: 100 },
      deliveredHours: 30,
      declaration: 'none',
      now: new Date('2026-10-18T00:00:00.000Z'),
    }) as unknown as ReconciledConservation;
    expect(merged.delivery.vsPlanned).toBeNull();
    expect(merged.delivery.declaration).toBe('none');
    expect(merged.delivery.declared).toBe(false);
  });

  it('无守恒对象时不乱造结构（返回 null）', () => {
    expect(reconcileDeliveryConservation({ conservation: null, deliveredHours: 10, declaration: 'none' })).toBeNull();
    expect(reconcileDeliveryConservation({ conservation: [], deliveredHours: 10, declaration: 'none' })).toBeNull();
    expect(reconcileDeliveryConservation({ conservation: 'x', deliveredHours: 10, declaration: 'none' })).toBeNull();
  });
});

describe('#55 写入链接线（源码守卫）', () => {
  const source = readFileSync('src/services/learning/generation/stage-enrichment.ts', 'utf8');

  it('回写阶段调用 buildPathFillNote，用回写后的实际学时对账骨架锚/守恒层计划', () => {
    expect(source).toContain('buildPathFillNote({');
    expect(source).toContain('deliveredHours: pathNormalizedHours');
    expect(source).toContain("budgetConservation?.after");
  });

  it('路径级说明与超容量声明合并写入 description（不是二选一）', () => {
    expect(source).toContain('descriptionWithNotes');
    expect(source).toContain('appendDescriptionNote(');
    expect(source).not.toContain('descriptionWithOverload');
  });

  it('只在全路径生成时评估路径级声明（追加/渐进片段不误判为整条塌方）', () => {
    expect(source).toContain('const fullPathRun = !appendOnly && !progressive && !restrictMilestoneIds');
    expect(source).toContain('const pathFillNote = fullPathRun');
    expect(source).toContain('const reconciledConservation = fullPathRun');
  });

  it('对账结果写回 aiPromptTemplate.budgetConservation，并记录声明层级', () => {
    expect(source).toContain('reconcileDeliveryConservation({');
    // 阶段级声明已于 2026-10-25 下线（stage-fill-note.ts 删除）：只剩路径级 path / none 两档。
    // 存量行的 stage 档由 delivery-ratio 审计侧识别，生成链路不再产出。
    expect(source).toContain("declaration: pathFillNote ? 'path' : 'none'");
    expect(source).toContain('budgetConservation: reconciledConservation');
  });
});
