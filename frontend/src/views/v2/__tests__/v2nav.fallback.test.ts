/**
 * V2Nav（P3-1：用户信息未加载时的兜底名）回归测试：
 * 兜底名必须为通用「学习者」（曾为「同学」），有用户信息时显示真实用户名。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import V2Nav from '../V2Nav.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/dashboard', name: 'V2Dashboard' }),
  useRouter: () => ({ push: vi.fn() })
}));

const userMock = vi.hoisted(() => ({
  user: null as { id: string; name: string } | null,
  logout: vi.fn()
}));

vi.mock('@/stores/user', () => ({
  useUserStore: () => userMock
}));

vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn() }
}));

function mountNav() {
  return mount(V2Nav);
}

describe('V2Nav 用户兜底名（P3-1）', () => {
  beforeEach(() => {
    userMock.user = null;
  });

  it('用户信息未加载：兜底为通用「学习者」（非「同学」）', async () => {
    const w = mountNav();
    await flushPromises();
    const name = w.find('.v2nav__name');
    expect(name.text()).toBe('学习者');
    expect(w.text()).not.toContain('同学');
  });

  it('用户信息未加载：头像字母取兜底名首字', async () => {
    const w = mountNav();
    await flushPromises();
    expect(w.find('.v2nav__avatar i').text()).toBe('学');
  });

  it('有用户信息：显示真实用户名', async () => {
    userMock.user = { id: 'u1', name: '小明' };
    const w = mountNav();
    await flushPromises();
    expect(w.find('.v2nav__name').text()).toBe('小明');
  });
});
