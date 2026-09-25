import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import { normalizeCurrentTask, pickCurrentTask, useCurrentTask } from '../useCurrentTask';

const t = (id: string, status?: string) => ({ id, title: `任务${id}`, status });

describe('pickCurrentTask（学习台/详情页共用挑选规则）', () => {
  it('全局 prefer in_progress：即使后面的周才有 in_progress', () => {
    // 回归点：旧学习台实现按周提前返回，会选成周1 的 todo（周2 才是该接着学的那节）
    const list = [t('a', 'todo'), t('b', 'todo'), t('c', 'in_progress')];
    expect(pickCurrentTask(list)?.id).toBe('c');
  });

  it('无 in_progress 时取全局第一个 todo', () => {
    const list = [t('a', 'completed'), t('b', 'todo'), t('c', 'todo')];
    expect(pickCurrentTask(list)?.id).toBe('b');
  });

  it('状态缺失视为 todo', () => {
    const list = [t('a'), t('b', 'completed')];
    expect(pickCurrentTask(list)?.id).toBe('a');
  });

  it('全部完成时返回 null', () => {
    expect(pickCurrentTask([t('a', 'completed'), t('b', 'completed')])).toBeNull();
    expect(pickCurrentTask([])).toBeNull();
  });
});

describe('normalizeCurrentTask', () => {
  it('归一化标题/描述/分钟/类型，displayLabel 兜底', () => {
    const row = {
      id: 'x1',
      displayLabel: '理解核心原理',
      description: '先弄清动作与结果',
      estimatedMinutes: 30,
      taskType: 'understand',
      status: 'in_progress',
    };
    expect(normalizeCurrentTask(row)).toEqual({
      id: 'x1',
      title: '理解核心原理',
      desc: '先弄清动作与结果',
      minutes: 30,
      kind: '理解核心原理',
      status: 'in_progress',
    });
  });

  it('缺 id 视为无任务', () => {
    expect(normalizeCurrentTask(null)).toBeNull();
    expect(normalizeCurrentTask({ id: '' } as never)).toBeNull();
  });
});

describe('useCurrentTask', () => {
  it('列表变化时跟随刷新', () => {
    const list = ref([t('a', 'todo'), t('b', 'in_progress')]);
    const cur = useCurrentTask(list);
    expect(cur.value?.id).toBe('b');
    list.value = [...list.value, { id: 'c', title: '任务c', status: 'in_progress' }];
    expect(cur.value?.id).toBe('b'); // 仍是第一个 in_progress
    list.value = [{ id: 'c', title: '任务c', status: 'in_progress' }];
    expect(cur.value?.id).toBe('c');
    expect(computed(() => cur.value?.title).value).toBe('任务c');
  });
});
