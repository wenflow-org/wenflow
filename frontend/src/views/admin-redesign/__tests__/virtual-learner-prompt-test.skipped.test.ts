/**
 * 提示词试跑：用例被跳过 ≠ 未通过（2026-11-09 运营流程核查）。
 *
 * 后端对「引用的虚拟学习者已删除 / 模拟输入解析失败」的用例走 skipped 通道，results 里没有它；
 * 旧实现把「没有结果」当「未通过」，提示语还让人去翻字段检查明细——运营会去找不存在的东西。
 * 这里钉住：跳过时给出原因、不出现通过/未通过徽标。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { runEvalMock } = vi.hoisted(() => ({ runEvalMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminPromptOpsApi: { runEval: runEvalMock },
  adminSkillsApi: {
    getEffectiveSkillPrompt: vi.fn(async () => ({
      data: { data: { prompt: { version: 3, systemPrompt: '你是目标对话助手' } } },
    })),
  },
}));
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), close: vi.fn() },
}));
vi.mock('../live', () => ({ errMsg: (e: unknown) => String(e) }));

import VirtualLearnerPromptTest from '../VirtualLearnerPromptTest.vue';
import { toast } from '@/utils/toast';

const mountOpts = { attachTo: document.body, global: { stubs: { teleport: true } } };

async function openAndRun() {
  const w = mount(VirtualLearnerPromptTest, mountOpts);
  (w.vm as unknown as { open: (s: unknown) => void }).open({ id: 'p1', name: '小陈' });
  await flushPromises();
  const runBtn = document.body.querySelector('.mk-btn--primary') as HTMLButtonElement;
  runBtn.click();
  await flushPromises();
  return w;
}

describe('提示词试跑：skipped 通道', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
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

    const w = await openAndRun();

    const skip = document.body.querySelector('.pt-skip');
    expect(skip?.textContent).toBe('本次未执行：模拟学习者已被删除');
    expect(document.body.textContent).not.toContain('未通过');
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('未执行'));
    w.unmount();
  });

  it('正常返回结果时仍按通过/未通过判定（跳过提示不残留）', async () => {
    runEvalMock.mockResolvedValue({
      data: { data: { results: [{ caseId: 'pt-p1', passed: false, checks: { a: true, b: false } }] } },
    });

    const w = await openAndRun();

    expect(document.body.querySelector('.pt-skip')).toBeNull();
    expect(document.body.textContent).toContain('未通过');
    w.unmount();
  });

  it('后端返回结果但 caseId 不匹配（多用例批跑）→ 取第一条，不误报跳过', async () => {
    runEvalMock.mockResolvedValue({
      data: { data: { results: [{ caseId: 'other', passed: true }] } },
    });

    const w = await openAndRun();

    expect(document.body.querySelector('.pt-skip')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('测试通过'));
    w.unmount();
  });
});
