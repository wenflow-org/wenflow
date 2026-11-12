/**
 * 通知面板行语义 / 默认页签（2026-11-11 用户侧走查）
 *
 * ① 有未读通知时，铃铛默认落在「通知」页签（此前只要存在已完成 AI 任务就落 AI 任务，
 *    未读通知被藏在后面）。
 * ② 有目标链接的通知行才带 button 语义与 ›；没有链接的是纯信息行，不再渲染 role=button
 *    （避免键盘焦点落进死行）。
 * ③ 已完成 AI 任务行只在 metadata 给出 pathId/taskId 时才可点，否则保持记录形态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const learning = vi.hoisted(() => ({ getPaths: vi.fn() }));
const aiTeaching = vi.hoisted(() => ({ getActiveSessions: vi.fn() }));
const getAgentLogs = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({ default: api, API_BASE_URL: '/api' }));
vi.mock('@/api/learning', () => ({ learningAPI: learning }));
vi.mock('@/api/aiTeaching', () => ({ aiTeachingAPI: aiTeaching }));
vi.mock('@/api/userCustom', () => ({ getAgentLogs }));
vi.mock('@/views/admin-redesign/live', () => ({ timeAgo: () => '刚刚' }));
vi.mock('./../agent-labels', () => ({ agentLabelOf: () => '智能体' }));
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});

import V2NotifCenter from '../V2NotifCenter.vue';

const NOTIFS = [
  {
    id: 'n1', title: '学习路径已生成', body: '点这里查看新路径', kind: 'path',
    link: '/learning-path/p1', isRead: false, createdAt: '2026-11-11T08:00:00Z'
  },
  {
    id: 'n2', title: '系统维护提醒', body: '本周日凌晨维护', kind: 'system',
    link: null, isRead: true, createdAt: '2026-11-10T08:00:00Z'
  }
];

async function mountCenter() {
  const linkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' };
  const w = mount(V2NotifCenter, {
    global: { stubs: { 'router-link': linkStub, RouterLink: linkStub } }
  });
  await flushPromises();
  await flushPromises();
  return w;
}

describe('V2NotifCenter 通知行与默认页签', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url: string, cfg?: { params?: { limit?: number } }) => {
      if (String(url).includes('/notifications')) {
        if (cfg?.params?.limit === 1) return Promise.resolve({ data: { unread: 1 } });
        return Promise.resolve({
          data: { items: NOTIFS, pagination: { total: NOTIFS.length }, unread: 1 }
        });
      }
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValue({ data: {} });
    learning.getPaths.mockResolvedValue([]);
    aiTeaching.getActiveSessions.mockResolvedValue([]);
    getAgentLogs.mockResolvedValue({
      data: {
        logs: [{
          id: 'L1', agentId: 'path-agent', success: true, calledAt: '2026-11-11T07:00:00Z',
          metadata: JSON.stringify({ pathId: 'p1', subject: '多元积分' })
        }]
      }
    });
  });

  it('有未读通知时默认打开「通知」页签', async () => {
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    const tabs = w.findAll('.nc__tab');
    expect(tabs[0].classes()).toContain('nc__tab--on');
    expect(tabs[0].text()).toContain('1 未读');
    expect(w.text()).toContain('学习路径已生成');
  });

  it('有链接的通知行是 button 语义并带 ›；无链接行不进焦点序列', async () => {
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();

    const rows = w.findAll('.nc__item');
    const linked = rows.find((r) => r.text().includes('学习路径已生成'))!;
    const plain = rows.find((r) => r.text().includes('系统维护提醒'))!;
    expect(linked.attributes('role')).toBe('button');
    expect(linked.attributes('tabindex')).toBe('0');
    expect(linked.find('.nc__item-go').exists()).toBe(true);
    expect(plain.attributes('role'), '无目标的通知不该装成按钮').toBeUndefined();
    expect(plain.attributes('tabindex')).toBeUndefined();
    expect(plain.find('.nc__item-go').exists()).toBe(false);
  });

  it('AI 任务行有 pathId 时可点进路径，并保留段末「全部调用日志」出口', async () => {
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();
    await w.findAll('.nc__tab')[1].trigger('click');
    await flushPromises();

    const link = w.find('.nc__task-content--link');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toContain('/learning-path/p1');
    expect(w.find('.nc__all-logs').exists()).toBe(true);
    expect(w.find('.nc__all-logs').attributes('href')).toBe('/user/agent-logs');
  });

  it('× 同级的操作有明确文本（title/aria-label 说「移除」）', async () => {
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();
    await w.findAll('.nc__tab')[1].trigger('click');
    await flushPromises();

    const x = w.find('.nc__task-dismiss');
    expect(x.attributes('title')).toBe('移除');
    expect(x.attributes('aria-label')).toBe('移除这条动态');
  });

  it('日志接口失败时给错误态与重试，不读成「暂无 AI 任务」', async () => {
    getAgentLogs.mockRejectedValue(new Error('boom'));
    const w = await mountCenter();
    await w.find('.nc__bell').trigger('click');
    await flushPromises();
    await w.findAll('.nc__tab')[1].trigger('click');
    await flushPromises();

    expect(w.text()).toContain('AI 任务记录加载失败');
    expect(w.find('.nc__empty--error .nc__retry').exists()).toBe(true);
    expect(w.text()).not.toContain('暂无 AI 任务');
  });
});
