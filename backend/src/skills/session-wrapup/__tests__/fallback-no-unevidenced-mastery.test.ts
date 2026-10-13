/* eslint-disable @typescript-eslint/no-explicit-any -- wrapup 探针：模型 I/O 载荷形状内在动态（对齐 retention-claim-fidelity 先例） */
/**
 * 兜底总结不得无证据标 mastered/100（A/B 报告 D9，2026-10-13）。
 *
 * 背景：周雅 L3 的 wrapup `status="summary-only"`、`evaluation="unavailable"`、summary 来源 fallback，
 * 知识点 evidence 全写成"系统未能从课堂记录生成证据"，却把 4 个知识点一律标成 `mastered/progress=100`
 * ——这是"没有课堂证据也照样结课"，自相矛盾。
 *
 * 契约：
 * - fallback（callPrompt 两败 → catch 兜底）路径没有课堂证据，mastered 一律降级为 review，
 *   progress 收口到 90 上限；knowledgeSummary 不再宣称"N 个已经学会"；
 * - 非 mastered 条目原样保留 status/progress。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));
jest.mock('../../../gateway/api-gateway', () => ({ getAPIGateway: () => ({}) }));

import { sessionWrapupAgent, type SessionWrapupInput } from '../index';

function buildInput(): SessionWrapupInput {
  return {
    messages: [
      { role: 'user', content: '老师好' },
      { role: 'assistant', content: '我们开始学信度与效度。' },
    ],
    knowledgePoints: [
      { name: '信度', status: 'mastered', progress: 100 },
      { name: '效度', status: 'learning', progress: 40 },
    ],
    sessionInfo: {
      subject: '教育心理学',
      topic: '信度与效度',
      durationMinutes: 25,
      userMessageCount: 1,
      assistantMessageCount: 1,
    },
  };
}

describe('session-wrapup fallback：无证据不标 mastered（A/B 报告 D9）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('callPrompt 两败 → fallback summary 把 mastered 降级为 review，progress 收口到 90', async () => {
    mockCallPrompt.mockRejectedValue(new Error('upstream 503'));

    const result = await sessionWrapupAgent.generate(buildInput());

    expect(result.summarySource).toBe('fallback');
    expect(result.evaluationSource).toBe('unavailable');

    const mastered = result.summary.knowledgeItems.find((item) => item.name === '信度');
    expect(mastered?.status).toBe('review');
    expect(mastered?.progress).toBeLessThanOrEqual(90);
    expect(mastered?.evidence).toContain('知识看板快照');

    // 非 mastered 条目原样保留
    const learning = result.summary.knowledgeItems.find((item) => item.name === '效度');
    expect(learning?.status).toBe('learning');
    expect(learning?.progress).toBe(40);

    // 不再宣称"N 个已经学会"
    expect(result.summary.knowledgeSummary).not.toContain('已经学会');
    expect(result.summary.knowledgeSummary).toContain('知识看板快照');
  });

  it('progress=100 的 mastered 也不会以 100 出现（封顶 90）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('timeout 300000ms'));

    const result = await sessionWrapupAgent.generate(buildInput());
    const items = result.summary.knowledgeItems;
    expect(items.every((item) => (item.progress ?? 0) <= 90)).toBe(true);
    expect(items.some((item) => item.status === 'mastered')).toBe(false);
  });
});
