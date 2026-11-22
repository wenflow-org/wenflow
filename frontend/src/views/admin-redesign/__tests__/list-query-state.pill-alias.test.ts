/**
 * useListQueryState pill 别名回归（2026-11-22：LearnerCenter 低置信筛选的 URL 值从
 * 历史 stale 改名 lowconf，共享钩子加读侧别名——旧深链不断，回写只写现行值，自然完成迁移）。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { useListQueryState } from '../learner-profile';

function makeHost() {
  const pill = ref('all');
  const page = ref(1);
  const Host = defineComponent({
    setup() {
      useListQueryState({
        pill,
        page,
        allowedPills: ['all', 'risk', 'watch', 'lowconf'],
        pillAliases: { stale: 'lowconf' }
      });
      return () => null;
    }
  });
  return { Host, pill, page };
}

async function mountAt(path: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }]
  });
  await router.push(path);
  await router.isReady();
  return router;
}

describe('useListQueryState · pill 历史值别名', () => {
  it('旧深链 ?pill=stale 落位到现行值 lowconf（读侧映射，白名单前执行）', async () => {
    const router = await mountAt('/admin/learners?pill=stale');
    const { Host, pill } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(pill.value).toBe('lowconf');
  });

  it('现行值直链照常落位；写回只写现行值（stale 不复活）', async () => {
    const router = await mountAt('/admin/learners?pill=lowconf');
    const { Host, pill } = makeHost();
    const w = mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(pill.value).toBe('lowconf');
    // 状态变化（取消筛选）→ 回写 desired()：URL 不应出现 stale
    pill.value = 'all';
    await nextTick();
    await router.isReady();
    expect(String(router.currentRoute.value.query.pill ?? '')).not.toContain('stale');
    w.unmount();
  });

  it('白名单外且无别名的脏值仍回落 all（既有语义不变）', async () => {
    const router = await mountAt('/admin/learners?pill=archived');
    const { Host, pill } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(pill.value).toBe('all');
  });
});
