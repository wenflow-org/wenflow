const mockCallPrompt = jest.fn();
const mockGatewayExecute = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: (...args: unknown[]) => mockCallPrompt(...args),
}));

// 材料语义判定走 getAPIGateway()；这里 mock 掉，让「模型返回值」成为可控输入。
jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute }),
}));

import { stageDesigner } from '../index';
import type { PromptMaterial } from '../../../services/materials/material-prompt-projection';

const materials: PromptMaterial[] = [
  {
    title: '公司合规手册',
    sourceUrl: 'attachment://compliance',
    materialId: 'm1',
    publisher: null,
    sourceTier: 'unknown',
    tldr: '公司合规风险管理与员工行为准则',
    sections: [{ id: 's1', title: '合规风险管理' }],
    keyPoints: [{ text: '员工行为准则', cite: '员工应当遵守礼品与招待规定' }],
    brief: null,
  },
];

function stageInput(overrides: Record<string, unknown> = {}) {
  return {
    milestone: {
      stageNumber: 1,
      title: '合规风险识别',
      goal: '识别公司合规风险与员工行为边界',
      description: '围绕合规风险管理建立判断标准',
      coreConcept: '合规风险',
    },
    cognitiveCore: {},
    materials,
    ...overrides,
  };
}

async function capturedSpec(input: Record<string, unknown>) {
  mockCallPrompt.mockResolvedValue({
    success: true,
    output: { subtasks: [] },
    runtimeEnvelope: {},
    debug: { rawModelOutput: '', extractedJson: '', userPayload: '', systemPromptVersion: null, durationMs: 1 },
  });
  const result = await stageDesigner(input);
  expect(result.success).toBe(true);
  return mockCallPrompt.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  // 默认：语义判定模型判通过（不影响本文件既有的资料引用软校验用例）
  mockGatewayExecute.mockResolvedValue({
    choices: [{ index: 0, message: { role: 'assistant', content: '{"valid":true,"violations":[]}' }, finish_reason: 'stop' }],
  });
});

describe('stage-designer 资料引用软校验', () => {
  it('相关资料但整阶段零引用 → 软校验失败（触发一次纠错重试）', async () => {
    const spec = await capturedSpec(stageInput());
    const validation = spec.softValidateParsedOutput({
      subtasks: [
        { title: '列出风险点', description: '结合公司合规手册梳理风险' },
        { title: '判断行为边界', description: '区分合规与不合规行为' },
      ],
    }, stageInput());

    expect(validation.valid).toBe(false);
    expect(validation.failureReason).toContain('MATERIAL_REFS_MISSING_STAGE');
    expect(validation.violations).toHaveLength(2);
  });

  it('逐字可核对引用 → 软校验通过', async () => {
    const spec = await capturedSpec(stageInput());
    const validation = spec.softValidateParsedOutput({
      subtasks: [
        {
          title: '列出风险点',
          materialRefs: [{ materialId: 'm1', sectionId: 's1', quote: '合规风险管理' }],
        },
      ],
    }, stageInput());

    expect(validation.valid).toBe(true);
  });

  it('相关资料但只有部分任务有引用（如 1/4）→ 部分覆盖不重试（2026-10-21 对比裁决）', async () => {
    const spec = await capturedSpec(stageInput());
    const validation = spec.softValidateParsedOutput({
      subtasks: [
        { title: '列出风险点', materialRefs: [{ materialId: 'm1', sectionId: 's1', quote: '合规风险管理' }] },
        { title: '判断行为边界', description: '区分合规与不合规行为' },
        { title: '访谈合规负责人', description: '整理访谈提纲' },
        { title: '输出风险清单', description: '汇总为清单' },
      ],
    }, stageInput());

    expect(validation.valid).toBe(true);
    expect(validation.failureReason).toBeUndefined();
  });

  it('资料与阶段目标无关 → 零引用也通过（不硬塞无关附件）', async () => {
    const spec = await capturedSpec(stageInput({
      milestone: {
        stageNumber: 1,
        title: '摄影构图练习',
        goal: '掌握三分法与景深',
        description: '拍摄静物',
      },
      materials: [
        {
          ...materials[0],
          title: '税务申报指南',
          tldr: '个人所得税年度汇算',
          sections: [{ id: 's1', title: '专项附加扣除' }],
          keyPoints: [],
        },
      ],
    }));
    const validation = spec.softValidateParsedOutput({
      subtasks: [{ title: '拍一组照片', description: '练习构图' }],
    }, {});

    expect(validation.valid).toBe(true);
  });
});

describe('stage-designer 材料语义判定（生成流程里的模型判定 + 带反馈重试）', () => {
  function generationResult(subtasks: any[]) {
    return {
      success: true,
      output: { subtasks },
      runtimeEnvelope: {},
      debug: { rawModelOutput: '', extractedJson: '', userPayload: '', systemPromptVersion: null, durationMs: 1 },
    };
  }

  it('模型判 false → 带修复反馈再生成一次（callPrompt 两次，第二次 repairHints 带 violations）', async () => {
    mockCallPrompt.mockResolvedValue(generationResult([
      { title: '拆解争议事件', description: '把三件 AI 教育事件各写一句「它到底在替课堂做哪件事」' },
    ]));
    const violations = ['任务 1「拆解争议事件」：承诺了「三件 AI 教育事件」，却没给出这三件事件是什么'];
    mockGatewayExecute.mockResolvedValueOnce({
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify({ valid: false, violations }) },
        finish_reason: 'stop',
      }],
    });

    const result = await stageDesigner(stageInput({ materials: [] }));

    expect(result.success).toBe(true);
    expect(mockCallPrompt).toHaveBeenCalledTimes(2);
    const retryInput = mockCallPrompt.mock.calls[1][1];
    expect(retryInput.repairHints).toEqual(expect.objectContaining({ materialBodyViolations: violations }));
    // 首轮输入不带该键（没有被无端污染）
    expect(mockCallPrompt.mock.calls[0][1]?.repairHints?.materialBodyViolations).toBeUndefined();
  });

  it('模型判 true → 不重试（callPrompt 只调一次）', async () => {
    mockCallPrompt.mockResolvedValue(generationResult([
      { title: '判断行为边界', description: '区分合规与不合规行为，说出判断依据' },
    ]));
    mockGatewayExecute.mockResolvedValueOnce({
      choices: [{ index: 0, message: { role: 'assistant', content: '{"valid":true,"violations":[]}' }, finish_reason: 'stop' }],
    });

    const result = await stageDesigner(stageInput({ materials: [] }));

    expect(result.success).toBe(true);
    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
  });

  it('判定模型报错 → 不阻塞，保留首轮输出（不重试）', async () => {
    mockCallPrompt.mockResolvedValue(generationResult([
      { title: '判断行为边界', description: '区分合规与不合规行为，说出判断依据' },
    ]));
    mockGatewayExecute.mockRejectedValueOnce(new Error('upstream 500'));

    const result = await stageDesigner(stageInput({ materials: [] }));

    expect(result.success).toBe(true);
    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
  });
});
