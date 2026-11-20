/**
 * 开场景卡片视图域（2026-11-20 恢复卡走查）：
 * ① 标签已经定性「继续/复习」，标题不再重复同一句话，标签与标题才能并排；
 * ② 上一课 wrapup 生成失败留下的兜底文案不是复盘摘要，不能出现在恢复卡首屏。
 */
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useOpeningSceneViews } from '../learningScene';

describe('useOpeningSceneViews 恢复卡', () => {
  it('resume 标题只讲「从哪继续」，不重复标签里的「继续」', () => {
    const scene = ref<any>({ kind: 'resume', title: '' });
    const { sceneTag, sceneDefaultTitle } = useOpeningSceneViews(scene);
    expect(sceneTag.value).toBe('继续上课');
    expect(sceneDefaultTitle.value).toBe('从上次离开的地方接着学');
    expect(sceneDefaultTitle.value.startsWith('继续')).toBe(false);
  });

  it('模型失败留下的兜底摘要不当作上次复盘展示', () => {
    const scene = ref<any>({
      kind: 'resume',
      recap: { summary: '本次学习记录生成遇到问题，为你保留了基础总结。' },
    });
    const { sceneSummary } = useOpeningSceneViews(scene);
    expect(sceneSummary.value).toBe('');
  });

  it('真实复盘摘要照常展示（首尾空白去掉）', () => {
    const scene = ref<any>({
      kind: 'resume',
      recap: { summary: '  上次学到了 concat 拼接后的列名校验。  ' },
    });
    const { sceneSummary } = useOpeningSceneViews(scene);
    expect(sceneSummary.value).toBe('上次学到了 concat 拼接后的列名校验。');
  });

  it('待巩固知识点最多展示 3 条', () => {
    const scene = ref<any>({
      kind: 'resume',
      recap: { unresolved: ['A', 'B', 'C', 'D'] },
    });
    const { sceneUnresolved } = useOpeningSceneViews(scene);
    expect(sceneUnresolved.value).toEqual(['A', 'B', 'C']);
  });
});
