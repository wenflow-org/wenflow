/**
 * 用人设模拟试跑（2026-11-10 从「虚拟学习者」行菜单迁到 Skill 详情 → 试跑 → 「用人设模拟」）。
 *
 * 迁移动机：这条入口测的是**提示词**，人设只是测试夹具；挂在虚拟学习者列表里读成「试跑这个人」。
 * 这里继续钉住迁移前的那条运营口径：用例被跳过 ≠ 未通过——后端对「人设已被删除 / 模拟输入
 * 解析失败」走 skipped 通道，results 里没有该用例，页面必须给出原因而不是判失败。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { runEvalMock } = vi.hoisted(() => ({ runEvalMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminPromptOpsApi: { runEval: runEvalMock },
  adminSkillsApi: {
    getEffectiveSkillPrompt: vi.fn(async () => ({
      data: { data: { prompt: { version: 4, systemPrompt: '你是目标对话助手' } } },
    })),
  },
}));
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), close: vi.fn() },
}));
vi.mock('../live', async () => {
  const { ref: makeRef } = await import('vue');
  return {
    errMsg: (e: unknown) => String(e),
    liveVirtuals: makeRef([]),
    refreshLiveVirtuals: vi.fn(async () => {}),
  };
});

import PersonaTrial from '../skill-design/persona-trial.vue';
import { liveVirtuals } from '../live';

async function mountAndRun() {
  const w = mount(PersonaTrial, { props: { skillId: 'goal-conversation' } });
  await flushPromises();
  const run = w.find('.spt__run');
  expect(run.exists()).toBe(true);
  expect(run.attributes('disabled')).toBeUndefined();
  await run.trigger('click');
  await flushPromises();
  return w;
}

describe('用人设模拟试跑', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveVirtuals.value = [{ id: 'p1', name: '小陈' }] as never;
  });

  it('人设列表为空时不出试跑按钮并说明去哪创建', async () => {
    liveVirtuals.value = [];
    const w = mount(PersonaTrial, { props: { skillId: 'goal-conversation' } });
    await flushPromises();
    expect(w.find('.spt__run').attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('还没有虚拟学习者');
  });

  it('用例被跳过 → 显示后端给的原因，不报「未通过」', async () => {
    runEvalMock.mockResolvedValue({
      data: {
        data: {
          results: [],
          skipped: [{ caseId: 'pt-p1', caseName: '小陈', reason: '模拟学习者已被删除' }],
        },
      },
    });

    const w = await mountAndRun();

    expect(w.find('.spt__skip').text()).toBe('本次未执行：模拟学习者已被删除');
    expect(w.find('.mk-badge--ok').exists()).toBe(false);
    expect(w.find('.mk-badge--bad').exists()).toBe(false);
  });

  it('有结果 → 通过/检查项/对话轮次都渲染，请求带本页 Skill 与所选人设', async () => {
    runEvalMock.mockResolvedValue({
      data: {
        data: {
          results: [
            {
              caseId: 'pt-p1',
              passed: true,
              checks: { structuredOutputValid: true, stageValid: true },
              transcript: [{ role: 'goal_agent', round: 1, content: '你想先解决哪一步？' }],
              output: { fields: { stage: 'understanding' } },
            },
          ],
        },
      },
    });

    const w = await mountAndRun();

    expect(w.find('.mk-badge--ok').text()).toBe('通过');
    expect(w.find('.spt__verdict').text()).toContain('2/2 项检查通过');
    expect(w.find('.spt__transcript').text()).toContain('助手 · 第1轮');
    const arg = runEvalMock.mock.calls[0][0] as {
      agentId: string;
      adhocCases: Array<{ expectations: { mode: string; personaId: string } }>;
    };
    expect(arg.agentId).toBe('skill:goal-conversation');
    expect(arg.adhocCases[0].expectations.mode).toBe('simulated');
    expect(arg.adhocCases[0].expectations.personaId).toBe('p1');
  });
});
