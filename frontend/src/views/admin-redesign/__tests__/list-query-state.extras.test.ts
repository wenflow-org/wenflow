/**
 * useListQueryState 附加筛选轴（extra）回归（2026-10-13 运营走查 O2）。
 *
 * 背景：列表筛选只在内存里时，进详情返回 / 刷新 / 分享都会丢（教学会话实测「异常18」→
 * 返回或刷新后回到全部 167 条）。仓库既有单点 useListQueryState 只承载 pill/keyword/page，
 * 教学会话还有「异常状态组」「状态分布条分段」两个开关，故补 extra 轴。
 *
 * 本文件只测组合式函数本身（挂一个最小宿主组件），页面级采纳见 url-state-adoption.test.ts。
 */
import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { useListQueryState } from '../learner-profile';

function makeHost(initial?: { pill?: string; keyword?: string; page?: number; abn?: string; band?: string }) {
  const pill = ref(initial?.pill ?? 'all');
  const keyword = ref(initial?.keyword ?? '');
  const page = ref(initial?.page ?? 1);
  const abn = ref(initial?.abn ?? '');
  const band = ref(initial?.band ?? '');
  const Host = defineComponent({
    setup() {
      useListQueryState({
        pill,
        keyword,
        page,
        allowedPills: ['all', 'active', 'attention', 'missing'],
        extra: [
          { key: 'abn', get: () => abn.value, set: (v) => (abn.value = v === '1' ? '1' : ''), allowed: ['1'] },
          { key: 'band', get: () => band.value, set: (v) => (band.value = v) }
        ]
      });
      return () => null;
    }
  });
  return { Host, pill, keyword, page, abn, band };
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

describe('useListQueryState · 基础轴', () => {
  it('挂载按 URL 落位（深链 / 返回 / 刷新还原）', async () => {
    const router = await mountAt('/admin/teaching-sessions?pill=missing&q=地理&page=2');
    const { Host, pill, keyword, page } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(pill.value).toBe('missing');
    expect(keyword.value).toBe('地理');
    expect(page.value).toBe(2);
  });

  it('筛选变化回写 URL，缺省值不写（URL 短且可读）', async () => {
    const router = await mountAt('/admin/teaching-sessions');
    const { Host, pill, keyword, page } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    pill.value = 'attention';
    keyword.value = '孙浩';
    page.value = 3;
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ pill: 'attention', q: '孙浩', page: '3' });
    pill.value = 'all';
    keyword.value = '';
    page.value = 1;
    await flushPromises();
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    expect(router.currentRoute.value.query.page).toBeUndefined();
  });

  it('脏深链：pill 不在白名单 → 回落 all，不把列表筛空', async () => {
    const router = await mountAt('/admin/teaching-sessions?pill=不存在的词');
    const { Host, pill } = makeHost();
    const wrapper = mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(pill.value).toBe('all');
    wrapper.unmount();
  });
});

describe('useListQueryState · extra 附加轴（本次新增）', () => {
  it('URL → 状态：extra 键按 set 落位', async () => {
    const router = await mountAt('/admin/teaching-sessions?abn=1&band=abnormal');
    const { Host, abn, band } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(abn.value).toBe('1');
    expect(band.value).toBe('abnormal');
  });

  it('状态 → URL：extra 变化写进 URL，回到缺省即删键', async () => {
    const router = await mountAt('/admin/teaching-sessions');
    const { Host, abn, band } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    abn.value = '1';
    band.value = 'running';
    await flushPromises();
    expect(router.currentRoute.value.query.abn).toBe('1');
    expect(router.currentRoute.value.query.band).toBe('running');
    abn.value = '';
    band.value = '';
    await flushPromises();
    expect(router.currentRoute.value.query.abn).toBeUndefined();
    expect(router.currentRoute.value.query.band).toBeUndefined();
  });

  it('extra 白名单：非法值按缺省处理（不把列表筛空）', async () => {
    const router = await mountAt('/admin/teaching-sessions?abn=9');
    const { Host, abn } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(abn.value).toBe('');
  });

  it('隔一个历史条目（列表 → 详情 → 后退）：URL 带着筛选，状态随 URL 复原', async () => {
    const router = await mountAt('/admin/teaching-sessions');
    const { Host, band } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    band.value = 'abnormal';
    await flushPromises();
    // 开二级页（AdminConsole 以 {...route.query, view, id} 拼详情 URL）
    await router.push('/admin/teaching-sessions?band=abnormal&view=session-real&id=x');
    await flushPromises();
    expect(band.value).toBe('abnormal');
    await router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.band).toBe('abnormal');
    expect(band.value).toBe('abnormal');
  });

  it('外部改 URL（手改地址 / 前进后退落位）→ 状态跟着走', async () => {
    const router = await mountAt('/admin/teaching-sessions?band=abnormal');
    const { Host, band } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    expect(band.value).toBe('abnormal');
    await router.replace({ query: {} });
    await flushPromises();
    expect(band.value).toBe('');
  });
});

describe('useListQueryState · 无 Router 上下文降级', () => {
  it('单测直接 mount（未装 router）→ 纯内存，不抛错也不写 URL', async () => {
    const { Host, pill } = makeHost();
    const wrapper = mount(Host);
    await nextTick();
    pill.value = 'missing';
    await nextTick();
    expect(pill.value).toBe('missing');
    wrapper.unmount();
  });
});

describe('useListQueryState · 只动自己的键', () => {
  it('二级页的 view/id 等其它 query 原样保留', async () => {
    const router = await mountAt('/admin/teaching-sessions?view=session-real&id=abc');
    const { Host, pill } = makeHost();
    mount(Host, { global: { plugins: [router] } });
    await nextTick();
    pill.value = 'missing';
    await flushPromises();
    expect(router.currentRoute.value.query.view).toBe('session-real');
    expect(router.currentRoute.value.query.id).toBe('abc');
    expect(router.currentRoute.value.query.pill).toBe('missing');
  });
});
