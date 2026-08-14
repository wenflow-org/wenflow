/**
 * Announcements 列表布局冒烟（P1：两行公告下方 760px 全宽空白灰区修复）：
 * 1. 有数据时列表容器带 an-list 兜底高度类（复用空态 --mk-empty-min-h 口径），卡片铺满页面
 * 2. 空态（无数据）不渲染 an-list，走 mk-empty 空态
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Announcements from '../Announcements.vue';
import { liveAnnouncements } from '../live';

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return vi.fn(async () => ({ data: {} }));
      }
    })
}));

vi.mock('../live', async () => {
  const { ref } = await import('vue');
  return {
    liveAnnouncements: ref<Record<string, unknown>[]>([]),
    liveLoading: ref(false),
    liveFailures: ref<Record<string, string>>({}),
    liveCreateAnnouncement: vi.fn(async () => {}),
    liveUpdateAnnouncement: vi.fn(async () => {}),
    livePublishAnnouncement: vi.fn(async () => {}),
    liveArchiveAnnouncement: vi.fn(async () => {}),
    liveDeleteAnnouncement: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  };
});

vi.mock('../store', async () => {
  const { ref } = await import('vue');
  return {
    dataSource: ref('live'),
    isLive: ref(true),
    intent: { quickAction: '' }
  };
});

vi.mock('@/api/adminApi', () => ({
  adminAnnouncementsApi: apiObject()
}));

function makeAnnouncement(id: string) {
  return {
    id,
    title: `公告 ${id}`,
    body: '正文',
    severity: 'info' as 'info' | 'warning' | 'critical',
    status: 'published' as 'draft' | 'published' | 'archived',
    publishedAt: '2026-07-25T02:00:00Z',
    expiresAt: null,
    createdBy: null,
    createdAt: '2026-07-20T02:00:00Z'
  };
}

async function mountAnnouncements() {
  const w = mount(Announcements);
  await flushPromises();
  await nextTick();
  return w;
}

describe('Announcements 列表布局（P1：空白灰区消除）', () => {
  beforeEach(() => {
    liveAnnouncements.value = [];
  });

  it('有数据时列表容器带 an-list 类（min-height 兜底，行数少时卡片铺满页面）', async () => {
    liveAnnouncements.value = [makeAnnouncement('a1'), makeAnnouncement('a2')];
    const w = await mountAnnouncements();
    const list = w.find('.an-list');
    expect(list.exists()).toBe(true);
    expect(list.classes()).toContain('mk-table-scroll');
    expect(list.find('table.mk-table').exists()).toBe(true);
    expect(w.findAll('tbody tr')).toHaveLength(2);
    w.unmount();
  });

  it('空态（无数据）不渲染 an-list，走 mk-empty 空态', async () => {
    const w = await mountAnnouncements();
    expect(w.find('.an-list').exists()).toBe(false);
    expect(w.find('.mk-empty').exists()).toBe(true);
    w.unmount();
  });
});
