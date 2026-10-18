/**
 * VL 模拟器的可见上下文配图（#123 验收②的管道段）。
 *
 * 语义：payload 仍是既有 JSON 文本（prompt 与缓存形态不变）；配图作为 image_url 内容块
 * 附在 user 消息尾部，模拟学习者与真实学生一样"看得见"课堂配图。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { virtualLearnerLearnTurnSimulator, type LearnLearnerSimulationInput } from '../index';
import { collectVisibleHistoryImages } from '../../virtual-learner-shared';

const png = (n: number) => `data:image/png;base64,${'E'.repeat(n)}`;

const baseInput: LearnLearnerSimulationInput = {
  learner: {},
  story: null,
  visibleContext: { history: [], lastTeacherMessage: '' },
  currentPhase: 'trying',
  previousLearnerState: null,
  currentTask: null,
  knowledgeSnapshot: [],
};

interface SpecWithMessages { buildMessages: (args: { input: unknown; systemPrompt: string; userPayload: string; retryMessage: string | null; runtime: Record<string, unknown> }) => Array<{ role: string; content: unknown }> }

function buildMessagesFromSpec(specInput: unknown, spec: unknown) {
  return (spec as SpecWithMessages).buildMessages({
    input: specInput,
    systemPrompt: 'SYS',
    userPayload: '{"a":1}',
    retryMessage: null,
    runtime: {},
  });
}

describe('collectVisibleHistoryImages', () => {
  it('按历史顺序收集配图，忽略无图消息与非法结构', () => {
    const images = collectVisibleHistoryImages([
      { role: 'learner', content: '我在' },
      { role: 'teacher', content: '看这张表', images: [{ url: png(1), caption: '核对框架' }] },
      { role: 'teacher', content: '再看这张', images: [{ url: png(2) }] },
    ]);
    expect(images.map((image) => image.url)).toEqual([png(1), png(2)]);
    expect(collectVisibleHistoryImages(null)).toEqual([]);
    expect(collectVisibleHistoryImages('nope')).toEqual([]);
  });
});

describe('learn-turn 模拟器 buildMessages × 配图', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: { reply: '我试着写一下。', learnerState: {} },
      debug: { durationMs: 1 },
    });
  });

  it('历史带图 → user 消息为内容块数组：payload 文本在前、标签行与图片块在后', async () => {
    const input: LearnLearnerSimulationInput = {
      ...baseInput,
      visibleContext: {
        history: [
          { role: 'learner', content: '老师好' },
          { role: 'teacher', content: '看这张表', images: [{ url: png(3), caption: '三列核对框架' }] },
        ],
        lastTeacherMessage: '看这张表',
      },
    };
    await virtualLearnerLearnTurnSimulator(input);
    const spec = mockCallPrompt.mock.calls[0][0];
    const messages = buildMessagesFromSpec(input, spec);
    expect(messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(messages[1].content).toEqual([
      { type: 'text', text: '{"a":1}' },
      { type: 'text', text: '【课堂配图】三列核对框架' },
      { type: 'image_url', image_url: { url: png(3) } },
    ]);
  });

  it('历史无图 → user 消息保持字符串（纯文本回退，请求形态不变）', async () => {
    const input: LearnLearnerSimulationInput = {
      ...baseInput,
      visibleContext: {
        history: [{ role: 'teacher', content: '我们继续' }],
        lastTeacherMessage: '我们继续',
      },
    };
    await virtualLearnerLearnTurnSimulator(input);
    const spec = mockCallPrompt.mock.calls[0][0];
    const messages = buildMessagesFromSpec(input, spec);
    expect(messages[1]).toEqual({ role: 'user', content: '{"a":1}' });
  });

  it('payload 里不夹带 base64（图片只走内容块，不进 JSON 文本）', async () => {
    const input: LearnLearnerSimulationInput = {
      ...baseInput,
      visibleContext: {
        history: [{ role: 'teacher', content: '看这张表', images: [{ url: png(50) }] }],
        lastTeacherMessage: '看这张表',
      },
    };
    await virtualLearnerLearnTurnSimulator(input);
    const spec = mockCallPrompt.mock.calls[0][0];
    const payload = spec.buildUserPayload(input);
    expect(JSON.stringify(payload)).not.toContain('EEEE');
  });
});
