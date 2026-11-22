/**
 * 渐进式设计（2026-11-21）：学习进度与设计进度分离。
 *
 * 背景：路径的「已就绪阶段」可以边学边等后续阶段设计；此前 `phase !== 'ready'`
 * 就把整条路径当作「生成中」，导致
 * - 已有可学阶段时仍说「整条路径还在生成」；
 * - 后续设计失败/暂停也把学习百分比盖成 0；
 * - 只要不是 ready 就无限轮询（stale/failed 也不停）。
 *
 * 本模块锁住三处纯函数口径：
 * - `isDesignPollingActive` 只认 queued/processing（旧 fixture 的 `running` 必须为 false）；
 * - `buildGenerationProgress` / `genStageLabel` 在 canStartLearning 时说「后续阶段准备中」；
 * - `isGenerationSettled` 在设计 run 真正在跑时永不算 settled。
 */
import { describe, expect, it } from 'vitest';
import {
  buildGenerationProgress,
  genStageLabel,
  isDesignPollingActive,
  isGenerationSettled,
} from '../learningPathProgress';

const NOW = Date.parse('2026-11-21T08:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('isDesignPollingActive', () => {
  it('只认 queued/processing：旧 status=running 不再是轮询依据', () => {
    expect(isDesignPollingActive({ phase: 'core', status: 'queued' })).toBe(true);
    expect(isDesignPollingActive({ phase: 'stage_design', status: 'processing' })).toBe(true);
    // 回归：fixture 曾写 status:'running'，被误当成进行中（通知中心因此把路径当 busy）
    expect(isDesignPollingActive({ phase: 'stage_design', status: 'running' })).toBe(false);
    expect(isDesignPollingActive({ phase: 'stage_design', status: 'stale' })).toBe(false);
    expect(isDesignPollingActive({ phase: 'stage_design', status: 'failed' })).toBe(false);
    expect(isDesignPollingActive({ phase: 'ready', status: 'ready' })).toBe(false);
    expect(isDesignPollingActive({ phase: 'ready', status: 'processing' })).toBe(false);
    expect(isDesignPollingActive(null)).toBe(false);
    expect(isDesignPollingActive(undefined)).toBe(false);
  });

  it('后端显式 design.active 优先（true/false 都照用）', () => {
    expect(isDesignPollingActive({ phase: 'stage_design', status: 'processing', design: { active: false } })).toBe(false);
    expect(isDesignPollingActive({ phase: 'stage_design', status: 'failed', design: { active: true } })).toBe(true);
  });
});

describe('buildGenerationProgress · 渐进式', () => {
  it('已有阶段可学：不再宣称整条路径还在生成，给出已就绪进度', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', status: 'processing', canStartLearning: true, completedStages: 2, totalStages: 5, currentStageNumber: 3 },
      NOW
    );
    expect(copy.primary).toBe('后续第 3 阶段正在准备（已就绪 2/5）…');
    expect(copy.primary).not.toContain('正在准备课程');
    expect(copy.secondary).toBe('已就绪的课程可以继续学习，后续阶段会在后台补齐。');
  });

  it('无 currentStageNumber 时退回「后续阶段正在准备…」', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', status: 'processing', canStartLearning: true, completedStages: 1, totalStages: 4 },
      NOW
    );
    expect(copy.primary).toBe('后续阶段正在准备…');
  });

  it('可学但心跳陈旧：只声称设计阶段的最近进展，并保留继续学习的出口', () => {
    const copy = buildGenerationProgress(
      { phase: 'stage_design', status: 'processing', canStartLearning: true, completedStages: 2, totalStages: 5, heartbeatAt: ago(220_000) },
      NOW
    );
    expect(copy.secondary).toBe('已就绪的课程可以继续学习。后续设计最近一次进展在 3 分 40 秒 前。');
    expect(copy.secondary).not.toContain('已等待');
  });
});

describe('isGenerationSettled', () => {
  it('设计 run 真正在跑时永不算 settled（即使已有阶段可学）', () => {
    expect(isGenerationSettled({ phase: 'stage_design', status: 'processing', canStartLearning: true })).toBe(false);
    expect(isGenerationSettled({ phase: 'stage_design', status: 'processing', design: { active: true } })).toBe(false);
  });

  it('失败/暂停/就绪才停表', () => {
    expect(isGenerationSettled({ phase: 'stage_design', status: 'failed', canStartLearning: true })).toBe(true);
    expect(isGenerationSettled({ phase: 'stage_design', status: 'stale' })).toBe(true);
    expect(isGenerationSettled({ phase: 'ready', status: 'ready' })).toBe(true);
    expect(isGenerationSettled(null)).toBe(false);
  });
});

describe('genStageLabel · 渐进式', () => {
  it('可学时说「后续阶段准备中」，带已就绪计数', () => {
    expect(genStageLabel({ phase: 'stage_design', status: 'processing', canStartLearning: true, completedStages: 2, totalStages: 4 }))
      .toBe('后续阶段准备中（已就绪 2/4）');
    expect(genStageLabel({ phase: 'stage_design', status: 'processing', canStartLearning: true }))
      .toBe('后续阶段准备中');
  });

  it('core 阶段优先说规划，不套用可学文案', () => {
    expect(genStageLabel({ phase: 'core', status: 'processing', canStartLearning: true, completedStages: 1, totalStages: 4 }))
      .toBe('规划阶段与课时');
  });
});
