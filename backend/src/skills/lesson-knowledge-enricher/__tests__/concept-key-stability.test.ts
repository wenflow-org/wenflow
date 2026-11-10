/**
 * 概念键稳定性（2026-11-09 运营字段真值核查）
 *
 * 真实 LLM 实测：同一份输入连跑 3 次，同一个概念分别被模型命名为
 * `由线索唤起素材` / `kc-1b` / `anchor-diff-seq`，概念集合 Jaccard 只有 0.66。
 * 运营后台「N 个概念」「可迁移/待巩固」因此不可复现。
 *
 * 本测试锁定运行时归一：
 *   ① 输入 knowledgeState 里的概念 → conceptKey 一律取 kcId（跨次稳定）；
 *   ② 模型自造 slug 但 label 能对上 knowledgeState → 归一到 kcId；
 *   ③ 输入没有的隐性概念 → 退回归一化 label，至少同一写法得到同一键；
 *   ④ transferSignals / recurringConfusions 与台账用同一套键。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}));

import { lessonKnowledgeEnricher } from '../index';

const KNOWLEDGE_STATE = [
  { name: '由线索唤起素材', status: 'mastered', progress: 95, kcId: 'kc-1b' },
  { name: '锚点之间的性质差异与勾连顺序', status: 'learning', progress: 60, kcId: 'kc-2a' },
];

function mockModelOutput(output: unknown) {
  // callPrompt(spec, input)：第二参就是 handler 收到的真实输入，必须原样交给 normalizeOutput，
  // 否则「可追溯」过滤看不到对话/事件文本。
  mockCallPrompt.mockImplementation(async (spec: any, payload: any) => ({
    success: true,
    output: spec.normalizeOutput(output, spec.buildUserPayload(payload, {})),
    runtimeEnvelope: {},
    debug: {},
  }));
}

describe('lesson-knowledge-enricher · conceptKey 稳定性', () => {
  beforeEach(() => jest.clearAllMocks());

  it('模型用中文 label 当 key → 归一为输入 kcId', async () => {
    mockModelOutput({
      conceptLedger: [{ conceptKey: '由线索唤起素材', label: '由线索唤起素材', familiarity: 'stable', transferReadiness: 'high', misconceptionRisk: 'low', evidenceCount: 1 }],
      transferSignals: [{ conceptKey: '由线索唤起素材', label: '由线索唤起素材', readiness: 'high', confidence: 0.8 }],
    });

    const result = await lessonKnowledgeEnricher({ knowledgeState: KNOWLEDGE_STATE as any });
    expect(result.output?.conceptLedger?.[0].conceptKey).toBe('kc-1b');
    expect(result.output?.transferSignals?.[0].conceptKey).toBe('kc-1b');
  });

  it('模型自造 slug 但 label 对得上 → 归一为 kcId（跨次同一概念不再换键）', async () => {
    mockModelOutput({
      conceptLedger: [
        { conceptKey: 'anchor-diff-seq', label: '锚点之间的性质差异与勾连顺序', familiarity: 'practiced', transferReadiness: 'medium', misconceptionRisk: 'medium', evidenceCount: 2 },
      ],
    });

    const result = await lessonKnowledgeEnricher({ knowledgeState: KNOWLEDGE_STATE as any });
    expect(result.output?.conceptLedger?.[0].conceptKey).toBe('kc-2a');
  });

  it('模型已给出合法 kcId → 原样保留', async () => {
    mockModelOutput({
      conceptLedger: [{ conceptKey: 'kc-2a', label: '锚点之间的性质差异与勾连顺序', familiarity: 'practiced', transferReadiness: 'medium', misconceptionRisk: 'low', evidenceCount: 1 }],
    });

    const result = await lessonKnowledgeEnricher({ knowledgeState: KNOWLEDGE_STATE as any });
    expect(result.output?.conceptLedger?.[0].conceptKey).toBe('kc-2a');
  });

  it('看板外的隐性概念不进台账（台账=看板概念），但仍作为线索保留在 recurringConfusions', async () => {
    mockModelOutput({
      conceptLedger: [{ conceptKey: '  Distinguish Clue-Material  ', label: '  Distinguish Clue-Material  ', familiarity: 'seen', transferReadiness: 'low', misconceptionRisk: 'low', evidenceCount: 0 }],
      recurringConfusions: [{ conceptKey: 'Distinguish Clue-Material', label: 'Distinguish Clue-Material', pattern: '混淆', confidence: 0.6, count: 1 }],
    });

    const result = await lessonKnowledgeEnricher({
      knowledgeState: KNOWLEDGE_STATE as any,
      visibleDialogueContext: [{ role: 'user', content: '我分不清 Distinguish Clue-Material 这两个' }],
    } as any);
    // 台账是「看板概念」的口径：看板外的概念不进台账，避免「N 个概念」随模型某次多抽而波动
    expect(result.output?.conceptLedger).toHaveLength(0);
    // 隐性概念线索仍保留（去空白 + 小写，模型换大小写也落到同一个键）
    expect(result.output?.recurringConfusions?.[0].conceptKey).toBe('distinguishclue-material');
  });

  it('看板概念的 familiarity/readiness 由看板 status/progress 派生（模型判读不再让它们漂）', async () => {
    // 模型给 stable/high，但看板写的是 learning/50 → 以看板为准（可复现）
    mockModelOutput({
      conceptLedger: [
        { conceptKey: 'kc-2a', label: '锚点之间的性质差异与勾连顺序', familiarity: 'stable', transferReadiness: 'high', misconceptionRisk: 'low', evidenceCount: 1 },
      ],
    });

    const result = await lessonKnowledgeEnricher({ knowledgeState: KNOWLEDGE_STATE as any });
    expect(result.output?.conceptLedger?.[0].familiarity).toBe('practiced');
    expect(result.output?.conceptLedger?.[0].transferReadiness).toBe('medium');
    // 模型仍保留它唯一该负责的自由判断
    expect(result.output?.conceptLedger?.[0].misconceptionRisk).toBe('low');
  });

  it('看板 mastered + progress>=90 → stable/high（高完成度才算可迁移）', async () => {
    mockModelOutput({
      conceptLedger: [
        { conceptKey: 'kc-1b', label: '由线索唤起素材', familiarity: 'seen', transferReadiness: 'low', misconceptionRisk: 'low', evidenceCount: 1 },
      ],
    });

    const result = await lessonKnowledgeEnricher({ knowledgeState: KNOWLEDGE_STATE as any });
    expect(result.output?.conceptLedger?.[0].familiarity).toBe('stable');
    expect(result.output?.conceptLedger?.[0].transferReadiness).toBe('high');
  });

  it('模型轻微改写概念名（多一个「词」）仍命中看板状态，不由模型判读', async () => {
    // 实测样例：看板「锚点之间的性质差异与勾连顺序」→ 模型写「…线索词…」之类多字版本
    mockModelOutput({
      conceptLedger: [
        { conceptKey: 'kc-2a', label: '锚点之间的性质差异词与勾连顺序', familiarity: 'stable', transferReadiness: 'high', misconceptionRisk: 'low', evidenceCount: 1 },
      ],
    });

    const result = await lessonKnowledgeEnricher({ knowledgeState: KNOWLEDGE_STATE as any });
    // 仍被认定为看板概念（不被丢弃），且状态取看板（learning/60 → practiced/medium）
    expect(result.output?.conceptLedger).toHaveLength(1);
    expect(result.output?.conceptLedger?.[0].familiarity).toBe('practiced');
    expect(result.output?.conceptLedger?.[0].transferReadiness).toBe('medium');
  });

  it('knowledgeState 为空时不崩，退回 label 键', async () => {
    mockModelOutput({
      conceptLedger: [{ conceptKey: 'some-slug', label: '某概念', familiarity: 'seen', transferReadiness: 'low', misconceptionRisk: 'low', evidenceCount: 0 }],
    });

    const result = await lessonKnowledgeEnricher({
      knowledgeState: [] as any,
      visibleDialogueContext: [{ role: 'assistant', content: '我们来看某概念的实际用法' }],
    } as any);
    expect(result.output?.conceptLedger?.[0].conceptKey).toBe('某概念');
  });
});
