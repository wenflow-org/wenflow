/**
 * 二级/三级页来源记忆（2026-10-08 走查）：openSubPage 原先只对 session/session-real
 * 保存 from，导致「学习者详情 → 路径详情」返回时直接落回一级列表。这里锁住
 * 「带 from 就记来源」的通用行为，避免又退化成按 view 白名单。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openSubPage, closeSubPage, subPage, setSubPageLabel } from '../store';

describe('openSubPage 来源记忆', () => {
  beforeEach(() => {
    subPage.value = null;
  });

  it('非 session 的二级→三级（path）同样保存 from，返回时回到来源详情而非列表', () => {
    openSubPage('path', 'path-1', { from: { view: 'learner', id: 'u1', label: '张三' } });
    expect(subPage.value).toMatchObject({ view: 'path', id: 'path-1', from: { view: 'learner', id: 'u1' } });
    closeSubPage();
    expect(subPage.value).toMatchObject({ view: 'learner', id: 'u1', label: '张三' });
  });

  it('未传 from 时行为不变：返回即回一级列表', () => {
    openSubPage('path', 'path-2');
    closeSubPage();
    expect(subPage.value).toBeNull();
  });

  it('includeTest 与 from 可同时保留（虚拟/测试账号可查场景）', () => {
    openSubPage('path', 'path-3', { includeTest: true, from: { view: 'virtual', id: 'v1' } });
    expect(subPage.value).toMatchObject({ view: 'path', id: 'path-3', includeTest: true });
    expect(subPage.value?.from).toMatchObject({ view: 'virtual', id: 'v1' });
  });

  it('回写名称不丢来源（面包屑取名后仍能返回原页）', () => {
    openSubPage('path', 'path-4', { from: { view: 'learner', id: 'u2' } });
    setSubPageLabel('路径 A');
    expect(subPage.value?.label).toBe('路径 A');
    closeSubPage();
    expect(subPage.value).toMatchObject({ view: 'learner', id: 'u2' });
  });
});
