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
  it('总页数 = ceil(total/pageSize)：378/30 → 13 页，展示「第 X / N 页」', () => {
    const w = mountPagination();
    expect(w.text()).toContain('第 1 / 13 页');
  });

  it('首末页边界：第 1 页禁用上一页、第 13 页禁用下一页', () => {
    const w1 = mountPagination();
    const btns = w1.findAll('button');
    expect(btns[0].attributes('disabled')).toBeDefined();
    expect(btns[1].attributes('disabled')).toBeUndefined();

    const w2 = mountPagination({ page: 13 });
    const btns2 = w2.findAll('button');
    expect(btns2[0].attributes('disabled')).toBeUndefined();
    expect(btns2[1].attributes('disabled')).toBeDefined();
  });

  it('翻页点击发出 update:page（上一页 / 下一页）', async () => {
    const w = mountPagination({ page: 2 });
    await w.findAll('button')[0].trigger('click');
    expect(w.emitted('update:page')?.at(-1)).toEqual([1]);
    await w.findAll('button')[1].trigger('click');
    expect(w.emitted('update:page')?.at(-1)).toEqual([3]);
  });

  it('每页条数选择发出 update:pageSize', async () => {
    const w = mountPagination();
    await w.find('select').setValue('50');
    expect(w.emitted('update:pageSize')?.at(-1)).toEqual([50]);
  });

  it('loading 时翻页按钮禁用且不发出事件', async () => {
    const w = mountPagination({ page: 2, loading: true });
    await w.findAll('button')[1].trigger('click');
    expect(w.emitted('update:page')).toBeUndefined();
  });

  it('单页数据（total <= pageSize）：显示第 1 / 1 页且双向禁用', () => {
    const w = mountPagination({ total: 30, pageSize: 30 });
    expect(w.text()).toContain('第 1 / 1 页');
    const btns = w.findAll('button');
    expect(btns[0].attributes('disabled')).toBeDefined();
    expect(btns[1].attributes('disabled')).toBeDefined();
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
