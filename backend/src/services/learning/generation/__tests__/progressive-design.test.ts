/**
 * 渐进式调度单测（活的 path 批次 D2）：
 * isProgressiveStageDesignEnabled（flag 解析）/ extractLearnerSignals 信号提炼与钳制（纯函数）。
 * DB 查询面（buildPreviousStageOutcome 的 milestones/teaching_sessions 查询）由 probe-progressive E2E 覆盖。
 */
import { jest } from '@jest/globals';

jest.mock('../../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn() },
}));

import {
  extractLearnerSignals,
  isProgressiveStageDesignEnabled,
} from '../progressive-design';

describe('isProgressiveStageDesignEnabled', () => {
  const original = process.env.PROGRESSIVE_STAGE_DESIGN;
  afterEach(() => {
    if (original === undefined) delete process.env.PROGRESSIVE_STAGE_DESIGN;
    else process.env.PROGRESSIVE_STAGE_DESIGN = original;
  });

  it('默认关（未设置）', () => {
    delete process.env.PROGRESSIVE_STAGE_DESIGN;
    expect(isProgressiveStageDesignEnabled()).toBe(false);
  });
  it("'1'/'true' 开", () => {
    process.env.PROGRESSIVE_STAGE_DESIGN = '1';
    expect(isProgressiveStageDesignEnabled()).toBe(true);
    process.env.PROGRESSIVE_STAGE_DESIGN = 'true';
    expect(isProgressiveStageDesignEnabled()).toBe(true);
  });
  it("其他值关（'0'/'false'/'off'）", () => {
    for (const value of ['0', 'false', 'off', '']) {
      process.env.PROGRESSIVE_STAGE_DESIGN = value;
      expect(isProgressiveStageDesignEnabled()).toBe(false);
    }
  });
});

describe('extractLearnerSignals 信号提炼（钳制 ≤5、mastered 除外）', () => {
  it('从快照与 wrapup 提炼，各类钳制 5 条', () => {
    const signals = extractLearnerSignals(
      {
        currentPath: {
          prerequisiteGaps: [
            { conceptName: '缺口1' }, { conceptName: '缺口2' }, { conceptName: '缺口3' },
            { conceptName: '缺口4' }, { conceptName: '缺口5' }, { conceptName: '缺口6' },
          ],
        },
        globalSignals: {
          fragileConcepts: ['脆弱1', '脆弱2', '脆弱3', '脆弱4', '脆弱5', '脆弱6'],
          strugglingConcepts: ['挣扎1', '挣扎2'],
        },
      },
      {
        summary: {
          knowledgeItems: [
            { name: '没掌握点', status: 'learning' },
            { name: '已掌握点', status: 'mastered' },
            { name: '复述点', status: 'review' },
          ],
        },
      }
    );
    expect(signals.fragileConcepts).toHaveLength(5);
    expect(signals.strugglingConcepts).toEqual(['挣扎1', '挣扎2']);
    expect(signals.prerequisiteGaps).toHaveLength(5);
    expect(signals.stillLearning).toEqual(['没掌握点', '复述点']); // mastered 不进 stillLearning
  });

  it('空快照/wrapup → 全空数组（不抛错）', () => {
    const signals = extractLearnerSignals({}, null);
    expect(signals).toEqual({
      fragileConcepts: [], strugglingConcepts: [], prerequisiteGaps: [], stillLearning: [],
    });
  });
});
