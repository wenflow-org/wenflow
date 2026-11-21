/**
 * JSON（非流式）回复通道的请求体回归（2026-11-21）。
 *
 * 背景：SSE 通道一直携带前置自测作答，但 `replyGoalConversation` 的 JSON 回退
 * 曾只带 `confirmProposal`——传输层回退时用户答过的题会在无提示的情况下丢失，
 * 后端确定性判分键随之缺失。这里直接锁住 HTTP 请求体：
 * - 有作答 → `probeAnswers` 原样进 body；
 * - 无作答 → 不写空数组（与流式 path 的「有才带」口径一致）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/utils/api', () => ({
  default: http,
  AI_REQUEST_TIMEOUT: 120_000,
}));

// 该模块同时导出 SSE 版本；本文件只测非流式，mock 掉以免加载真实传输层。
vi.mock('@/utils/sse', () => ({ streamSsePost: vi.fn() }));

import { replyGoalConversation } from '../goalConversation';

function envelope(text = '好的') {
  return {
    success: true,
    data: {
      userVisible: text,
      internal: {
        core: { conversationId: 'gc_1', stage: 'proposing', confidence: 0.8, isCompleted: false },
        ext: { goalConversation: { understanding: {}, quickReplies: [] } },
      },
      renderHints: { quickReplies: [] },
      schemaVersion: 'agent-output-v1',
      meta: {},
    },
  };
}

describe('replyGoalConversation 的 JSON 请求体', () => {
  beforeEach(() => {
    http.post.mockReset();
  });

  it('确认时携带 probeAnswers（与 SSE 通道同权，不静默丢题）', async () => {
    http.post.mockResolvedValueOnce(envelope());

    const probeAnswers = [
      { probeId: 'probe-1', userAnswer: 'A', targetConcept: '社会领域' },
      { probeId: 'probe-2', userAnswer: 'B' },
    ];
    await replyGoalConversation('gc_1', '确认并生成路径', { confirmProposal: true, probeAnswers });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = http.post.mock.calls[0];
    expect(url).toBe('/goal-conversation/gc_1/reply');
    expect(body).toMatchObject({
      input: { text: '确认并生成路径' },
      contextMode: 'recent',
      confirmProposal: true,
      probeAnswers,
    });
    expect(config).toMatchObject({ timeout: 120_000 });
  });

  it('没有作答时不写空的 probeAnswers 键', async () => {
    http.post.mockResolvedValueOnce(envelope());

    await replyGoalConversation('gc_1', '继续', { probeAnswers: [] });

    const [, body] = http.post.mock.calls[0];
    expect(body).not.toHaveProperty('probeAnswers');
    expect(body.confirmProposal).toBe(false);
  });
});
