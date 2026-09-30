/**
 * V2Nav（P3-1：用户信息未加载时的兜底名）回归测试：
 * 兜底名必须为通用「学习者」（曾为「同学」），有用户信息时显示真实用户名。
 * 2026-09-30 壳改版：顶栏收成头像-only（原型同款），用户名移进头像菜单头 —— 先开菜单再断言。
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

async function mountNav() {
  const w = mount(V2Nav);
  await flushPromises();
  // 用户名住在头像菜单头里：点开菜单才能断言
  await w.find('.v2nav__avatar').trigger('click');
  return w;
}

describe('V2Nav 用户兜底名（P3-1）', () => {
  beforeEach(() => {
    userMock.user = null;
  });

  it('用户信息未加载：兜底为通用「学习者」（非「同学」）', async () => {
    const w = await mountNav();
    const name = w.find('.v2nav__name');
    expect(name.text()).toBe('学习者');
    expect(w.text()).not.toContain('同学');
  });

  it('用户信息未加载：头像字母取兜底名首字', async () => {
    const w = mount(V2Nav);
    await flushPromises();
    expect(w.find('.v2nav__avatar i').text()).toBe('学');
  });

  it('有用户信息：显示真实用户名', async () => {
    userMock.user = { id: 'u1', name: '小明' };
    const w = await mountNav();
    expect(w.find('.v2nav__name').text()).toBe('小明');
  });
});
