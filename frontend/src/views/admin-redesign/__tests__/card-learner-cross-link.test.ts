/**
 * 卡库 → 虚拟学习者 的来源回指（2026-10-07，2026-10-24 收窄为单向）：
 * 卡与虚拟学习者是同一条档案记录（卡库 id = virtual_learner_profiles 主键），
 * 返回要落在来的那一层——走既有「面包屑 = subPage.from」机制，不自造返回钮：
 *  - 画像页 ⋯「查看来源卡」→ openSubPage('card', pid, from=virtual)
 *  - 列表行 ⋯「查看来源卡」→ openSubPage('card', 行 id)（列表是一级页，无 from）
 * 卡详情 → 画像的运行视图入口已撤（2026-10-24 用户「卡不是静态的吗」）：卡库只做静态模板，
 * 运行/记忆属于创建出来的实例，入口在「虚拟学习者」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';

const { openSubPageMock, apiObject } = vi.hoisted(() => {
  /* 画像页挂载即打多个接口（详情/故事/记忆/日程…），一律回 { data: {} } 空壳 */
  const apiObject = (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    });
  return { openSubPageMock: vi.fn(), apiObject };
});

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/api/adminApi', () => ({ adminVirtualLearnersApi: apiObject() }));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveVirtuals: ref([]),
    liveGetVirtualDetail: vi.fn(async () => ({
      profile: { id: 'p1', nickname: '高一学生小陈', knowledgeLevel: 'beginner' },
      sessions: []
    })),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e)
  };
});

/* from 的回跳由 closeSubPage 实现，本文件只校验 openSubPage 的入参契约 */
vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return { ...actual, openSubPage: openSubPageMock };
});

import VirtualProfile from '../VirtualProfile.vue';
import { subPage } from '../store';
import { liveGetVirtualDetail } from '../live';

async function mountProfile() {
  const w = shallowMount(VirtualProfile);
  await flushPromises();
  await nextTick();
  await flushPromises();
  return w;
}

describe('画像页 → 来源卡（双向互链）', () => {
  beforeEach(() => {
    openSubPageMock.mockClear();
    subPage.value = { view: 'virtual', id: 'p1', label: '高一学生小陈' };
  });

  it('身份卡本身：菜单叫「查看身份卡」，点击带 from 指向本画像（返回靠面包屑回跳）', async () => {
    const w = await mountProfile();
    expect(w.text()).toContain('高一学生小陈');
    const trigger = w.find('.vp-tabsrow__ops .mk-menu__btn');
    expect(trigger.exists()).toBe(true);
    await trigger.trigger('click');
    await nextTick();
    const item = w.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().includes('查看身份卡'));
    expect(item, '画像页缺少回卡库的入口').toBeTruthy();
    await item!.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('card', 'p1', {
      // from.label 用视图名：卡与画像同一实体同名，用画像名会拼出「郑凯 / 郑凯」
      from: { view: 'virtual', id: 'p1', label: '画像' }
    });
    w.unmount();
  });

  it('派生实例：菜单叫「查看来源卡」，打开 derivedFrom 的原卡而不是自己的卡', async () => {
    vi.mocked(liveGetVirtualDetail).mockResolvedValueOnce({
      profile: {
        id: 'p1',
        nickname: '实例小陈',
        knowledgeLevel: 'beginner',
        derivedFrom: { profileId: 'card-9', name: '源卡小陈' }
      },
      sessions: []
    } as never);
    const w = await mountProfile();
    await w.find('.vp-tabsrow__ops .mk-menu__btn').trigger('click');
    await nextTick();
    const item = w.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().includes('查看来源卡'));
    expect(item).toBeTruthy();
    await item!.trigger('click');
    expect(openSubPageMock).toHaveBeenCalledWith('card', 'card-9', {
      from: { view: 'virtual', id: 'p1', label: '画像' }
    });
    w.unmount();
  });

  it('卡入口不依赖绑定账号（userId 缺失时仍在菜单里，与两条账号入口不同档）', async () => {
    const w = await mountProfile();
    // 详情 mock 未给 userId → 两条账号级入口隐藏
    expect(w.text()).not.toContain('查真实学习者详情');
    await w.find('.vp-tabsrow__ops .mk-menu__btn').trigger('click');
    await nextTick();
    const labels = w.findAll('.mk-menu__pop .mk-menu__item').map((b) => b.text());
    expect(labels.some((t) => t.includes('查看身份卡'))).toBe(true);
    w.unmount();
  });
});
