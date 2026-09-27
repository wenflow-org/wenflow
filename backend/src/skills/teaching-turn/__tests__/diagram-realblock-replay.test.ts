/* eslint-disable @typescript-eslint/no-explicit-any -- 一次性诊断：真实块回放 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, type TeachingTurnInput } from '../index';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: '把流程串给我看' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '分布式', topic: '超时', taskTitle: '拆解超时', taskDescription: '拆解', taskType: 'practice' },
  knowledge: { points: [] },
};

const basePayload = {
  reply: '好，到这一层了。',
  analysis: { cognitiveLevel: 'analyze', levelScore: 4, understanding: 0.7, confusionPoints: [], engagement: 0.8, emotionalState: 'neutral', loadIndex: 0.4, loadBasis: 'semantic' },
  knowledge: { currentPoint: '超时', points: [{ name: '超时', status: 'learning', progress: 50 }] },
  pedagogy: { strategies: ['explain'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
};

// 2026-09-27 E2E 实测中模型真实输出、但未进 normalizedOutput 的块（从 DB payload 解码）
const REAL_DIAGRAM = {
  engine: 'mermaid',
  code: 'flowchart TD\n  A["客户端发出请求"] --> B["对端收到并处理"]\n  B --> C["处理结果已生效"]\n  C --> D{"响应回程"}\n  D -->|"丢失"| E["本地计时器到点\\n判超时"]\n  D -->|"送达"| F["本地收到成功响应"]\n  E --> G["重试：整条流程再走一遍"]\n  G --> H["对端可能再次执行\\n同一操作生效两次"]\n  E --> I["本地区分不出这四种状态"]\n  style E fill:#ffe9b3\n  style H fill:#ffd0d0',
  caption: '一次执行与重试路径：本地只看到「超时」，看不到对端是否已经生效',
};

it('真实块回放：normalizeDiagram 应保留（不丢）', async () => {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput({ ...basePayload, diagram: REAL_DIAGRAM }, input),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  const teaching = (output.internal?.ext as any)?.teaching;
  // eslint-disable-next-line no-console
  console.log('diagram kept:', !!teaching.diagram, '| engine:', teaching.diagram?.engine, '| codeLen:', teaching.diagram?.code?.length);
  expect(teaching.diagram).toBeTruthy();
});
