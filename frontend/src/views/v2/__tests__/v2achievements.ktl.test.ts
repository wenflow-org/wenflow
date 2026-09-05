/**
 * V2Achievements（P3-4：成就条件 KTL 内部缩写直出）回归测试：
 * 服务端描述中的 KTL 直出前补全中文释义「知识掌握度（KTL）」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import V2Achievements from '../V2Achievements.vue';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({
  default: { get: getMock }
}));

vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

function achievement(description: string) {
  return {
    id: 'a1',
    name: '成就一',
    description,
    icon: '🏅',
    xpReward: 100,
    type: 'mastery',
    unlocked: false,
    progress: { current: 5, total: 9, percentage: 55 }
  };
}

async function mountAch(descriptions: string[]) {
  // 后端统一响应体 { success, data }（axios 拦截器解包后的形态）
  getMock.mockResolvedValue({ success: true, data: descriptions.map(achievement) });
  const w = mount(V2Achievements);
  await flushPromises();
  return w;
}

describe('V2Achievements 成就条件 KTL 中文释义（P3-4）', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('KTL 缩写直出前补全中文释义', async () => {
    const w = await mountAch(['KTL达到5.0']);
    expect(w.text()).toContain('知识掌握度（KTL）');
  });

  it('多档 KTL 条件全部替换（5.0/7.0/9.0）', async () => {
    const w = await mountAch(['KTL达到5.0', 'KTL达到7.0', 'KTL达到9.0']);
    const texts = w.findAll('.ach-card__desc').map((n) => n.text());
    expect(texts).toEqual([
      '知识掌握度（KTL）达到5.0',
      '知识掌握度（KTL）达到7.0',
      '知识掌握度（KTL）达到9.0'
    ]);
  });

  it('非 KTL 描述原样展示', async () => {
    const w = await mountAch(['连续学习 7 天']);
    expect(w.text()).toContain('连续学习 7 天');
  });
});
