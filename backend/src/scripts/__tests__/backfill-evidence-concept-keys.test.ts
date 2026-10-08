import { resolveEvidenceConceptAttribution } from '../backfill-evidence-concept-keys';
import { deriveConceptKeyFromName } from '../../services/ai-teaching/checkpoint-shared';

/**
 * 存量证据概念键回填的归属解析（纯函数）单测：
 * 口径须与 F1 修复的新行键控逐字节一致（teaching-turn-engine → resolveCheckpointConceptAttribution →
 * deriveConceptKeyFromName），回溯优先级 history-key > history-name > message-point > null。
 */
describe('resolveEvidenceConceptAttribution（回填归属解析）', () => {
  const occurredAt = Date.parse('2026-09-17T16:12:22.874Z');
  const payload = { checkpointId: 'cp_1', type: 'single_choice', passed: false };

  it('message-point：取 occurredAt 之前最近的一条当轮教学点，键与新行口径一致', () => {
    const points = [
      { at: occurredAt - 60_000, name: '给每条冲突说法标注发布主体' },
      { at: occurredAt - 10_000, name: '影响短路电流大小的量' },
      { at: occurredAt + 30_000, name: '之后才教的概念' },
    ];
    const r = resolveEvidenceConceptAttribution(payload, occurredAt, [], points);
    expect(r.via).toBe('message-point');
    expect(r.conceptName).toBe('影响短路电流大小的量');
    expect(r.conceptKey).toBe(deriveConceptKeyFromName('影响短路电流大小的量'));
    expect(r.conceptSource).toBe('derived');
  });

  it('无更早教学点时取其后最近一条（跨轮容忍）', () => {
    const points = [{ at: occurredAt + 5_000, name: '唯一教学点' }];
    const r = resolveEvidenceConceptAttribution(payload, occurredAt, [], points);
    expect(r.via).toBe('message-point');
    expect(r.conceptKey).toBe(deriveConceptKeyFromName('唯一教学点'));
  });

  it('checkpointHistory 有归属时优先于消息时间线（conceptKey 直用）', () => {
    const history = [{ checkpointId: 'cp_1', conceptName: '历史点名', conceptKey: 'cpt_abcdef0123456789' }];
    const r = resolveEvidenceConceptAttribution(payload, occurredAt, history, [
      { at: occurredAt - 1_000, name: '消息点名' },
    ]);
    expect(r.via).toBe('history-key');
    expect(r.conceptKey).toBe('cpt_abcdef0123456789');
    expect(r.conceptName).toBe('历史点名');
  });

  it('checkpointHistory 只有 conceptName 时按名字派生', () => {
    const history = [{ checkpointId: 'cp_1', conceptName: '历史点名' }];
    const r = resolveEvidenceConceptAttribution(payload, occurredAt, history, []);
    expect(r.via).toBe('history-name');
    expect(r.conceptKey).toBe(deriveConceptKeyFromName('历史点名'));
  });

  it('会话无教学点、无归属 → 显式置 null（宁缺勿挂占位键）', () => {
    const r = resolveEvidenceConceptAttribution(payload, occurredAt, [], []);
    expect(r.via).toBe('unresolvable');
    expect(r.conceptKey).toBeNull();
    expect(r.conceptName).toBeNull();
    expect(r.conceptSource).toBeNull();
  });

  it('payload 无 checkpointId 时跳过 history 直接走消息时间线', () => {
    const history = [{ checkpointId: 'cp_other', conceptName: '别题的点名' }];
    const r = resolveEvidenceConceptAttribution({ type: 'anchor:result' }, occurredAt, history, [
      { at: occurredAt - 1_000, name: '当轮教学点' },
    ]);
    expect(r.via).toBe('message-point');
    expect(r.conceptKey).toBe(deriveConceptKeyFromName('当轮教学点'));
  });

  it('同名异写派生同键（与 checkpoint-shared 归一口径一致）', () => {
    const a = resolveEvidenceConceptAttribution(payload, occurredAt, [], [{ at: 1, name: '影响短路电流大小的量' }]);
    const b = resolveEvidenceConceptAttribution(payload, occurredAt, [], [{ at: 1, name: '影响短路电流大小 的量' }]);
    expect(a.conceptKey).toBe(b.conceptKey);
  });
})
