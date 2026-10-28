/**
 * 术语表 URL 双向同步：
 * - 深链 ?q=&cat= 同时恢复搜索词与分类（此前只读 q，cat 被忽略）；
 * - 用户改搜索/分类后 replace 回 URL，刷新或复制链接不丢筛选。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import AdminGlossary from '../AdminGlossary.vue';

const { glossaryMock } = vi.hoisted(() => ({
  glossaryMock: vi.fn(async () => ({
    data: {
      data: {
        promptRoles: [],
        completionStates: [],
        semantics: [],
        stages: [],
        terms: [
          { term: '健康分', def: '总览页的成功率评分', category: 'health' },
          { term: '掌握度', def: '知识点的掌握程度', category: 'concept' }
        ],
        docs: []
      }
    }
  }))
}));

vi.mock('@/api/adminApi', () => ({
  adminGlossaryApi: { get: glossaryMock }
}));

async function mountAt(fullPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/glossary', component: AdminGlossary }]
  });
  await router.push(fullPath);
  await router.isReady();
  const w = mount(AdminGlossary, { global: { plugins: [router] } });
  await flushPromises();
  await flushPromises();
  return { w, router };
}

describe('术语表 URL 同步', () => {
  it('深链同时恢复搜索词与分类', async () => {
    const { w } = await mountAt('/admin/glossary?q=健康&cat=health');
    expect((w.find('input[type="search"]').element as HTMLInputElement).value).toBe('健康');
    expect(w.find('.mk-pillselect').attributes('data-value')).toBe('health');
    expect(w.text()).toContain('健康中心术语');
    w.unmount();
  });

  it('修改搜索词后 replace 回 URL，并保留当前分类', async () => {
    const { w, router } = await mountAt('/admin/glossary?cat=health');
    await w.find('input[type="search"]').setValue('掌握');
    await new Promise((resolve) => setTimeout(resolve, 320));
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('掌握');
    expect(router.currentRoute.value.query.cat).toBe('health');
    w.unmount();
  });

  it('非法分类深链回落全部', async () => {
    const { w } = await mountAt('/admin/glossary?cat=nope');
    expect(w.find('.mk-pillselect').attributes('data-value')).toBe('all');
    w.unmount();
  });
});
