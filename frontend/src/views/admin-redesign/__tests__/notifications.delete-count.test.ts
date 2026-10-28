/**
 * #12 回归：站内通知「删除」后，宿主徽标「站内通知 N」必须重取。
 * 根因：徽标计数由 reload() 内的 emit('count', total) 上报，本地删行不发上报 →
 * 计数驻留旧值。修复：删除成功后重跑列表加载器（reload）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Notifications from '../Notifications.vue';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn()
}));

vi.mock('@/api/adminApi', () => ({
  adminNotificationsApi: {
    list: h.list,
    remove: h.remove,
    send: vi.fn(async () => ({ data: { data: {} } }))
  },
  adminUsersApi: { getUsers: vi.fn(async () => ({ data: { data: { users: [] } } })) }
}));

vi.mock('../useConfirm', () => ({
  askConfirm: vi.fn(async () => true),
  doneConfirm: vi.fn(),
  failConfirm: vi.fn()
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function listPage(rows: number) {
  return {
    data: {
      data: {
        items: Array.from({ length: rows }, (_, i) => ({
          id: `n-${i + 1}`,
          userId: 'u1',
          title: `通知 ${i + 1}`,
          body: null,
          kind: 'system',
          link: null,
          isRead: false,
          createdAt: '2026-10-01T00:00:00Z',
          user: { id: 'u1', name: '甲', email: 'a@x.com' }
        })),
        pagination: { total: rows, page: 1, limit: 20 },
        unreadTotal: rows
      }
    }
  };
}

describe('站内通知：删除后徽标计数重取（#12）', () => {
  beforeEach(() => {
    h.list.mockReset();
    h.remove.mockReset();
    h.remove.mockResolvedValue({ data: {} });
  });

  it('删除一条通知后重新上报计数（站内通知 1 → 0）', async () => {
    h.list.mockResolvedValueOnce(listPage(1)).mockResolvedValueOnce(listPage(0));
    const w = mount(Notifications, { props: { embedded: true } });
    await flushPromises();
    await nextTick();
    await flushPromises();
    const before = w.emitted('count')!;
    expect(before[before.length - 1]).toEqual([1]);
    // 主操作归位卡头右组（2026-10-26 用户「重新设计一下」）：嵌入态同样有可见入口
    expect(w.find('.mk-card__head-right').text()).toContain('发送通知');
    // 2026-10-26：删除收进行尾 ⋯（原先每行一颗红删除，20 行连成一片红）
    await w.find('tbody tr .mk-menu__btn').trigger('click');
    const delBtn = w.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().trim() === '删除')!;
    expect(delBtn).toBeTruthy();
    await delBtn.trigger('click');
    await flushPromises();
    await nextTick();
    await flushPromises();
    const after = w.emitted('count')!;
    expect(after[after.length - 1]).toEqual([0]);
    w.unmount();
  });
});
