/**
 * 传统分页器组件（方案 A）测试：页码文本 / 边界禁用 / 翻页事件 / 每页条数变更 / 越界自动收敛
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Pagination from '../Pagination.vue';

function mountPagination(props: Record<string, unknown> = {}) {
  return mount(Pagination, {
    props: { page: 1, total: 378, pageSize: 30, ...props }
  });
}

describe('Pagination（mk-pagination 传统分页器）', () => {
  const btn = (w: ReturnType<typeof mountPagination>, text: string) =>
    w.findAll('button').find((b) => b.text() === text)!;

  it('总页数 = ceil(total/pageSize)：378/30 → 13 页，展示「第 X / N 页」', () => {
    const w = mountPagination();
    expect(w.text()).toContain('第 1 / 13 页');
  });

  it('首末页边界：第 1 页禁用上一页、第 13 页禁用下一页', () => {
    const w1 = mountPagination();
    expect(btn(w1, '上一页').attributes('disabled')).toBeDefined();
    expect(btn(w1, '下一页').attributes('disabled')).toBeUndefined();

    const w2 = mountPagination({ page: 13 });
    expect(btn(w2, '上一页').attributes('disabled')).toBeUndefined();
    expect(btn(w2, '下一页').attributes('disabled')).toBeDefined();
  });

  it('翻页点击发出 update:page（上一页 / 下一页 / 页码直达）', async () => {
    const w = mountPagination({ page: 2 });
    await btn(w, '上一页').trigger('click');
    expect(w.emitted('update:page')?.at(-1)).toEqual([1]);
    await btn(w, '下一页').trigger('click');
    expect(w.emitted('update:page')?.at(-1)).toEqual([3]);
    // 页码按钮直达：跳最后一页（p=2 时序列为 1 2 3 … 13）
    await btn(w, '13').trigger('click');
    expect(w.emitted('update:page')?.at(-1)).toEqual([13]);
  });

  it('页码按钮序列：13 页折叠为 1 … 4 5 6 … 13（AntD 风格）', () => {
    const w = mountPagination({ page: 5 });
    const nums = w.findAll('.mk-pagination__num').map((x) => x.text());
    expect(nums).toEqual(['1', '4', '5', '6', '13']);
    // 省略号两枚且位于 1 与 4 之间、6 与 13 之间
    const ellipsis = w.findAll('.mk-pagination__ellipsis');
    expect(ellipsis).toHaveLength(2);
    // 当前页高亮
    expect(w.find('.mk-pagination__num--active').text()).toBe('5');
  });

  it('每页条数选择发出 update:pageSize', async () => {
    const w = mountPagination();
    await w.find('select').setValue('50');
    expect(w.emitted('update:pageSize')?.at(-1)).toEqual([50]);
  });

  it('loading 时翻页按钮禁用且不发出事件', async () => {
    const w = mountPagination({ page: 2, loading: true });
    await btn(w, '下一页').trigger('click');
    expect(w.emitted('update:page')).toBeUndefined();
  });

  it('单页数据（total <= pageSize）：显示第 1 / 1 页且双向禁用', () => {
    const w = mountPagination({ total: 30, pageSize: 30 });
    expect(w.text()).toContain('第 1 / 1 页');
    expect(btn(w, '上一页').attributes('disabled')).toBeDefined();
    expect(btn(w, '下一页').attributes('disabled')).toBeDefined();
  });

  it('页码越界自动收敛：第 5 页但只剩 2 页 → 发出 update:page 2（自动刷新数据缩小场景）', async () => {
    const w = mountPagination({ page: 5, total: 60, pageSize: 30 });
    await nextTick();
    expect(w.emitted('update:page')?.at(-1)).toEqual([2]);
  });

  it('showTotal 时展示「共 N 条」', () => {
    const w = mountPagination({ showTotal: true });
    expect(w.text()).toContain('共 378 条');
  });

  it('sizes 可自定义（默认 15/30/50/100）', () => {
    const w = mountPagination();
    const options = w.findAll('option').map((o) => Number(o.attributes('value')));
    expect(options).toEqual([15, 30, 50, 100]);
  });
});
