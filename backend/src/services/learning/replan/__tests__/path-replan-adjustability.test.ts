/**
 * 重排骨干判据（动态规划，2026-10-17）：
 * 压缩时必须保护 core（真实交付物/收口/补缺），优先让 flexible（建立/拆解/诊断）让位。
 * 新路径用 stage-designer 落的 sidecar 标注；存量路径没有 sidecar 时按任务类型兜底。
 */
import { resolveTaskAdjustability } from '../path-replan.service';

describe('resolveTaskAdjustability', () => {
  it('sidecar 标注优先于类型兜底', () => {
    const byTask = { 'st-1': 'flexible', 'st-2': 'core' };
    expect(resolveTaskAdjustability({ id: 'st-1', taskType: 'execute' }, byTask)).toBe('flexible');
    expect(resolveTaskAdjustability({ id: 'st-2', taskType: 'acquire' }, byTask)).toBe('core');
  });

  it('无 sidecar 时按类型兜底：建立/拆解/诊断可让位，其余是骨干', () => {
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'acquire' }, null)).toBe('flexible');
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'deconstruct' })).toBe('flexible');
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'diagnose' })).toBe('flexible');
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'model' })).toBe('core');
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'execute' })).toBe('core');
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'refine' })).toBe('core');
    expect(resolveTaskAdjustability({ id: 'x', taskType: 'consolidate' })).toBe('core');
  });

  it('sidecar 里的非法值不生效，回退到类型判据', () => {
    const byTask = { 'st-1': 'optional' };
    expect(resolveTaskAdjustability({ id: 'st-1', taskType: 'execute' }, byTask)).toBe('core');
    expect(resolveTaskAdjustability({ id: 'st-1', taskType: 'acquire' }, byTask)).toBe('flexible');
  });
});
