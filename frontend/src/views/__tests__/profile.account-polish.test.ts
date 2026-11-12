/**
 * 账户页：最近登录空值语义 + 「编辑」入口可识别（2026-11-11 走查）
 *
 * ① 「最近登录 —」把占位符当句末标点读：没有登录记录时直接写「暂无记录」；
 *    注册时间等缺失日期统一 '-'（同一页两种占位符已收敛）。
 * ② 姓名旁的「编辑」只有两个字，读屏只报「编辑」；补 aria-label / title。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const user = vi.hoisted(() => ({
  name: '潘澈',
  email: 'learner@example.com',
  xp: 2360,
  level: 5,
  role: 'user',
  createdAt: '2026-11-08T12:00:00.000Z',
  lastLoginAt: null
}));

vi.mock('../../stores/user', () => ({
  useUserStore: () => ({
    user,
    fetchProfile: vi.fn(async () => user),
    updateProfile: vi.fn(async () => user)
  })
}));
vi.mock('@/utils/api', () => ({ default: { get: vi.fn(async () => ({ data: [] })) } }));
vi.mock('@/api/learning', () => ({ learningAPI: { getConceptGraph: vi.fn(async () => ({ nodes: [] })) } }));
vi.mock('@/components/user/CapabilityShell.vue', () => ({ default: { template: '<div><slot /></div>' } }));

import Profile from '../Profile.vue';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../Profile.vue'), 'utf8');
const css = source.slice(source.indexOf('<style'));

describe('账户页：空值与入口', () => {
  it('最近登录没有记录时写「暂无记录」，不是句尾一个 —', async () => {
    const w = mount(Profile);
    await flushPromises();

    expect(w.text()).toContain('最近登录 暂无记录');
    expect(w.text()).not.toContain('最近登录 —');
    expect(source).toContain('function formatLastLogin');
    w.unmount();
  });

  it('注册日期缺失时用半角短横而不是长破折号（同页占位符统一）', () => {
    expect(source).toContain("if (!value) return '-'");
    expect(source).not.toContain("if (!value) return '—'");
  });

  it('「编辑」带上编辑对象名，读屏不只听到「编辑」', () => {
    expect(source).toContain('aria-label="编辑用户名"');
    expect(source).toContain('title="修改显示名称"');
  });

  it('两行快捷入口的箭头与整行一起响应悬停', () => {
    expect(css).toMatch(/\.profile-menu__item:hover \{[^}]*background:/);
    expect(css).toMatch(/\.profile-menu__item:hover \.profile-menu__chev \{[^}]*transform:\s*translateX/);
  });
});
